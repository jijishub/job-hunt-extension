// Optional public-page read check. No profile, credentials, form filling or AI.
import { chromium } from '@playwright/test';
import { extractPosting } from '../src/posting-extractor.js';
const samples = [
  ['greenhouse-dom', 'https://job-boards.greenhouse.io/anthropic/jobs/4461450008'],
  ['lever-dom', 'https://jobs.lever.co/spotify/2517cbbf-5640-4467-a3ae-08577e76bead'],
  [null, 'https://careers.shopee.sg/apply?id=J02192749&application_form_id=17&is_ats=true']
];
const browser = await chromium.launch({ channel: 'chromium', headless: true });
try {
  for (const [expected, url] of samples) {
    const page = await browser.newPage();
    try {
      await page.route('**/*', route => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(route.request().method()) ? route.abort() : route.continue());
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      if (expected === 'greenhouse-dom') await page.locator('.job__description, #content').first().waitFor();
      if (expected === 'lever-dom') await page.locator('.posting-headline').waitFor();
      if (expected === null) await page.locator('input').first().waitFor({ state: 'attached' });
      const snapshot = await page.evaluate(extractPosting);
      const match = expected ? snapshot.candidates.find(c => c.adapter === expected && c.posting.description.length > 100) : !snapshot.candidates.length;
      console.log(JSON.stringify({ url, matched_expected_layout: Boolean(match), candidates: snapshot.candidates.map(c => ({
        adapter: c.adapter, title: c.posting.role_title, description_chars: c.posting.description.length,
        structured_chars: c.source.structured_text.length, warnings: c.warnings
      })), warnings: snapshot.warnings }, null, 2));
      if (!match) process.exitCode = 1;
    } catch (error) { console.error(url, error.message); process.exitCode = 1; }
    finally { await page.close(); }
  }
} finally { await browser.close(); }
