import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { extractPosting } from '../src/posting-extractor.js';
import { defaults } from '../src/core.js';
import { serializeCapture } from '../src/capture-transport.js';
import { createCapture } from '../src/captures.js';
import { localTracker } from './helpers/local-tracker.js';
const profile = await mkdtemp(join(tmpdir(), 'job-hunt-posting-adapters-'));
const context = await chromium.launchPersistentContext(profile, { channel:'chromium',headless:true,args:[`--disable-extensions-except=${resolve('build')}`,`--load-extension=${resolve('build')}`] });
const external = [], errors=[]; let aiCalls=0;
await context.route('**/*', route=>{
  if(route.request().url().startsWith('chrome-extension:'))return route.continue();
  if(route.request().url()==='http://127.0.0.1:9876/v1/chat/completions'){
    aiCalls++; const input=JSON.parse(JSON.parse(route.request().postData()).messages[1].content);
    assert.match(input.posting.description,/Required qualifications/); assert.match(input.posting.description,/TypeScript/);
    return route.fulfill({contentType:'application/json',body:JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({fit:'POSSIBLE',explanation:'The selected resume demonstrates transferable web development skills.',strengths:['Web development experience'],gaps:['Some required experience is not evidenced.'],preference_alignment:'UNKNOWN',preference_notes:''})}}]})});
  }
  external.push(route.request().url());return route.abort();
});
async function fixture(name,url){const p=await context.newPage();const html=await readFile(`tests/fixtures/postings/${name}.html`,'utf8');await p.route('**/*',r=>r.request().isNavigationRequest()&&r.request().frame()===p.mainFrame()?r.fulfill({contentType:'text/html',body:html}):r.abort());await p.goto(url);return p;}
try{
 const detail=await fixture('linkedin-detail','https://www.linkedin.com/jobs/view/4386923096/');
 await detail.evaluate(()=>{const button=document.createElement('button');button.type='button';button.setAttribute('aria-expanded','false');button.textContent='See more jobs';button.onclick=()=>window.premiumClicked=true;document.querySelector('.description__text').prepend(button);});
 await detail.evaluate(()=>{const wrapper=document.createElement('div');wrapper.dataset.testid='premium-upsell';const button=document.createElement('button');button.type='button';button.setAttribute('aria-expanded','false');button.setAttribute('aria-label','Click to see more description');button.textContent='Premium';button.onclick=()=>window.premiumClicked=true;wrapper.append(button);document.querySelector('.description__text').prepend(wrapper);});
 const result=await detail.evaluate(extractPosting), candidate=result.candidates[0];
 assert.equal(result.candidates.length,1);assert.equal(candidate.adapter,'linkedin-dom');assert.equal(candidate.posting.company_name,'CGI');assert.equal(candidate.posting.job_type,'FULL_TIME');assert.equal(candidate.posting.work_model,null);
 assert.equal(candidate.posting.job_url,'https://www.linkedin.com/jobs/view/4386923096/');assert.equal(candidate.source.requisition_id,'4386923096');
 for(const text of ['Position Description','Your future duties and responsibilities','Required qualifications to be successful','Preferred Qualifications','ReactJS','CI/CD'])assert.ok(candidate.posting.description.includes(text),text);
 assert.match(candidate.posting.description, /\n- .*TypeScript/);assert.doesNotMatch(candidate.posting.description,/NEIGHBOR_|PREMIUM_PROMPT|Show more|(?:^|\n)Apply(?:\n|$)/);
 for (const item of await detail.locator('.show-more-less-html__markup li').allTextContents()) assert.ok(candidate.posting.description.replace(/\s+/g,' ').includes(item.replace(/\s+/g,' ').trim()),'Every available LinkedIn list item is retained');
 assert.equal(await detail.evaluate(()=>window.expansions),1);assert.equal(await detail.evaluate(()=>window.applied),undefined);assert.equal(await detail.evaluate(()=>window.premiumClicked),undefined);assert.ok(!candidate.warnings.some(w=>w.code==='collapsed_content'));
 assert.ok(!result.warnings.some(w=>w.code==='frames_not_read'),'unrelated advertising frame is not evidence of missing requirements');
 const semantic=await fixture('linkedin-semantic-detail','https://www.linkedin.com/jobs/view/4475878761/');
 const modern=await semantic.evaluate(extractPosting), modernJob=modern.candidates[0];
 assert.equal(modernJob.posting.role_title,'Backend Developer');assert.equal(modernJob.posting.company_name,'NCS Group');assert.equal(modernJob.posting.location,'Taguig, National Capital Region, Philippines');assert.equal(modernJob.posting.work_model,'HYBRID');assert.equal(modernJob.posting.job_type,'FULL_TIME');
 assert.match(modernJob.posting.description,/About the job\n+SEMANTIC_BACKEND_REQUIREMENT/);assert.match(modernJob.posting.description,/Minimum Qualifications\n+- Experience with C#/);assert.doesNotMatch(JSON.stringify(modernJob),/PREMIUM_|PRIVATE_CONNECTION|NEIGHBOR_/);assert.equal(await semantic.evaluate(()=>window.applied),undefined);
 const separateHeader=await fixture('linkedin-semantic-detail','https://www.linkedin.com/jobs/view/4475878761/?separate-header=1');
 await separateHeader.evaluate(()=>{const root=document.querySelector('[role=main]');root.prepend(document.querySelector('a[href*="/company/"]'));});
 assert.equal((await separateHeader.evaluate(extractPosting)).candidates[0].posting.role_title,'Backend Developer','A unique h2 before About the job does not require a company link in the same container');
 await separateHeader.evaluate(()=>{const heading=document.createElement('h2');heading.textContent='Another plausible title';document.querySelector('.card-b34').prepend(heading)});assert.equal((await separateHeader.evaluate(extractPosting)).candidates[0].posting.role_title,null,'Competing primary headings require correction rather than guessing');
 const missingTitle=await fixture('linkedin-missing-title','https://www.linkedin.com/jobs/view/4475426687/');
 const partialTitle=await missingTitle.evaluate(extractPosting);assert.equal(partialTitle.candidates.length,1);assert.equal(partialTitle.candidates[0].posting.role_title,null);assert.equal(partialTitle.selection_guard.title_missing,true);assert.match(partialTitle.candidates[0].source.rendered_text,/IDENTIFIED_MISSING_TITLE_DESCRIPTION/);assert.doesNotMatch(partialTitle.candidates[0].source.rendered_text,/NEIGHBOR_/);
 const titleRequest=await serializeCapture(createCapture(partialTitle));assert.ok(titleRequest.assessment.reasons.includes('missing_role_title'));
 await missingTitle.evaluate(()=>{history.replaceState({},'','/jobs/view/4475426688/');document.querySelector('main').dataset.jobId='4475426688'});const staleTitle=await missingTitle.evaluate(extractPosting,{waitMs:800});assert.equal(staleTitle.candidates.length,0);assert.equal(staleTitle.diagnostics.reason,'previous_selection_text');await missingTitle.evaluate(()=>{history.replaceState({},'','/jobs/view/4475426687/');document.querySelector('main').dataset.jobId='4475426687'});
 await missingTitle.evaluate(()=>document.querySelector('main').dataset.jobId='999');const mismatchedTitle=await missingTitle.evaluate(extractPosting,{waitMs:800});assert.equal(mismatchedTitle.candidates.length,0);assert.equal(mismatchedTitle.diagnostics.reason,'identity_mismatch');await missingTitle.evaluate(()=>document.querySelector('main').dataset.jobId='4475426687');
 const unsupported=await fixture('linkedin-semantic-detail','https://www.linkedin.com/jobs/view/4475878761/?diagnostics=1');
 await unsupported.getByRole('heading',{name:'About the job',exact:true}).evaluate(n=>n.textContent='Unsupported section label');
 const unsupportedResult=await unsupported.evaluate(extractPosting,{waitMs:800});assert.equal(unsupportedResult.candidates.length,0);assert.equal(unsupportedResult.diagnostics.reason,'layout_unrecognized');assert.match(unsupportedResult.warnings[0].message,/already be fully loaded/);assert.doesNotMatch(JSON.stringify(unsupportedResult.diagnostics),/SEMANTIC_|PRIVATE_|NCS Group|diagnostics=1/);
 const semanticSplit=await fixture('linkedin-semantic-detail','https://www.linkedin.com/jobs/search/?currentJobId=4475878761');
 await semanticSplit.evaluate(()=>{const root=document.querySelector('[role=main]');root.setAttribute('role','region');root.setAttribute('aria-label','Job details');root.dataset.jobId='4475878761';});
 assert.equal((await semanticSplit.evaluate(extractPosting)).candidates[0].source.requisition_id,'4475878761');
 await semanticSplit.evaluate(()=>{history.replaceState({},'','/jobs/search/?currentJobId=4475878762');document.querySelector('[role=region]').dataset.jobId='4475878762';document.querySelector('h2').textContent='Backend Developer B';setTimeout(()=>{document.querySelector('.body-f12 p').textContent='SEMANTIC_SELECTED_B: build selected backend services.';},300)});
 const semanticB=await semanticSplit.evaluate(extractPosting);assert.equal(semanticB.candidates[0].source.requisition_id,'4475878762');assert.match(semanticB.candidates[0].posting.description,/SEMANTIC_SELECTED_B/);assert.doesNotMatch(semanticB.candidates[0].posting.description,/SEMANTIC_BACKEND_REQUIREMENT/);
 const split=await fixture('linkedin-split','https://www.linkedin.com/jobs/search/?currentJobId=111');
 const a=await split.evaluate(extractPosting);assert.equal(a.candidates.length,1);assert.equal(a.candidates[0].posting.work_model,'HYBRID');assert.equal(a.candidates[0].posting.job_type,'FULL_TIME');assert.match(a.candidates[0].posting.description,/INITIAL_A_ONLY/);assert.doesNotMatch(JSON.stringify(a.candidates),/NEIGHBOR_|PREMIUM_|ADVERTISEMENT_/);
 await split.locator('#select-b').click();const b=await split.evaluate(extractPosting);assert.equal(b.candidates[0].source.requisition_id,'222');assert.match(b.candidates[0].posting.description,/B_ONLY/);assert.doesNotMatch(b.candidates[0].posting.description,/INITIAL_A_ONLY/);
 await split.locator('#select-c').click();const c=await split.evaluate(extractPosting);assert.equal(c.candidates[0].source.requisition_id,'333');assert.match(c.candidates[0].posting.description,/C_ONLY/);assert.doesNotMatch(c.candidates[0].posting.description,/B_ONLY/);
 await split.locator('#stuck').click();const stale=await split.evaluate(extractPosting,{waitMs:900});assert.equal(stale.candidates.length,0);assert.ok(stale.warnings.some(w=>w.code==='selected_description_unavailable'));
 // The first capture can also occur while an unbound body is still changing.
 const firstTransition=await fixture('linkedin-split','https://www.linkedin.com/jobs/search/?currentJobId=111');
 await firstTransition.evaluate(()=>document.querySelector('#job-details').removeAttribute('data-job-description-id'));
 await firstTransition.locator('#select-b').click();const initial=await firstTransition.evaluate(extractPosting);assert.match(initial.candidates[0].posting.description,/B_ONLY/);assert.doesNotMatch(initial.candidates[0].posting.description,/INITIAL_A_ONLY/);
 const loading=await fixture('linkedin-loading','https://www.linkedin.com/jobs/search/?currentJobId=555');
 const started=Date.now();const missing=await loading.evaluate(extractPosting,{waitMs:800});assert.equal(missing.candidates.length,0);assert.ok(Date.now()-started<2200);assert.equal(missing.diagnostics.reason,'description_loading');
 await loading.locator('#finish-load').click();const loaded=await loading.evaluate(extractPosting);assert.match(loaded.candidates[0].posting.description,/LOADED_SELECTED/);
 await loading.evaluate(()=>{document.querySelector('#job-details').textContent='Loading...';document.querySelector('#job-details').setAttribute('aria-busy','true');setTimeout(()=>{history.replaceState({},'','/jobs/search/?currentJobId=666');document.querySelector('.jobs-details').dataset.jobId='666';},150)});
 const changed=await loading.evaluate(extractPosting,{waitMs:1000});assert.equal(changed.candidates.length,0);assert.ok(changed.warnings.some(w=>w.code==='selection_changed'));
 const collapsed=await fixture('linkedin-detail','https://www.linkedin.com/jobs/view/4386923096/?unexpandable=1');
 await collapsed.evaluate(()=>{document.querySelector('button.show-more-less-html__button--more').onclick=()=>{window.attempts=(window.attempts||0)+1}});
 const partial=await collapsed.evaluate(extractPosting);assert.ok(partial.candidates[0].warnings.some(w=>w.code==='collapsed_content'));assert.equal(await collapsed.evaluate(()=>window.attempts),1);
 const hidden=await fixture('linkedin-detail','https://www.linkedin.com/jobs/view/4386923096/?hidden=1');
 await hidden.evaluate(()=>{document.querySelector('.show-more-less-html__markup').hidden=true;document.querySelector('button.show-more-less-html__button--more').onclick=function(){const n=document.querySelector('.show-more-less-html__markup');n.hidden=false;n.classList.add('expanded');this.hidden=true;this.setAttribute('aria-expanded','true');}});
 const expandedHidden=await hidden.evaluate(extractPosting);assert.match(expandedHidden.candidates[0].posting.description,/Required qualifications/);assert.ok(!expandedHidden.candidates[0].warnings.some(w=>w.code==='collapsed_content'));
 const cgi=await fixture('cgi-njoyn','https://cgi.njoyn.com/corp/xweb/xweb.asp?CLID=21001&page=jobdetails&JobID=J0326-1512&lang=1');
 const cg=await cgi.evaluate(extractPosting), cgjob=cg.candidates[0];assert.equal(cg.candidates.length,1);assert.equal(cgjob.adapter,'cgi-njoyn-dom');assert.equal(cgjob.posting.work_model,null);assert.equal(cgjob.posting.job_type,'FULL_TIME');assert.equal(cgjob.source.requisition_id,'J0326-1512');
 assert.ok(cgjob.source.rendered_text.length>cgjob.source.structured_text.length*5);assert.ok(cgjob.posting.qualifications.length>=10);
 for(const heading of ['Position Description:','Your future duties and responsibilities:','Required qualifications to be successful in this role:','Skills:','What you can expect from us:'])assert.ok(cgjob.posting.description.includes(heading),heading);
 assert.doesNotMatch(cgjob.posting.description,/PRIVATE_|NEIGHBOR_|I'm Interested/);assert.ok(!cgjob.warnings.some(w=>w.code==='structured_only'));assert.ok(cgjob.warnings.some(w=>w.code==='conflicting_sources'&&w.field==='description'));
 const request=await serializeCapture(createCapture(cg));assert.equal(request.payload.source.variants.length,2);assert.ok(!request.assessment.reasons.includes('unknown_work_model'));
 for(const item of cgjob.posting.qualifications)assert.ok(cgjob.posting.description.replace(/\s+/g,' ').includes(item.replace(/\s+/g,' ').trim()));
 assert.equal(request.assessment.requirements_units,cgjob.posting.description.length,'Qualifications already in the description are not duplicated for assessment');
 console.log('PASS adapters: public-detail markup, explicit facts, complete headings/lists, split-pane delayed selection with/without body ID, no stale reuse, bounded loading/missing/changed selection, successful/failed expansion, CGI full rendered requirements plus original structured evidence.');

 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'), extensionURL=`chrome-extension://${new URL(worker.url()).hostname}/index.html`;
 const panel=await context.newPage();panel.on('pageerror',e=>errors.push(e.message));panel.setDefaultTimeout(12000);await panel.setViewportSize({width:340,height:1000});await panel.goto(extensionURL);
 const state=structuredClone(defaults);state.resumes[0]={name:'Selected resume',text:'Built web applications with React, TypeScript and SQL support systems.'};state.settings={...state.settings,baseUrl:'http://127.0.0.1:9876/v1',model:'test-model',apiKey:'MOCK_KEY'};await panel.evaluate(s=>chrome.storage.local.set({state:s}),state);await panel.reload();
 const target=async p=>panel.evaluate(async url=>{window.originalQuery||=chrome.tabs.query.bind(chrome.tabs);const all=await window.originalQuery({});const tab=all.find(t=>t.url===url);window.captureTarget=tab.id;chrome.tabs.query=async()=>[await chrome.tabs.get(window.captureTarget)];},p.url());
 await target(unsupported);await panel.locator('[data-tab=capture]').click();await panel.locator('#capture-posting').click();await panel.getByRole('alert').filter({hasText:'already be fully loaded'}).waitFor();
 const diagnosticDownload=panel.waitForEvent('download');await panel.locator('#capture-diagnostics-export').click();const diagnostics=JSON.parse(await readFile(await (await diagnosticDownload).path(),'utf8'));assert.equal(diagnostics.reason,'layout_unrecognized');assert.equal(diagnostics.job_id,'4475878761');assert.doesNotMatch(JSON.stringify(diagnostics),/SEMANTIC_|PRIVATE_|MOCK_KEY|Selected resume|diagnostics=1/);
 await panel.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.copiedCaptureDiagnostics=text}}}));await panel.locator('#capture-diagnostics-copy').click();await panel.getByRole('button',{name:'Diagnostics copied',exact:true}).waitFor();assert.deepEqual(JSON.parse(await panel.evaluate(()=>window.copiedCaptureDiagnostics)),diagnostics);
 await target(missingTitle);await panel.locator('#capture-posting').click();await panel.waitForFunction(()=>document.querySelector('#capture-job_url')?.value==='https://www.linkedin.com/jobs/view/4475426687/');assert.equal(await panel.locator('#capture-role_title').inputValue(),'');assert.match(await panel.locator('.capture-assessment-status').textContent(),/missing_role_title/);const titleOriginal=await panel.locator('.capture-source pre').first().textContent();assert.match(titleOriginal,/IDENTIFIED_MISSING_TITLE_DESCRIPTION/);
 await panel.locator('#capture-role_title').fill('Backend Developer');await panel.locator('#capture-form button[type=submit], #capture-form > button.button.primary').click();await panel.waitForFunction(()=>!document.querySelector('#capture-posting').disabled);assert.doesNotMatch(await panel.locator('.capture-assessment-status').textContent(),/missing_role_title/);assert.equal(await panel.locator('.capture-source pre').first().textContent(),titleOriginal);await panel.locator('.capture-warnings [data-warning-state=resolved]').filter({hasText:'missing_role_title'}).waitFor();
 await panel.evaluate(()=>{window.originalExecute=chrome.scripting.executeScript.bind(chrome.scripting);chrome.scripting.executeScript=async options=>{const result=await window.originalExecute(options);if(result[0]?.result?.selection_guard?.title_missing)await window.originalExecute({target:options.target,func:()=>{document.querySelector('main').dataset.jobId='999'}});return result}});
 await panel.locator('#capture-posting').click();await panel.getByRole('alert').filter({hasText:'changed during capture'}).waitFor();assert.equal(await panel.locator('#capture-history option').count(),1,'A missing title cannot bypass the final selection guard');assert.equal(await panel.locator('#capture-role_title').inputValue(),'Backend Developer');await panel.evaluate(()=>{chrome.scripting.executeScript=window.originalExecute});await missingTitle.evaluate(()=>document.querySelector('main').dataset.jobId='4475426687');
 await target(semantic);await panel.locator('#capture-posting').click();await panel.waitForFunction(()=>document.querySelector('#capture-job_url')?.value==='https://www.linkedin.com/jobs/view/4475878761/');assert.equal(await panel.locator('#capture-role_title').inputValue(),'Backend Developer');assert.match(await panel.locator('#capture-description').inputValue(),/SEMANTIC_BACKEND_REQUIREMENT/);assert.equal(await panel.locator('.capture-diagnostics').count(),0);
 await target(semanticSplit);await panel.locator('#capture-posting').click();await panel.waitForFunction(()=>document.querySelector('#capture-job_url')?.value==='https://www.linkedin.com/jobs/view/4475878762/');assert.match(await panel.locator('#capture-description').inputValue(),/SEMANTIC_SELECTED_B/);assert.match(await panel.locator('#capture-description').inputValue(),/Minimum Qualifications/);
 await target(detail);await panel.locator('#capture-posting').click();await panel.waitForFunction(()=>document.querySelector('#capture-job_url')?.value==='https://www.linkedin.com/jobs/view/4386923096/');
 // Installed capture follows each pane selection in the same tab, not a new URL/page.
 await split.goto('https://www.linkedin.com/jobs/search/?currentJobId=111');await target(split);await panel.locator('#capture-posting').click();await panel.waitForFunction(()=>document.querySelector('#capture-job_url')?.value==='https://www.linkedin.com/jobs/view/111/');
 await split.locator('#select-b').click();await panel.locator('#capture-posting').click();await panel.waitForFunction(()=>document.querySelector('#capture-job_url')?.value==='https://www.linkedin.com/jobs/view/222/');assert.doesNotMatch(await panel.locator('#capture-description').inputValue(),/INITIAL_A_ONLY/);
 await split.locator('#stuck').click();await panel.locator('#capture-posting').click();await panel.getByRole('alert').filter({hasText:'no previous description was reused'}).waitFor();assert.equal(await panel.locator('#capture-job_url').inputValue(),'https://www.linkedin.com/jobs/view/222/','failed extraction does not overwrite the last saved capture');
 await target(collapsed);await panel.locator('#capture-posting').click();await panel.locator('.capture-warnings [data-warning-state=unresolved]').filter({hasText:'collapsed_content'}).waitFor();
 await loading.goto('https://www.linkedin.com/jobs/search/?currentJobId=555');await target(loading);await panel.locator('#capture-posting').click();await panel.getByRole('alert').filter({hasText:'loading placeholder'}).waitFor();
 await loading.locator('#finish-load').click();await panel.locator('#capture-posting').click();await panel.waitForFunction(()=>document.querySelector('#capture-job_url')?.value==='https://www.linkedin.com/jobs/view/555/');
 await target(cgi);await panel.locator('#capture-posting').click();await panel.waitForFunction(()=>document.querySelector('#capture-job_url')?.value.includes('cgi.njoyn.com'));
 const savedOriginal=await panel.locator('.capture-source pre').first().textContent();assert.match(savedOriginal,/Required qualifications/);
 assert.match(await panel.locator('.capture-information').textContent(),/unknown_work_model/);assert.doesNotMatch(await panel.locator('.capture-assessment-status').textContent(),/unknown_work_model/);
 assert.match(await panel.locator('.capture-assessment-status').textContent(),/requirements_unverified/);
 await panel.locator('#capture-completeness-confirmed').check();await panel.locator('#capture-confirm-completeness').click();await panel.getByText('Reviewed by you · Local only',{exact:true}).waitFor();
 await panel.locator('.capture-warnings [data-warning-state=resolved]').filter({hasText:'requirements_unverified'}).waitFor();
 assert.doesNotMatch(await panel.locator('.capture-assessment-status').textContent(),/requirements_unverified/);
 // Location is a separate original conflict; completeness must not silently dismiss it.
 assert.match(await panel.locator('.capture-assessment-status').textContent(),/conflicting_sources/);
 const others=panel.locator('.capture-resolution[data-warning-code=conflicting_sources]');
 for(let i=0;i<await others.count();i++){const control=others.nth(i);if(/location differ/.test(await control.textContent())){await control.locator('select').selectOption('verified_irrelevant');await control.locator('textarea').fill('Compared both location labels: they describe the same Alabang/Muntinlupa posting; the full visible location is retained.');}}
 await panel.locator('#capture-completeness-confirmed').check();await panel.locator('#capture-confirm-completeness').click();await panel.locator('.capture-assessment-status').filter({hasText:'Nothing in the local capture checks.'}).waitFor();
 await panel.locator('#fit-assess').click();await panel.locator('.fit-result').waitFor();assert.equal(aiCalls,1);
 await panel.locator('#capture-prepare').click();await panel.locator('.capture-transport').waitFor();const prepared=JSON.parse(await panel.locator('.capture-transport pre').textContent());assert.ok(prepared.extension_assessment);assert.equal(prepared.posting.work_model,null);assert.equal(prepared.source.variants.length,2);assert.ok(prepared.source.warnings.some(w=>w.code==='requirements_unverified'));assert.ok(prepared.review.resolutions.some(r=>r.warning_id==='quality-requirements_unverified'));
 const tracker=await localTracker();
 try{
   const user=await tracker.db.getOrCreateUser({name:'Posting adapter test',email:'posting-adapter@example.invalid'});
   const token=(await tracker.store.issueExtensionCredential(user.id,'Posting adapter test')).token;
   const response=await fetch(tracker.origin+'/api/v1/captures',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':prepared.capture_id,Authorization:'Bearer '+token},body:JSON.stringify(prepared)});
   const receipt=await response.json();assert.equal(response.status,201,JSON.stringify(receipt));assert.equal(receipt.extension_assessment.disposition,'applied');assert.equal(aiCalls,1);
 }finally{await tracker.close();}
 const frozenSources=await panel.locator('.capture-source pre').first().textContent();assert.equal(frozenSources,savedOriginal);
 await panel.reload();await panel.locator('[data-tab=capture]').click();await panel.locator('.fit-result').waitFor();await panel.locator('.capture-assessment-status').filter({hasText:'Nothing in the local capture checks.'}).waitFor();
 await panel.locator('#capture-description').fill((await panel.locator('#capture-description').inputValue())+'\nNew requirement to verify.');assert.equal(await panel.locator('.fit-result').count(),0);assert.equal(await panel.locator('.capture-transport').count(),0);assert.match(await panel.locator('.capture-assessment-status').textContent(),/Unsaved changes/);
 assert.equal(await panel.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
 console.log('PASS installed extension: LinkedIn detail/split selections, collapse/loading failures without overwriting evidence, CGI dual sources, explicit completeness review, informational unknowns, remaining conflict action, selected-resume assessment/export/reopen and invalidation; no Apply/navigation or production requests.');
}finally{await context.close();if(!profile.startsWith(join(tmpdir(),'job-hunt-posting-adapters-')))throw new Error('Unexpected temporary profile');await rm(profile,{recursive:true,force:true});}
