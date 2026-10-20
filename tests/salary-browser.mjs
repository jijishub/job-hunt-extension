import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { build } from 'vite';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractPosting } from '../src/posting-extractor.js';
import { extractSalaries } from '../src/salary-extractor.js';
import { defaults } from '../src/core.js';

const temp = await mkdtemp(join(tmpdir(),'job-hunt-salary-'));
let context, panel;
try {
  const outDir = join(temp,'extension');
  await build({build:{outDir,emptyOutDir:true},logLevel:'error'});
  context = await chromium.launchPersistentContext(join(temp,'profile'),{channel:'chromium',headless:true,args:[`--disable-extensions-except=${outDir}`,`--load-extension=${outDir}`]});
  let aiCalls = 0;
  const errors = [];
  await context.route('**/*',route => {
    if (route.request().url().startsWith('chrome-extension:')) return route.continue();
    if (route.request().url() === 'http://127.0.0.1:9876/v1/chat/completions') {
      aiCalls++;
      assert.doesNotMatch(route.request().postData(),/PRIVATE_PROFILE|PRIVATE_RESUME|NEIGHBOR_SALARY/);
      return route.fulfill({contentType:'application/json',body:JSON.stringify({choices:[{message:{content:JSON.stringify({salary_min:30000,salary_max:45000,salary_currency:'PHP',salary_period:'MONTH',quote:'Base salary is between PHP 30000 and PHP 45000 monthly'})}}]})});
    }
    return route.abort();
  });
  const fixture = async (url,html) => {
    const page = await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',r=>r.request().isNavigationRequest()?r.fulfill({contentType:'text/html; charset=utf-8',body:html}):r.abort());
    await page.goto(url);return page;
  };
  const linkedin = await fixture('https://www.linkedin.com/jobs/view/9876543210/',await readFile('tests/fixtures/postings/linkedin-salary-heading.html','utf8'));
  const li = extractSalaries(await linkedin.evaluate(extractPosting));
  assert.equal(li.candidates[0].posting.salary_min,70000);assert.equal(li.candidates[0].posting.salary_max,95000);
  const jobstreet = await fixture('https://ph.jobstreet.com/job/12345678',`<aside data-automation="job-card"><h1>Neighbor</h1><p>NEIGHBOR_SALARY PHP 999000 monthly</p></aside><main data-automation="jobDetailsPage" data-job-id="12345678"><h1 data-automation="job-detail-title">Engineer</h1><a data-automation="advertiser-name">Example</a><span data-automation="job-detail-location">Manila</span><span data-automation="job-detail-salary">₱30,000 – ₱45,000 per month</span><div data-automation="jobAdDetails"><p>Build services with JavaScript.</p></div><div hidden data-automation="job-detail-salary">PHP 999999 monthly</div></main>`);
  const js = extractSalaries(await jobstreet.evaluate(extractPosting));
  assert.equal(js.candidates[0].posting.salary_min,30000);assert.equal(js.candidates[0].posting.salary_max,45000);assert.equal(js.candidates[0].posting.job_platform,'JOBSTREET');
  assert.doesNotMatch(JSON.stringify(js.candidates),/NEIGHBOR_SALARY|999999/);
  const indeed = await fixture('https://ph.indeed.com/jobs?vjk=abc123',`<aside>NEIGHBOR_SALARY PHP 999000 monthly</aside><div id="jobsearch-ViewjobPaneWrapper" data-job-id="abc123"><h1 class="jobsearch-JobInfoHeader-title">Engineer</h1><span data-testid="inlineHeader-companyName">Example</span><div id="salaryInfoAndJobType">From ₱30,000 monthly</div><div id="jobDescriptionText"><p>Build services with JavaScript.</p></div></div><script type="application/ld+json">{"@type":"JobPosting","title":"Neighbor","url":"https://ph.indeed.com/viewjob?jk=neighbor","baseSalary":{"currency":"PHP","value":999000}}</script>`);
  const ind = extractSalaries(await indeed.evaluate(extractPosting));
  assert.equal(ind.candidates.length,1);assert.equal(ind.candidates[0].posting.salary_min,30000);assert.equal(ind.candidates[0].posting.salary_max,null);assert.equal(ind.candidates[0].posting.job_platform,'INDEED');
  await indeed.evaluate(()=>{history.replaceState({},'','/jobs?vjk=next456');document.querySelector('#jobsearch-ViewjobPaneWrapper').dataset.jobId='next456';document.querySelector('h1').textContent='Another Engineer';});
  assert.equal((await indeed.evaluate(extractPosting,{waitMs:800})).candidates.length,0,'Previously selected description must not be reused');

  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  panel = await context.newPage();panel.on('pageerror',e=>errors.push(e.message));panel.setDefaultTimeout(30000);
  await panel.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);
  await panel.evaluate(async state=>chrome.storage.local.set({state}),{...structuredClone(defaults),profile:{facts:'PRIVATE_PROFILE'},resumes:[{name:'Resume',text:'PRIVATE_RESUME'},null,null],settings:{...defaults.settings,baseUrl:'http://127.0.0.1:9876/v1',apiKey:'MOCK_KEY',model:'test'}});
  await panel.reload();
  await linkedin.evaluate(()=>document.querySelector('.salary').textContent='Base salary is between PHP 30000 and PHP 45000 monthly');
  await panel.evaluate(async url=>{const all = await chrome.tabs.query({});const tab = all.find(t=>t.url===url);chrome.tabs.query=async()=>[await chrome.tabs.get(tab.id)];},linkedin.url());
  await panel.locator('[data-tab=capture]').click();
  await panel.locator('#capture-posting').click();await panel.locator('#capture-salary-ai').waitFor();
  assert.equal(aiCalls,0,'Capture does not call AI automatically');
  await panel.locator('#capture-salary-ai').click();
  await panel.locator('#capture-salary-suggestion').filter({hasText:'AI suggestion from:'}).waitFor();
  assert.equal(aiCalls,1);assert.equal(await panel.locator('#capture-salary_min').inputValue(),'30000');assert.equal(await panel.locator('#capture-salary_max').inputValue(),'45000');
  assert.match(await panel.locator('.capture-status').textContent(),/Unsaved changes/);
  assert.equal(await panel.locator('#fit-assess').isDisabled(),true);
  await panel.locator('#capture-completeness-confirmed').check();await panel.locator('#capture-confirm-completeness').click();
  await panel.locator('.capture-status').filter({hasText:'Reviewed'}).waitFor();
  const saved = await panel.evaluate(async()=>Object.entries(await chrome.storage.local.get(null)).filter(([k])=>k.startsWith('posting-capture:')).map(([,v])=>v));
  assert.equal(saved[0].posting.salary_min,30000);assert.equal(saved[0].posting.salary_max,45000);assert.ok(saved[0].corrections.salary_min);assert.equal(aiCalls,1);
  assert.deepEqual(errors,[]);
  console.log('PASS: LinkedIn/JobStreet/Indeed salary capture, selected-pane isolation, hidden salary exclusion, stale description rejection, AI excerpt privacy, real extension AI draft and review/save. Live authenticated layouts not verified.');
} catch (error) {
  if (panel) console.error('Salary browser failure:', await panel.locator('body').innerText());
  throw error;
} finally {
  await context?.close();
  if (!temp.startsWith(join(tmpdir(),'job-hunt-salary-'))) throw new Error('Unexpected temporary salary-test directory');
  await rm(temp,{recursive:true,force:true,maxRetries:10,retryDelay:200});
}
