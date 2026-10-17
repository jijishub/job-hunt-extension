import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { defaults } from '../src/core.js';
import { reviewedCapture, settings, result } from './helpers/fit-fixture.js';
import { localTracker } from './helpers/local-tracker.js';

const profile = await mkdtemp(join(tmpdir(), 'job-hunt-role-fit-'));
const tracker = await localTracker();
const user = await tracker.db.getOrCreateUser({ name: 'Browser test', email: 'browser-fit@example.invalid' });
const token = (await tracker.store.issueExtensionCredential(user.id, 'Browser test')).token;
const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
  args: [`--disable-extensions-except=${resolve('build')}`, `--load-extension=${resolve('build')}`] });
let mode = 'success', aiCalls = 0; const sent = [], external = [], errors = [];
await context.route('**/*', async route => {
  const url = route.request().url();
  if (url.startsWith('chrome-extension:') || url.startsWith(tracker.origin + '/')) return route.continue();
  if (url === settings.baseUrl + '/chat/completions') {
    aiCalls++; sent.push(JSON.parse(route.request().postData()));
    if (mode === 'failure') return route.fulfill({ status: 503, body: 'Synthetic provider unavailable' });
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: mode === 'malformed' ? '{broken' : JSON.stringify(result) } }] }) });
  }
  external.push(url); return route.abort();
});
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const panel = await context.newPage(); panel.on('pageerror', e => errors.push(e.message)); panel.setDefaultTimeout(15000);
  await panel.setViewportSize({ width: 340, height: 1000 });
  const pageURL = `chrome-extension://${new URL(worker.url()).hostname}/index.html`;
  await panel.goto(pageURL);
  const capture = await reviewedCapture('https://jobs.lever.co/example/browser-fit');
  const state = structuredClone(defaults); state.settings = settings;
  const completeText = 'Selected support evidence. '.repeat(1100) + 'FULL_RESUME_TAIL';
  state.resumes = [{ name: 'Support resume', text: completeText }, { name: 'Engineering resume', text: 'OTHER_VARIANT_PRIVATE_EVIDENCE' }, null];
  await panel.evaluate(async ({ state, capture }) => chrome.storage.local.set({ state, ['posting-capture:' + capture.id]: capture }), { state, capture });
  await panel.reload(); await panel.locator('[data-tab=capture]').click();
  await panel.locator('#fit-assess').click(); await panel.locator('.fit-result').waitFor();
  assert.equal(aiCalls, 1); assert.equal(JSON.parse(sent[0].messages[1].content).resume, completeText);
  assert.doesNotMatch(JSON.stringify(sent[0]), /OTHER_VARIANT_PRIVATE_EVIDENCE|PRIVATE_GATEWAY_KEY/);
  await panel.locator('#capture-prepare').click(); await panel.locator('.capture-transport').waitFor();
  const download = panel.waitForEvent('download'); await panel.locator('#capture-transport-export').click();
  const prepared = JSON.parse(await readFile(await (await download).path(), 'utf8'));
  assert.equal(prepared.extension_assessment.resume.id, 'resume-slot-1'); assert.equal(prepared.request_assessment, false);
  assert.doesNotMatch(JSON.stringify(prepared), /FULL_RESUME_TAIL|OTHER_VARIANT_PRIVATE_EVIDENCE|PRIVATE_GATEWAY_KEY|"messages"/);
  await panel.locator('#fit-resume').selectOption('1'); await panel.getByText('Unassessed for the current inputs.', { exact: false }).waitFor();
  assert.equal(await panel.locator('.capture-transport').count(), 0);
  await panel.locator('#fit-assess').click(); await panel.locator('.fit-result').waitFor(); assert.equal(aiCalls, 2);
  assert.equal(JSON.parse(sent[1].messages[1].content).resume, 'OTHER_VARIANT_PRIVATE_EVIDENCE');
  mode = 'failure'; await panel.locator('#fit-assess').click();
  await panel.locator('.fit-error').filter({ hasText: 'Role-fit gateway returned 503.' }).waitFor();
  assert.equal(await panel.locator('.fit-result').count(), 1, 'failed new attempt keeps matching last success');
  await panel.locator('#fit-unassessed').click(); await panel.locator('.capture-transport').waitFor();
  assert.doesNotMatch(await panel.locator('.capture-transport pre').textContent(), /extension_assessment/);
  mode = 'malformed'; await panel.locator('#fit-assess').click(); await panel.locator('.fit-error').filter({ hasText: 'The role-fit gateway did not return valid report JSON.' }).waitFor();
  assert.equal(await panel.locator('.fit-result').count(), 1);
  const before = aiCalls;
  await panel.reload(); await panel.locator('[data-tab=capture]').click(); await panel.locator('.fit-result').waitFor(); assert.equal(aiCalls, before);
  await panel.locator('#capture-description').fill(capture.posting.description + '\nA newly required credential.');
  assert.equal(await panel.locator('.fit-result').count(), 0); assert.equal(await panel.locator('.capture-transport').count(), 0);
  assert.equal(await panel.locator('#capture-reviewed').isChecked(), false);
  // Discard unsaved review edits by reopening; the saved immutable source is untouched.
  await panel.reload(); await panel.locator('[data-tab=capture]').click(); await panel.locator('.fit-result').waitFor();
  await panel.locator('#fit-preferences').fill('Remote work. Salary must specify currency and period.');
  assert.equal(await panel.locator('.fit-result').count(), 0);
  await panel.getByRole('button', { name: 'Save preferences locally' }).click();
  mode = 'success'; await panel.locator('#fit-assess').click(); await panel.locator('.fit-result').waitFor();
  assert.deepEqual(JSON.parse(sent.at(-1).messages[1].content).preferences, { notes: 'Remote work. Salary must specify currency and period.' });
  // Explicit comparison queues both variants; the intended selection remains version 2.
  await panel.locator('#fit-compare').click(); await panel.locator('#fit-compare:not([disabled])').waitFor();
  assert.equal(aiCalls, before + 3); assert.equal(await panel.locator('#fit-resume').inputValue(), '1');
  await panel.locator('#capture-prepare').click(); await panel.locator('.capture-transport').waitFor();
  assert.match(await panel.locator('.capture-transport pre').textContent(), /"id":"resume-slot-2"/);
  await panel.locator('#tracker-origin').fill('https://jobhunt.jizellecasia.site'); await panel.locator('#tracker-credential').fill(token);
  await panel.getByRole('button', { name: 'Verify local connection' }).click();
  await panel.getByRole('alert').filter({ hasText: 'Production uploads are disabled' }).waitFor();
  await panel.locator('#tracker-origin').fill(tracker.origin); await panel.locator('#tracker-credential').fill(token);
  await panel.getByRole('button', { name: 'Verify local connection' }).click();
  await panel.getByText('Verified for local testing', { exact: false }).waitFor();
  await panel.locator('#tracker-freeze').click(); await panel.getByRole('heading', { name: 'Delivery ' + capture.id, exact: true }).waitFor();
  const beforeDelivery = aiCalls;
  await panel.locator('[data-delivery-send]').click(); await panel.getByText('Extension fit applied to the new lead.', { exact: true }).waitFor();
  assert.equal(aiCalls, beforeDelivery);
  const snapshot = await panel.evaluate(async () => chrome.storage.local.get(null));
  assert.equal(snapshot['posting-capture:' + capture.id].snapshot.candidates[0].source.rendered_text, capture.snapshot.candidates[0].source.rendered_text);
  assert.equal(snapshot['capture-delivery:' + capture.id].state, 'delivered');
  assert.doesNotMatch(snapshot['capture-delivery:' + capture.id].body, /FULL_RESUME_TAIL|OTHER_VARIANT_PRIVATE_EVIDENCE|PRIVATE_GATEWAY_KEY/);
  const overflow = await panel.evaluate(() => document.documentElement.scrollWidth > innerWidth); assert.equal(overflow, false);
  await panel.locator('[data-tab=settings]').click(); panel.once('dialog', d => d.accept()); await panel.locator('#reset').click();
  await panel.getByText('All local data deleted.', { exact: true }).waitFor();
  assert.equal(await panel.evaluate(async () => Object.keys(await chrome.storage.local.get(null)).filter(k => /^(fit-job:|fit-preferences|capture-delivery:|tracker-connection|posting-capture:)/.test(k)).length), 0);
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log('PASS installed extension fit UI: full selected resume, variant switching, failures/malformed reports, matching success retention, reopen, review/preference invalidation, explicit comparison, private offline exports, production block, actual local tracker delivery, no delivery AI, narrow panel and deletion.');
} catch (error) {
  const page = context.pages().find(p => p.url().startsWith('chrome-extension:'));
  console.error('Fit browser failure:', page && await page.locator('body').innerText().then(t => t.slice(-4500)), 'AI calls:', aiCalls, 'page errors:', errors);
  throw error;
} finally {
  await context.close(); await tracker.close();
  if (!profile.startsWith(join(tmpdir(), 'job-hunt-role-fit-'))) throw new Error('Unexpected temporary profile directory');
  await rm(profile, { recursive: true, force: true });
}
