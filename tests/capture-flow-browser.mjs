// Isolated installed-extension check. Never rebuilds build/ or uses a real account.
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { build } from 'vite';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, readFile, readdir, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, dirname, basename } from 'node:path';
import { defaults } from '../src/core.js';
import { settings, result } from './helpers/fit-fixture.js';
import { localTracker } from './helpers/local-tracker.js';

async function digestDirectory(dir) {
  const hash=createHash('sha256');
  async function walk(root) {
    const entries=(await readdir(root,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name));
    for(const e of entries){const file=join(root,e.name);if(e.isDirectory())await walk(file);else{hash.update(file);hash.update(await readFile(file));}}
  }
  await walk(dir);return hash.digest('hex');
}
const liveBuild=resolve('build'), before=await digestDirectory(liveBuild);
const temp=await mkdtemp(join(tmpdir(),'job-hunt-capture-flow-'));
const testBuild=join(temp,'extension');
let context,tracker,aiMode='success',aiCalls=0,loseReceipt=false;
const aiBodies=[],external=[],pageErrors=[],checks=[];
const originalFetch=globalThis.fetch;
// The tracker helper loads actual handlers with its database disabled and temp storage.
// Block any accidental provider/production call from those Node handlers too.
globalThis.fetch=(input,options)=>{
  const url=new URL(typeof input==='string'?input:input.url || String(input));
  if(!tracker || url.origin!==tracker.origin)throw new Error('External Node request blocked by capture-flow check');
  return originalFetch(input,options);
};
try {
  assert.notEqual(resolve(testBuild),liveBuild);
  await build({configFile:false,envFile:false,logLevel:'error',base:'./',worker:{format:'es'},build:{outDir:testBuild,emptyOutDir:true,chunkSizeWarningLimit:1500}});
  tracker=await localTracker();
  const user=await tracker.db.getOrCreateUser({name:'Capture flow fixture',email:'capture-flow@example.invalid'});
  const token=(await tracker.store.issueExtensionCredential(user.id,'Isolated capture-flow fixture')).token;
  context=await chromium.launchPersistentContext(join(temp,'profile'),{channel:'chromium',headless:true,args:[`--disable-extensions-except=${testBuild}`,`--load-extension=${testBuild}`]});
  context.setDefaultTimeout(20000);
  const pages={a:'https://jobs.lever.co/example/capture-flow-a',b:'https://jobs.lever.co/example/capture-flow-b',linkedin:'https://www.linkedin.com/jobs/view/9876543210/'};
  const linkedinHtml=await readFile('tests/fixtures/postings/linkedin-salary-heading.html','utf8');
  const html=title=>`<!doctype html><title>${title}</title><main class="content"><a class="main-header-logo"><img alt="Example logo"></a><div class="posting-headline"><h2>${title}</h2><div class="posting-categories"><div class="location">Manila</div><div class="workplaceTypes">Remote</div></div></div><div class="section-wrapper"><section class="section"><h3>About the role</h3><p>Build reliable customer-facing services with a collaborative engineering team. Document incidents and communicate clearly with customers and other engineers.</p><h3>Requirements</h3><ul><li>Build TypeScript services and support SQL databases.</li><li>Investigate incidents, write clear documentation and test changes.</li><li>Collaborate with the team to maintain reliable production systems.</li></ul></section></div></main>`;
  await context.route('**/*',async route=>{
    const req=route.request(),url=req.url();
    if(url.startsWith('chrome-extension:'))return route.continue();
    if(url.startsWith(tracker.origin+'/')){
      if(loseReceipt && req.method()==='POST' && new URL(url).pathname==='/api/v1/captures'){
        loseReceipt=false;await route.fetch();return route.abort('failed');
      }
      return route.continue();
    }
    if(url===settings.baseUrl+'/chat/completions'){
      aiCalls++;const body=JSON.parse(req.postData());aiBodies.push(body);
      if(aiMode==='failure')return route.fulfill({status:503,body:'Synthetic provider unavailable'});
      const supplied=JSON.parse(body.messages[1].content);
      const answer={...result,...(supplied.preferences?{preference_alignment:'ALIGNED',preference_notes:'The supplied preference notes were considered.'}:{})};
      return route.fulfill({contentType:'application/json',body:JSON.stringify({choices:[{finish_reason:'stop',message:{content:aiMode==='malformed'?'{broken':JSON.stringify(answer)}}]})});
    }
    if(url===pages.a || url===pages.b)return route.fulfill({contentType:'text/html',body:html(url===pages.a?'Support Engineer':'Platform Engineer')});
    if(url===pages.linkedin)return route.fulfill({contentType:'text/html',body:linkedinHtml});
    if(url.startsWith('https://jobs.lever.co/') && url.endsWith('/favicon.ico'))return route.fulfill({status:204,body:''});
    external.push(new URL(url).origin);return route.abort();
  });
  const worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const a=await context.newPage();await a.goto(pages.a);
  const b=await context.newPage();await b.goto(pages.b);
  const linkedin=await context.newPage();await linkedin.goto(pages.linkedin);
  const browserTabs=await worker.evaluate(()=>chrome.tabs.query({}));
  const aId=browserTabs.find(t=>t.url===pages.a).id,bId=browserTabs.find(t=>t.url===pages.b).id,linkedinId=browserTabs.find(t=>t.url===pages.linkedin).id;
  const panel=await context.newPage();panel.setDefaultTimeout(20000);panel.on('pageerror',e=>pageErrors.push(e.message));
  await panel.setViewportSize({width:360,height:1100});
  // A test extension page stands in for Chrome's side panel. Keep active-tab reads
  // pointed at the job page, while all other tab APIs and activation events are real.
  await panel.addInitScript(({tabId})=>{
    window.captureFlowActiveTab=tabId;
    const query=chrome.tabs.query.bind(chrome.tabs),get=chrome.tabs.get.bind(chrome.tabs);
    chrome.tabs.query=async info=>info.active?[await get(window.captureFlowActiveTab)]:query(info);
  },{tabId:aId});
  await panel.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);
  await panel.locator('[data-tab=capture]').waitFor();
  const state=structuredClone(defaults);state.settings=settings;
  const resumeText='Selected support evidence with TypeScript services and SQL. '.repeat(400)+'FULL_RESUME_TAIL';
  state.resumes=[{name:'Support resume',text:resumeText},{name:'Engineering resume',text:'OTHER_VARIANT_PRIVATE_EVIDENCE: TypeScript services and SQL support.'},null];
  await panel.evaluate(state=>chrome.storage.local.set({state}),state);
  await panel.reload();await panel.locator('[data-tab=capture]').click();
  const idle=()=>panel.waitForFunction(()=>!document.querySelector('[data-tab=capture]')?.disabled);
  const captures=()=>tracker.requests.filter(r=>r.method==='POST' && new URL(r.url).pathname==='/api/v1/captures');
  const activeCapture=async id=>panel.evaluate(async id=>{
    const key='capture-tab:'+id,w=(await chrome.storage.session.get(key))[key];
    return (await chrome.storage.local.get('posting-capture:'+w.capture_id))['posting-capture:'+w.capture_id];
  },id);
  const captureAndReview=async title=>{
    await panel.locator('#capture-posting').click();
    await panel.locator('#capture-role_title').waitFor();await idle();
    assert.equal(await panel.locator('#capture-role_title').inputValue(),title);
    if(await panel.locator('#capture-clipping-confirmed').count())await panel.locator('#capture-clipping-confirmed').check();
    await panel.locator('#capture-completeness-confirmed').check();
    await panel.locator('#capture-confirm-completeness').click();await idle();
    assert.equal(await panel.locator('#fit-assess').isEnabled(),true);
  };
  const switchTo=async(tab,id,title)=>{
    await panel.evaluate(id=>{window.captureFlowActiveTab=id;},id);await tab.bringToFront();
    await panel.waitForFunction(title=>document.querySelector('#capture-role_title')?.value===title,title);
    await idle();
  };
  await captureAndReview('Support Engineer');
  const captureA=await activeCapture(aId);
  assert.equal(await panel.locator('#tracker-save').isDisabled(),true);
  assert.equal(await panel.locator('#tracker-connect-form').count(),0);
  assert.equal(await panel.locator('#fit-compare').count(),0);
  assert.equal(await panel.locator('#tracker-freeze').count(),0);
  assert.equal(await panel.locator('#capture-prepare').count(),0);
  await panel.locator('[data-tab=settings]').click();
  await panel.locator('#tracker-origin').fill('https://untrusted.example');await panel.locator('#tracker-credential').fill(token);
  await panel.getByRole('button',{name:'Connect Job Hunt',exact:true}).click();
  await panel.getByRole('alert').filter({hasText:'Other origins cannot receive tracker credentials'}).waitFor();
  await panel.locator('#tracker-origin').fill(tracker.origin);await panel.locator('#tracker-credential').fill(token);
  await panel.getByRole('button',{name:'Connect Job Hunt',exact:true}).click();
  await panel.getByText('Connected as '+user.email,{exact:true}).waitFor();await idle();
  await panel.locator('[data-tab=capture]').click();
  assert.match(await panel.locator('#fit-assess').getAttribute('class'),/primary/);
  assert.match(await panel.locator('#tracker-save').getAttribute('class'),/secondary/);
  await mkdir('artifacts',{recursive:true});await panel.locator('.capture-fit').screenshot({path:'artifacts/capture-flow-assess-only.png'});
  await panel.getByRole('button',{name:'Assess fit only',exact:true}).click();await panel.locator('.fit-result').waitFor();await idle();
  assert.equal(aiCalls,1);assert.equal(captures().length,0);
  assert.equal(JSON.parse(aiBodies[0].messages[1].content).resume,resumeText);
  assert.doesNotMatch(JSON.stringify(aiBodies[0]),/OTHER_VARIANT_PRIVATE_EVIDENCE|PRIVATE_GATEWAY_KEY/);
  assert.match(await panel.locator('.fit-result').innerText(),/Role fit: Strong/);
  assert.equal(await panel.locator('#tracker-save').isEnabled(),true);
  assert.match(await panel.locator('#tracker-save').getAttribute('class'),/secondary/);
  await panel.locator('.capture-evidence>summary').click();
  assert.equal(await panel.locator('.capture-evidence details').count(),0);
  assert.equal(await panel.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await mkdir('artifacts',{recursive:true});await panel.screenshot({path:'artifacts/capture-flow-review.png',fullPage:true});
  checks.push('real capture/review; distinct assess and save; full selected resume; zero upload during assessment; compact evidence');
  await panel.locator('#tracker-save').click();await panel.getByText('Saved to Job Hunt',{exact:true}).waitFor();await idle();
  assert.equal(aiCalls,1);assert.equal(captures().length,1);
  const uploaded=JSON.parse(captures()[0].body);
  assert.equal(uploaded.request_assessment,false);assert.equal(uploaded.extension_assessment.result.fit,'STRONG');
  assert.equal(uploaded.extension_assessment.resume.id,'resume-slot-1');
  assert.doesNotMatch(captures()[0].body,/FULL_RESUME_TAIL|OTHER_VARIANT_PRIVATE_EVIDENCE|PRIVATE_GATEWAY_KEY|"messages"/);
  checks.push('actual isolated tracker accepts completed fit; save does not call AI; upload excludes resume text and gateway key');

  await panel.evaluate(id=>{window.captureFlowActiveTab=id;},bId);await b.bringToFront();
  await panel.waitForFunction(()=>!document.querySelector('#capture-role_title'));
  await idle();await captureAndReview('Platform Engineer');
  await panel.locator('#fit-resume').selectOption('1');await idle();
  await panel.locator('#capture-description').fill((await panel.locator('#capture-description').inputValue())+'\n- REVIEW_EDIT_B');
  assert.equal(await panel.locator('.capture-completeness').isVisible(),true);
  assert.equal(await panel.locator('#fit-assess').isDisabled(),true);
  await panel.locator('#capture-completeness-confirmed').check();await panel.locator('#capture-confirm-completeness').click();await idle();
  aiMode='failure';await panel.locator('#fit-assess').click();await panel.locator('.fit-error').filter({hasText:'503'}).waitFor();await idle();
  assert.equal(await panel.locator('.fit-result').count(),0);assert.equal(await panel.locator('#tracker-save').isDisabled(),true);
  assert.equal(captures().length,1);
  aiMode='success';await panel.getByRole('button',{name:'Retry assessment only',exact:true}).click();await panel.locator('.fit-result').waitFor();await idle();
  assert.equal(JSON.parse(aiBodies.at(-1).messages[1].content).resume,state.resumes[1].text);
  const countBeforeSwitch=aiCalls;
  await switchTo(a,aId,'Support Engineer');assert.equal(await panel.locator('#fit-resume').inputValue(),'0');await panel.locator('.fit-result').waitFor();
  await switchTo(b,bId,'Platform Engineer');assert.equal(await panel.locator('#fit-resume').inputValue(),'1');await panel.locator('.fit-result').waitFor();
  assert.equal(aiCalls,countBeforeSwitch);
  checks.push('editing reopens review; failed assessment cannot save; explicit retry; independent tab/resume/result restoration');
  await panel.locator('#fit-resume').selectOption('0');await idle();
  assert.equal(await panel.locator('.fit-result').count(),0);
  aiMode='malformed';await panel.locator('#fit-assess').click();await panel.locator('.fit-error').filter({hasText:'valid report JSON'}).waitFor();await idle();
  assert.equal(await panel.locator('#tracker-save').isDisabled(),true);
  await panel.locator('#fit-resume').selectOption('1');await idle();await panel.locator('.fit-result').waitFor();
  await panel.locator('[data-tab=settings]').click();
  await panel.locator('#fit-preferences').fill('Prefer remote work with explicit requirements.');await panel.getByRole('button',{name:'Save notes',exact:true}).click();await idle();
  await panel.locator('[data-tab=capture]').click();assert.equal(await panel.locator('.fit-result').count(),0);
  aiMode='success';await panel.locator('#fit-assess').click();await panel.locator('.fit-result').waitFor();await idle();
  assert.deepEqual(JSON.parse(aiBodies.at(-1).messages[1].content).preferences,{notes:'Prefer remote work with explicit requirements.'});
  const beforeRetry=aiCalls;
  loseReceipt=true;await panel.locator('#tracker-save').click();await idle();
  const captureB=await activeCapture(bId);
  assert.equal(captures().length,2);
  await panel.waitForFunction(async id=>(await chrome.storage.local.get('capture-delivery:'+id))['capture-delivery:'+id]?.state==='uncertain',captureB.id);
  await panel.evaluate(async id=>{const key='capture-delivery:'+id,r=(await chrome.storage.local.get(key))[key];r.next_retry_at=null;await chrome.storage.local.set({[key]:r});},captureB.id);
  await panel.locator('[data-tab=settings]').click();await panel.getByRole('heading',{name:'Unfinished saves'}).waitFor();
  await panel.locator(`[data-delivery-send="${captureB.id}"]`).click();await idle();
  await panel.locator('[data-tab=capture]').click();await panel.getByText('Saved to Job Hunt',{exact:true}).waitFor();
  assert.equal(captures().length,2);assert.equal(aiCalls,beforeRetry);
  assert.ok(tracker.requests.some(r=>r.method==='GET' && r.url.includes('/api/v1/captures?ids='+captureB.id)));
  checks.push('malformed output rejected; preference edits invalidate fit; lost receipt recovered without duplicate POST or AI');
  const downloadEvent=panel.waitForEvent('download');await panel.locator('#capture-export').click();
  const exported=JSON.parse(await readFile(await (await downloadEvent).path(),'utf8'));
  assert.equal(exported.snapshot.candidates[0].source.rendered_text,captureB.snapshot.candidates[0].source.rendered_text);
  assert.doesNotMatch(JSON.stringify(exported),/FULL_RESUME_TAIL|OTHER_VARIANT_PRIVATE_EVIDENCE|PRIVATE_GATEWAY_KEY/);
  await panel.locator('#capture-clear').click();await idle();
  assert.equal(await panel.locator('#capture-role_title').count(),0);
  const remaining=await panel.evaluate(()=>chrome.storage.local.get(null));
  assert.equal(Object.keys(remaining).filter(k=>/^(posting-capture:|fit-job:|capture-delivery:)/.test(k)).length,0);
  assert.equal(remaining.state.resumes[0].text,resumeText);assert.equal(remaining['tracker-connection'].credential,token);
  assert.equal(remaining['fit-preferences'].notes,'Prefer remote work with explicit requirements.');
  const receipts=await fetch(tracker.origin+'/api/v1/captures?ids='+[captureA.id,captureB.id].join(','),{headers:{Authorization:'Bearer '+token}}).then(r=>r.json());
  assert.equal(receipts.captures.length,2);
  await panel.evaluate(id=>{window.captureFlowActiveTab=id;},linkedinId);await linkedin.bringToFront();await idle();
  await captureAndReview('AI Developer');
  assert.equal(await panel.locator('#capture-company_name').inputValue(),'Offshorly');
  assert.equal((await activeCapture(linkedinId)).snapshot.extractor_version,'posting-pilot-v9');
  assert.equal((await activeCapture(linkedinId)).posting.salary_min,70000);
  assert.equal((await activeCapture(linkedinId)).posting.salary_max,95000);
  assert.equal(aiCalls,beforeRetry);assert.equal(captures().length,2);
  checks.push('LinkedIn salary-heading fixture reaches reviewed AI Developer / Offshorly capture through real extension page injection without AI or upload');
  assert.deepEqual(external,[]);assert.deepEqual(pageErrors,[]);
  checks.push('immutable export; clear removes all local capture work while preserving resumes, connection, preferences and tracker records');
  console.log(JSON.stringify({status:'PASS',checks,ai_calls:aiCalls,capture_posts:captures().length,unexpected_external_requests:external.length,browser_errors:pageErrors.length,active_tab_reads:'controlled side-panel fixture with real tab events and page injection'},null,2));
} catch(error) {
  if(context){await mkdir('artifacts',{recursive:true});const panel=context.pages().find(p=>p.url().startsWith('chrome-extension:'));if(panel)await panel.screenshot({path:'artifacts/capture-flow-failure.png',fullPage:true}).catch(()=>{});}
  console.error('FAIL capture-flow:',error.message);throw error;
} finally {
  if(context)await context.close();if(tracker)await tracker.close();globalThis.fetch=originalFetch;
  assert.equal(await digestDirectory(liveBuild),before,'Installed build changed during isolated check');
  const target=resolve(temp);assert.equal(dirname(target),resolve(tmpdir()));assert.ok(basename(target).startsWith('job-hunt-capture-flow-'));
  await rm(target,{recursive:true,force:true});
  console.log('Installed build unchanged; isolated browser and temporary tracker storage closed.');
}
