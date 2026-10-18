// Public-page check of the reported job with the actual built extension.
// Uses an isolated profile, no signed-in account, AI or tracker delivery.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
const profile=await mkdtemp(join(tmpdir(),'job-hunt-linkedin-current-'));
const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,args:[`--disable-extensions-except=${resolve('build')}`,`--load-extension=${resolve('build')}`]});
const report={job_id:'4475427660',mode:'Live public page, installed extension, isolated profile',signed_in_verified:false,ai_calls:0,tracker_uploads:0};
try{
 await context.route('**/*',r=>['POST','PUT','PATCH','DELETE'].includes(r.request().method())?r.abort():r.continue());
 const page=await context.newPage();
 const response=await page.goto('https://www.linkedin.com/jobs/view/4475427660/',{waitUntil:'domcontentloaded',timeout:30000});
 report.http_status=response.status();report.page=page.url();
 if(!response.ok())throw new Error(`LinkedIn returned HTTP ${response.status()}; no live posting DOM was verified.`);
 await page.locator('.description__text, #job-details, [data-testid="job-description"]').first().waitFor({state:'attached',timeout:15000});
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 const panel=await context.newPage();panel.setDefaultTimeout(15000);await panel.setViewportSize({width:390,height:1000});await panel.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);
 await panel.evaluate(async url=>{const tabs=await chrome.tabs.query({});const tab=tabs.find(t=>t.url===url);chrome.tabs.query=async()=>[await chrome.tabs.get(tab.id)]},page.url());
 await panel.locator('[data-tab=capture]').click();await panel.locator('#capture-posting').click();
 await panel.waitForFunction(()=>!document.querySelector('#capture-posting')?.disabled);
 const captures=await panel.evaluate(async()=>Object.entries(await chrome.storage.local.get(null)).filter(([k])=>k.startsWith('posting-capture:')).map(([,v])=>v));
 if(!captures.length){report.error=await panel.getByRole('alert').textContent();throw new Error(report.error)}
 const capture=captures[0],p=capture.posting,c=capture.snapshot.candidates[0];
 report.extractor_version=capture.snapshot.extractor_version;report.title=p.role_title;report.company=p.company_name;report.location=p.location;report.work_model=p.work_model;report.job_type=p.job_type;report.description_characters=p.description.length;report.warnings=[...capture.snapshot.warnings,...c.warnings].map(w=>w.code);
 assert.equal(p.role_title,'Automation Support Engineer ( Remote | Philippines)');assert.match(p.company_name,/magentIQ/i);assert.match(p.job_url,/4475427660/);
 for(const text of ['Key Responsibilities','Must-Have Qualifications','Nice-to-Have Skills','Reporting Line and Working Pattern','About MagentIQ'])assert.ok(p.description.includes(text),text);
 const items=await page.locator('.show-more-less-html__markup li, #job-details li').allTextContents();
 for(const text of items)assert.ok(p.description.replace(/\s+/g,' ').includes(text.replace(/\s+/g,' ').trim()),'All available list items retained');report.checked_list_items=items.length;
 assert.equal(await panel.locator('#capture-qualifications').count(),0);
 await mkdir('artifacts',{recursive:true});await panel.locator('#capture-role_title').evaluate(n=>n.scrollIntoView({block:'start'}));await panel.screenshot({path:'artifacts/linkedin-current-live-fields.png'});
 report.passed=true;
}catch(error){report.passed=false;report.error=error.message;process.exitCode=1}
finally{
 await mkdir('artifacts',{recursive:true});await writeFile('artifacts/linkedin-current-live.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await context.close();
 if(!profile.startsWith(join(tmpdir(),'job-hunt-linkedin-current-')))throw new Error('Unexpected temporary profile');await rm(profile,{recursive:true,force:true});
}
