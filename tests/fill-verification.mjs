import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { localAnswer } from '../src/core.js';

const browser = await chromium.launch({ channel: 'chromium', headless: true });
try {
  const page = await browser.newPage();
  await page.setContent(`<form>
    <label>Short answer<input id="short" maxlength="5" value="Keep"></label>
    <label>Minimum length<input id="minimum" minlength="4" value="Keep"></label>
    <label>Start date<input id="date" type="date" value="2026-10-01"></label>
    <label>Years<input id="years" type="number" min="0" max="10" value="2"></label>
    <label>Validated answer<input id="rejected" value="Original"></label>
    <label>Accepted answer<textarea id="accepted"></textarea></label>
    <label>Country<select id="country"><option value="PH">Philippines</option><option value="SG">Singapore</option></select></label>
    <fieldset><legend>Employer details</legend><label>City<input id="employer-city" autocomplete="address-level2"></label></fieldset>
    <fieldset><legend>References</legend><label>Phone<input id="reference-phone"></label></fieldset>
    <button>Submit</button></form>`);
  await page.evaluate(() => {
    window.submitted = false;
    document.querySelector('form').onsubmit = e => { e.preventDefault(); window.submitted = true; };
    document.querySelector('#rejected').oninput = e => { setTimeout(() => { e.target.value = 'Original'; }, 80); };
  });
  await page.addScriptTag({ path: 'build/content.js' });
  const scan = await page.evaluate(() => window.__jobHuntFill.scan());
  assert.equal(scan.fields.find(f => f.label === 'Short answer').maxLength, 5);
  assert.equal(localAnswer(scan.fields.find(f => /Employer details/.test(f.label)), { city: 'Manila' }), '');
  assert.equal(localAnswer(scan.fields.find(f => /References/.test(f.label)), { phone: '12345' }), '');
  const fill = pairs => page.evaluate(payload => window.__jobHuntFill.fill(payload), {
    speed: 'instant', overwrite: true,
    answers: pairs.map(([label, value]) => ({ id: scan.fields.find(f => f.label === label).id, value }))
  });
  const report = await fill([
    ['Short answer', 'Too long'], ['Minimum length', 'Hi'], ['Start date', 'October 17, 2026'], ['Years', '20'],
    ['Validated answer', 'Rejected change'], ['Accepted answer', 'Line one\nLine two'], ['Country', 'Singapore']
  ]);
  assert.equal(report.filled, 2);
  assert.equal(report.manual, 4, 'length, date format and range require correction before mutation');
  assert.equal(report.rejected, 1, 'asynchronous site rejection is not counted as filled');
  assert.equal(await page.locator('#short').inputValue(), 'Keep');
  assert.equal(await page.locator('#date').inputValue(), '2026-10-01');
  assert.equal(await page.locator('#years').inputValue(), '2');
  assert.equal(await page.locator('#rejected').inputValue(), 'Original');
  assert.equal(await page.locator('#accepted').inputValue(), 'Line one\nLine two');
  assert.equal(await page.locator('#country').inputValue(), 'SG');
  assert.equal(report.results.filter(r => r.status === 'filled').length, 2);
  await page.evaluate(() => window.__jobHuntFill.undo());
  assert.equal(await page.locator('#accepted').inputValue(), '');
  assert.equal(await page.locator('#country').inputValue(), 'PH');
  const validDate = await fill([['Start date', '2026-10-17']]);
  assert.equal(validDate.filled, 1);
  assert.equal(await page.locator('#date').inputValue(), '2026-10-17');
  assert.equal(await page.evaluate(() => window.submitted), false);
  console.log('PASS: retained-value verification, asynchronous rejection, length/date/range preflight, separate result statuses, select label/value handling, undo and no submission.');
} finally { await browser.close(); }
