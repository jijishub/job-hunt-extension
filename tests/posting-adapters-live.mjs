// Optional public checks. Never uses a signed-in profile, follows Apply or writes.
import { chromium } from '@playwright/test';
import { writeFile, mkdir } from 'node:fs/promises';
import { extractPosting } from '../src/posting-extractor.js';
const browser = await chromium.launch({ channel:'chromium',headless:true });
const report={ checked_on:new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'}),linkedin:null,cgi:null,authenticated_split_pane:'simulated only; no signed-in session inspected' };
const summary=s=>({extractor_version:s.extractor_version,candidates:s.candidates.map(c=>({adapter:c.adapter,title:c.posting.role_title,company:c.posting.company_name,location:c.posting.location,job_type:c.posting.job_type,work_model:c.posting.work_model,url:c.posting.job_url,requisition_id:c.source.requisition_id,rendered_chars:c.source.rendered_text.length,structured_chars:c.source.structured_text.length,qualification_items:c.posting.qualifications.length,warnings:c.warnings})),warnings:s.warnings});
try{
 const page=await browser.newPage();await page.route('**/*',r=>['POST','PUT','PATCH','DELETE'].includes(r.request().method())?r.abort():r.continue());
 try{
  const response=await page.goto('https://www.linkedin.com/jobs/view/4386923096/',{waitUntil:'domcontentloaded',timeout:30000});
  await page.locator('.description__text').first().waitFor({state:'attached',timeout:12000});
  const snapshot=await page.evaluate(extractPosting);
  report.linkedin={mode:'live public browser DOM',status:response.status(),...summary(snapshot)};
  if(!snapshot.candidates.length) report.linkedin.diagnostics=await page.evaluate(()=>({url:location.origin+location.pathname,headings:[...document.querySelectorAll('h1,.topcard__title')].map(n=>({text:n.textContent.trim(),class:n.className})),panes:[...document.querySelectorAll('.jobs-search__job-details--container,.jobs-search__job-details,.scaffold-layout__detail,.jobs-details,.job-view-layout')].map(n=>({class:n.className,id:n.getAttribute('data-job-id')})),descriptions:[...document.querySelectorAll('.description__text,.show-more-less-html__markup,#job-details')].map(n=>({class:n.className,chars:n.textContent.length,display:getComputedStyle(n).display,parent:n.parentElement.className})),canonical:document.querySelector('link[rel=canonical]')?.href}));
  if(!snapshot.candidates.some(c=>c.adapter==='linkedin-dom'&&c.posting.description.includes('Required qualifications')))process.exitCode=1;
 }catch(e){report.linkedin={error:e.message};process.exitCode=1;}
 await page.close();
 try{
  const url='https://cgi.njoyn.com/corp/xweb/xweb.asp?CLID=21001&page=jobdetails&JobID=J0326-1512&lang=1';
  const response=await fetch(url,{signal:AbortSignal.timeout(25000)}),html=await response.text();
  if(new URL(response.url).hostname!=='cgi.njoyn.com'||!html.includes('job-posting-content'))report.cgi={mode:'live HTTP GET',status:response.status,available:false,note:'Challenge or unavailable page; no bypass attempted.'};
  else{
   // Replay the actual fetched response, keeping posting markup and JSON-LD.
   // This checks the public response, not authenticated live browser behavior.
   const replay=await browser.newPage();
   const safe=await replay.evaluate(html=>{const d=new DOMParser().parseFromString(html,'text/html');d.querySelectorAll('script:not([type="application/ld+json"]),link,iframe').forEach(n=>n.remove());for(const n of d.querySelectorAll('*'))for(const a of [...n.attributes])if(a.name.startsWith('on'))n.removeAttribute(a.name);return d.documentElement.outerHTML;},html);
   await replay.route('**/*',r=>r.request().isNavigationRequest()?r.fulfill({contentType:'text/html',body:safe}):r.abort());await replay.goto(url);
   const snapshot=await replay.evaluate(extractPosting);report.cgi={mode:'live HTTP response replayed in isolated browser',status:response.status,...summary(snapshot)};
   if(!snapshot.candidates.some(c=>c.adapter==='cgi-njoyn-dom'&&c.posting.description.includes('Required qualifications')&&c.posting.qualifications.length>10))process.exitCode=1;
   await replay.close();
  }
 }catch(e){report.cgi={error:e.message};process.exitCode=1;}
 await mkdir('artifacts',{recursive:true});await writeFile('artifacts/posting-adapters-live.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}
