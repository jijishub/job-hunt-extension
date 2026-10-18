// Offline extraction regressions only. No build, real login, AI or tracker calls.
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {extractPosting} from '../src/posting-extractor.js';
import {createCapture} from '../src/captures.js';
import {serializeCapture} from '../src/capture-transport.js';

const browser=await chromium.launch({channel:'chromium',headless:true});
const context=await browser.newContext();context.setDefaultTimeout(10000);
let cases=0;
async function fixture(name,url,change) {
  const html=await readFile(`tests/fixtures/postings/${name}.html`,'utf8');
  const page=await context.newPage();
  await page.route('**/*',r=>r.request().isNavigationRequest() && r.request().frame()===page.mainFrame()?r.fulfill({contentType:'text/html',body:html}):r.abort());
  await page.goto(url);if(change)await page.evaluate(change);
  return page;
}
const salaryFixture=change=>fixture('linkedin-salary-heading','https://www.linkedin.com/jobs/view/9876543210/',change);
try {
  const page=await salaryFixture();
  const capture=await page.evaluate(extractPosting),p=capture.candidates[0].posting;
  assert.equal(p.role_title,'AI Developer');assert.equal(p.company_name,'Offshorly');
  assert.equal(p.work_model,'REMOTE');assert.equal(p.job_type,'FULL_TIME');
  assert.match(p.description,/AI Developer \(LLM & API Focus\)/);assert.match(p.description,/- Python is required/);
  assert.doesNotMatch(p.description,/PREMIUM_|NEIGHBOR_|70K PHP/);
  assert.equal(await page.evaluate(()=>window.applied),undefined);cases++;
  await page.close();
  // h2 and prominent spans must reject salary too, not just an ARIA heading.
  for(const tag of ['h2','span']){
    const page=await salaryFixture();
    await page.evaluate(tag=>{const old=document.querySelector('.salary'),n=document.createElement(tag);n.className='salary';n.textContent=old.textContent;n.style.fontSize='32px';old.replaceWith(n);},tag);
    const r=await page.evaluate(extractPosting);assert.equal(r.candidates[0].posting.role_title,'AI Developer');assert.equal(r.candidates[0].posting.company_name,'Offshorly');cases++;await page.close();
  }
  const strong=await salaryFixture(()=>{const p=document.querySelector('.posting-title');p.outerHTML='<strong class="posting-title">AI Developer</strong>';document.querySelector('.salary').removeAttribute('role');document.querySelector('.salary').style.fontSize='32px';});
  assert.equal((await strong.evaluate(extractPosting)).candidates[0].posting.role_title,'AI Developer');cases++;await strong.close();
  for(const salary of ['70K PHP/month - 95K PHP/month','PHP 70,000 - PHP 95,000','₱70,000 - ₱95,000','USD 35/hour','EUR 70.000 per year']){
    const page=await salaryFixture(()=>document.querySelector('.posting-title').remove());
    await page.locator('.salary').evaluate((n,text)=>{n.textContent=text;},salary);
    const r=await page.evaluate(extractPosting);assert.equal(r.candidates[0].posting.role_title,null);
    assert.equal(r.candidates[0].posting.company_name,'Offshorly');
    const request=await serializeCapture(createCapture(r));assert.ok(request.assessment.reasons.includes('missing_role_title'));cases++;await page.close();
  }
  for(const title of ['PHP Developer','PHP 8 Developer','PHP Developer (100% Remote)','Compensation Analyst']){
    const page=await salaryFixture();await page.locator('.posting-title').evaluate((n,text)=>{n.textContent=text;},title);
    assert.equal((await page.evaluate(extractPosting)).candidates[0].posting.role_title,title);cases++;await page.close();
  }
  for(const [name,id,title] of [['linkedin-metadata-card','4475427660','Automation Support Engineer ( Remote | Philippines)'],['linkedin-semantic-detail','4475878761','Backend Developer']]){
    const page=await fixture(name,`https://www.linkedin.com/jobs/view/${id}/`);
    assert.equal((await page.evaluate(extractPosting)).candidates[0].posting.role_title,title);cases++;await page.close();
  }
  const missing=await fixture('linkedin-missing-title','https://www.linkedin.com/jobs/view/4475426687/');
  assert.equal((await missing.evaluate(extractPosting)).candidates[0].posting.role_title,null);cases++;await missing.close();
  const split=await fixture('linkedin-split','https://www.linkedin.com/jobs/search/?currentJobId=111');
  const a=await split.evaluate(extractPosting);assert.equal(a.candidates[0].posting.role_title,'Selected Support Engineer');
  await split.locator('#select-b').click();const b=await split.evaluate(extractPosting);assert.equal(b.candidates[0].source.requisition_id,'222');assert.match(b.candidates[0].posting.description,/B_ONLY/);assert.doesNotMatch(b.candidates[0].posting.description,/INITIAL_A_ONLY/);cases++;
  await split.locator('#stuck').click();const stale=await split.evaluate(extractPosting,{waitMs:900});assert.equal(stale.candidates.length,0);cases++;
  console.log(JSON.stringify({status:'PASS',cases,coverage:'salary heading/span exclusion; scoped company; paragraph/strong titles; PHP developer titles; missing-title blocker; existing layouts; selected-pane changes and stale body rejection',live_signed_in_dom_verified:false,installed_build_modified:false}));
} finally {await context.close();await browser.close();}
