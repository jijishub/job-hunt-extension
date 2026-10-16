import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';

// Optional live compatibility check. No identity, files, or application submission.
const browser = await chromium.launch({ channel: 'chromium', headless: true });
const page = await browser.newPage();
try {
  await page.goto('https://careers.shopee.sg/apply?id=J02192749&application_form_id=17&is_ats=true', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.locator('.shopee-select').first().waitFor();
  await page.waitForFunction(() => {
    const selects = [...document.querySelectorAll('.shopee-select')];
    return selects.length >= 9 && selects.every(el => el.querySelectorAll('.shopee-option').length >= 2);
  }, null, { timeout: 15000 });
  await page.route('**/*', route => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(route.request().method()) ? route.abort() : route.continue());
  await page.addScriptTag({ path: 'build/content.js' });
  const scan = await page.evaluate(() => window.__jobHuntFill.scan());
  const find = label => scan.fields.find(f => f.label === label);
  assert.ok(find('First Name')); assert.ok(find('Last Name')); assert.ok(find('Resume'));
  assert.equal(scan.fields.filter(f => f.type === 'custom-select').length >= 9, true);
  const answers = [['Current Location', 'Philippines'], ['Education Level', "Bachelor's Degree"], ['School', 'National University of Singapore'], ['Skills', 'Python\nSQL']].map(([label, value]) => ({ id: find(label).id, value }));
  const report = await page.evaluate(answers => window.__jobHuntFill.fill({ answers, overwrite: false, speed: 'instant' }), answers);
  assert.equal(report.filled, 4, JSON.stringify(report)); assert.deepEqual(report.errors, []);
  const selected = await page.locator('.shopee-select .shopee-selector').allInnerTexts();
  assert.ok(selected.includes('Philippines')); assert.ok(selected.includes("Bachelor's Degree"));
  assert.ok(selected.includes('National University of Singapore (NUS)')); assert.ok(selected.includes('Python\nSQL'));
  const keep = await page.evaluate(id => window.__jobHuntFill.fill({ answers: [{ id, value: 'Singapore' }], overwrite: false, speed: 'instant' }), find('Current Location').id);
  assert.equal(keep.skipped, 1);
  const change = await page.evaluate(id => window.__jobHuntFill.fill({ answers: [{ id, value: 'Singapore' }], overwrite: true, speed: 'instant' }), find('Current Location').id);
  assert.equal(change.filled, 1);
  const undo = await page.evaluate(() => window.__jobHuntFill.undo());
  assert.equal(undo.restored, 1); assert.deepEqual(undo.errors, []);
  assert.ok((await page.locator('.shopee-select .shopee-selector').allInnerTexts()).includes('Philippines'));
  assert.equal(await page.locator('.shopee-select .shopee-popper:visible').count(), 0);
  console.log('PASS: live Shopee labels, nine custom dropdowns, country, education, virtual school search, multiple skills, existing selection protection, overwrite and undo. No application submitted.');
} finally { await browser.close(); }
