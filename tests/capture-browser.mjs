import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { extractPosting } from '../src/posting-extractor.js';

const profile = await mkdtemp(join(tmpdir(), 'job-hunt-capture-'));
const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
  args: [`--disable-extensions-except=${resolve('build')}`, `--load-extension=${resolve('build')}`] });
const samples = {
  greenhouse: { url: 'https://job-boards.greenhouse.io/anthropic/jobs/4461450008?gh_src=pilot#posting', html: await readFile('tests/fixtures/postings/greenhouse.html', 'utf8') },
  lever: { url: 'https://jobs.lever.co/spotify/2517cbbf-5640-4467-a3ae-08577e76bead', html: await readFile('tests/fixtures/postings/lever.html', 'utf8') }
};
const schema = data => `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
const job = { '@type': 'JobPosting', title: 'Support Engineer', hiringOrganization: { name: 'Example' }, description: '<h2>Requirements</h2><ul><li>Two years of support experience.</li><li>JavaScript and SQL skills.</li></ul>', baseSalary: { currency: 'USD', value: { minValue: 40000, maxValue: 60000, unitText: 'YEAR' } }, owner: 'never-import-this-owner', status: 'APPLIED', role_fit: 'STRONG', first_response_at: '2026-10-18' };
let externalRequests = [];
// Every page is an offline fixture. Capture and export must not make any network requests.
await context.route('**/*', route => {
  if (route.request().url().startsWith('chrome-extension:')) return route.continue();
  externalRequests.push(route.request().url()); return route.abort();
});
context.setDefaultTimeout(10000);
async function fixturePage(url, html) {
  const page = await context.newPage();
  await page.route('**/*', route => route.request().isNavigationRequest() && route.request().frame() === page.mainFrame() ? route.fulfill({ contentType: 'text/html', body: html }) : route.abort());
  await page.goto(url);
  return page;
}
try {
  const gh = await fixturePage(samples.greenhouse.url, samples.greenhouse.html);
  const greenhouse = await gh.evaluate(extractPosting);
  assert.equal(greenhouse.candidates.length, 1);
  const g = greenhouse.candidates[0];
  assert.equal(g.adapter, 'greenhouse-dom'); assert.equal(g.posting.company_name, 'Anthropic');
  assert.equal(g.adapter_version, '1'); assert.equal(g.source.employer_key, 'job-boards.greenhouse.io/anthropic');
  assert.equal(g.posting.role_title, 'Account Executive, AI Native');
  assert.match(g.posting.location, /New York City/);
  assert.match(g.posting.description, /Responsibilities:/);
  assert.match(g.posting.description, /You may be a good fit if you have:/);
  assert.match(g.posting.description, /Logistics/);
  assert.doesNotMatch(g.posting.description, /Voluntary Self-Identification|First Name/);
  assert.equal(g.posting.job_url, samples.greenhouse.url, 'query and fragment are preserved');
  assert.equal(g.posting.job_type, null); assert.equal(g.posting.work_model, null);
  console.log(`PASS Greenhouse saved posting: ${g.posting.description.length} description characters; role/company and requirements retained.`);

  const leverPage = await fixturePage(samples.lever.url, samples.lever.html);
  const lever = await leverPage.evaluate(extractPosting), l = lever.candidates[0];
  assert.equal(lever.candidates.length, 1, 'matching DOM/JSON-LD are combined');
  assert.equal(l.adapter, 'lever-dom'); assert.equal(l.posting.company_name, 'Spotify');
  assert.equal(l.source.employer_key, 'jobs.lever.co/spotify');
  assert.equal(l.posting.work_model, 'HYBRID');
  assert.equal(l.posting.job_type, null, 'Permanent is not assumed to mean full time');
  assert.match(l.posting.description, /English and German language fluency, spoken and written is required/);
  assert.match(l.source.structured_text, /English and German language fluency/);
  assert.match(l.posting.description, /2-3 times per week/);
  for (const [page, candidate] of [[gh, g], [leverPage, l]]) {
    const requirements = await page.locator(page === gh ? '.job__description li' : '.content .section-wrapper li').allTextContents();
    const normalized = candidate.posting.description.replace(/\s+/g, ' ');
    for (const requirement of requirements) assert.ok(normalized.includes(requirement.replace(/\s+/g, ' ').trim()), `Requirement omitted: ${requirement}`);
  }
  assert.ok(l.warnings.some(w => w.code === 'conflicting_sources' && w.field === 'description'));
  console.log(`PASS Lever saved posting: ${l.posting.description.length} rendered and ${l.source.structured_text.length} structured characters; language and attendance requirements retained.`);

  const jsonPage = await fixturePage('https://employer.example/jobs?id=42', schema({ '@graph': [job] }));
  const structured = await jsonPage.evaluate(extractPosting), j = structured.candidates[0];
  assert.equal(j.posting.salary_currency, 'USD'); assert.equal(j.source.salary_period, 'YEAR');
  assert.equal(j.posting.salary_min, 40000); assert.equal(j.posting.seniority_level, null); assert.equal(j.posting.first_response_at, null);
  assert.equal(j.posting.owner, undefined); assert.equal(j.posting.status, undefined); assert.equal(j.posting.role_fit, undefined);
  assert.doesNotMatch(j.source.structured_data, /never-import-this-owner/);
  assert.match(j.posting.description, /- Two years/); assert.ok(j.warnings.some(w => w.code === 'structured_only'));
  await jsonPage.setContent(schema([job, { ...job, title: 'Different opening' }]));
  assert.equal((await jsonPage.evaluate(extractPosting)).candidates.length, 2);
  await jsonPage.setContent('<script type="application/ld+json">broken</script><h1>Role</h1><div class="job-description"><h2>Requirements</h2><p>SQL experience</p><details><summary>More</summary>Hidden requirements</details><input value="PRIVATE_CANDIDATE"><form>PRIVATE_FORM<textarea>PRIVATE_RESUME</textarea></form></div>');
  const generic = await jsonPage.evaluate(extractPosting);
  assert.ok(generic.warnings.some(w => w.code === 'malformed_structured_data'));
  assert.ok(generic.candidates[0].warnings.some(w => w.code === 'collapsed_content'));
  assert.ok(generic.candidates[0].warnings.some(w => w.code === 'unverified_layout'));
  assert.doesNotMatch(generic.candidates[0].posting.description, /PRIVATE/);
  await jsonPage.setContent('<h1>Application</h1><form>Personal Information<input value="private"><textarea>Resume text</textarea></form>');
  assert.equal((await jsonPage.evaluate(extractPosting)).candidates.length, 0);
  await jsonPage.setContent('<h1>News article</h1><main>Unrelated text</main>');
  assert.equal((await jsonPage.evaluate(extractPosting)).candidates.length, 0);
  await jsonPage.setContent(schema({ ...job, description: 'Requirements '.repeat(11000) }));
  const oversized = await jsonPage.evaluate(extractPosting);
  assert.equal(oversized.candidates[0].posting.description.length, 120000);
  assert.ok(oversized.warnings.some(w => w.code === 'source_truncated'));
  await jsonPage.setContent(schema({ ...job, employmentType: 'Permanent', qualifications: [{ experience: 'Unmapped requirement' }] }) + '<iframe srcdoc="Frame requirements"></iframe>');
  const unsupported = await jsonPage.evaluate(extractPosting);
  assert.ok(unsupported.warnings.some(w => w.code === 'frames_not_read'));
  assert.ok(unsupported.candidates[0].warnings.some(w => w.code === 'unsupported_employment_type'));
  assert.ok(unsupported.candidates[0].warnings.some(w => w.code === 'unsupported_qualifications'));
  await jsonPage.setContent('<script type="application/ld+json">' + ' '.repeat(250001) + '</script>' + schema(job));
  assert.ok((await jsonPage.evaluate(extractPosting)).warnings.some(w => w.code === 'structured_block_skipped'));
  await jsonPage.setContent(schema(job) + schema({}).repeat(20));
  assert.ok((await jsonPage.evaluate(extractPosting)).warnings.some(w => w.code === 'extraction_limit_reached'));
  console.log('PASS generic JSON-LD, multiple postings, malformed data, collapsed content, text limits, unrelated pages and form-data exclusion.');

  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).hostname;
  const panel = await context.newPage(), errors = [];
  panel.on('pageerror', e => errors.push(e.message));
  await panel.setViewportSize({ width: 340, height: 1000 });
  await panel.goto(`chrome-extension://${extensionId}/index.html`);
  const target = async page => panel.evaluate(async url => {
    window.realTabsQuery ||= chrome.tabs.query.bind(chrome.tabs);
    const all = await window.realTabsQuery({});
    const tab = all.find(t => t.url === url);
    window.captureTarget = tab.id;
    chrome.tabs.query = async () => [await chrome.tabs.get(window.captureTarget)];
  }, page.url());
  await target(gh);
  await panel.locator('[data-tab=capture]').click();
  await panel.getByRole('button', { name: 'Capture current posting', exact: true }).click();
  await panel.getByRole('heading', { name: 'Posting preview', exact: true }).waitFor();
  assert.equal(await panel.locator('#capture-role_title').inputValue(), 'Account Executive, AI Native');
  assert.match(await panel.locator('.capture-warnings').innerText(), /Completeness is unverified/);
  const originalSource = await panel.locator('.capture-source pre').first().innerText();
  await panel.locator('#capture-role_title').fill('Corrected title <script>window.injected=true</script>');
  await panel.locator('#capture-description').fill('Corrected requirements: SQL experience and customer support skills.');
  await panel.locator('#capture-reviewed').check();
  await panel.getByRole('button', { name: 'Save corrections locally' }).click();
  await panel.getByText('Reviewed by you · Local only', { exact: true }).waitFor();
  assert.equal(await panel.locator('.capture-source pre').first().innerText(), originalSource);
  assert.equal(await panel.evaluate(() => window.injected), undefined);
  const stored = await panel.evaluate(async () => Object.entries(await chrome.storage.local.get(null)).filter(([k]) => k.startsWith('posting-capture:')).map(([, v]) => v));
  assert.equal(stored.length, 1); assert.equal(stored[0].corrections.role_title.method, 'user');
  assert.equal(stored[0].snapshot.candidates[0].posting.role_title, 'Account Executive, AI Native');
  const download = panel.waitForEvent('download');
  await panel.getByRole('button', { name: 'Export local pilot JSON' }).click();
  const exported = await download;
  assert.deepEqual(JSON.parse(await readFile(await exported.path(), 'utf8')), stored[0]);
  assert.equal(await panel.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await mkdir('artifacts', { recursive: true });
  await panel.locator('.capture-preview').evaluate(el => el.scrollIntoView({ block: 'start' }));
  await panel.screenshot({ path: 'artifacts/capture-preview.png' });
  await panel.locator('[data-tab=settings]').click();
  await panel.getByRole('button', { name: 'Clear saved AI answers' }).click();
  await panel.reload();
  await panel.locator('[data-tab=capture]').click();
  assert.match(await panel.locator('#capture-role_title').inputValue(), /Corrected title/);
  assert.equal(await panel.locator('.capture-source pre').first().innerText(), originalSource);
  await panel.locator('#capture-company_name').fill('Unsaved company');
  await panel.locator('[data-tab=fill]').click();
  await panel.locator('[data-tab=capture]').click();
  assert.equal(await panel.locator('#capture-company_name').inputValue(), 'Unsaved company', 'draft corrections survive panel tab changes');
  panel.once('dialog', dialog => dialog.accept());
  await panel.getByRole('button', { name: 'Delete capture', exact: true }).click();
  await panel.getByText('No local captures yet.', { exact: true }).waitFor();

  // The sampled Lever conflict needs a specific resolution; a checkbox alone
  // must not turn it into an eligible offline request.
  await target(leverPage);
  await panel.getByRole('button', { name: 'Capture current posting', exact: true }).click();
  await panel.locator('#capture-reviewed').waitFor();
  await panel.locator('#capture-reviewed').check();
  await panel.getByRole('button', { name: 'Save corrections locally' }).click();
  await panel.getByText('Reviewed by you · Local only', { exact: true }).waitFor();
  await panel.getByRole('button', { name: 'Prepare offline request', exact: true }).click();
  await panel.locator('.capture-transport').waitFor();
  assert.match(await panel.locator('.capture-transport').innerText(), /conflicting_sources/);
  const conflictControl = panel.locator('.capture-resolution[data-warning-code="conflicting_sources"]');
  await conflictControl.locator('select').selectOption('use_structured');
  assert.equal(await panel.locator('#capture-description').inputValue(), l.source.structured_text);
  await conflictControl.locator('textarea').fill('Compared both originals; the structured source includes the full requirements.');
  const completeness = panel.locator('.capture-resolution[data-warning-code="requirements_unverified"]');
  await completeness.locator('select').selectOption('verified_irrelevant');
  await completeness.locator('textarea').fill('Checked language, attendance and all experience requirements against the posting.');
  await panel.locator('#capture-reviewed').check();
  await panel.getByRole('button', { name: 'Save corrections locally' }).click();
  await panel.getByText('Reviewed by you · Local only', { exact: true }).waitFor();
  await panel.getByRole('button', { name: 'Prepare offline request', exact: true }).click();
  await panel.locator('.capture-transport').waitFor();
  assert.match(await panel.locator('.capture-transport').innerText(), /Local review checks passed/);
  const transportDownload = panel.waitForEvent('download');
  await panel.getByRole('button', { name: 'Download offline request JSON', exact: true }).click();
  const requestJson = await readFile(await (await transportDownload).path(), 'utf8');
  const request = JSON.parse(requestJson);
  assert.equal(request.request_assessment, false);
  assert.equal(request.source.variants.length, 2);
  assert.equal(request.source.variants.find(v => v.id === 'rendered').text, l.source.rendered_text);
  assert.equal(request.source.variants.find(v => v.id === 'structured').text, l.source.structured_text);
  assert.equal(request.posting.description, l.source.structured_text);
  assert.match(await panel.locator('.capture-transport').innerText(), new RegExp(String(Buffer.byteLength(requestJson, 'utf8'))));
  await panel.locator('.capture-transport summary').click();
  assert.equal(await panel.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'expanded JSON wraps at panel width');
  await panel.locator('#capture-location').fill('User correction after review');
  assert.equal(await panel.locator('#capture-reviewed').isChecked(), false);
  assert.deepEqual(await panel.locator('[data-resolution-action]').evaluateAll(elements => elements.map(el => el.value)), ['', '']);
  assert.equal(await panel.locator('.capture-transport').count(), 0, 'editing removes an obsolete prepared request');
  await panel.getByRole('button', { name: 'Save corrections locally' }).click();
  await panel.getByRole('button', { name: 'Prepare offline request', exact: true }).click();
  await panel.locator('.capture-transport').waitFor();
  assert.match(await panel.locator('.capture-transport').innerText(), /pilot_review_required.*conflicting_sources|conflicting_sources.*pilot_review_required/);
  panel.once('dialog', dialog => dialog.accept());
  await panel.getByRole('button', { name: 'Delete capture', exact: true }).click();
  await panel.getByText('No local captures yet.', { exact: true }).waitFor();

  // UTF-8 overflow is a local failure, never a source-dropping fallback.
  await jsonPage.setContent(schema({ ...job, description: 'Requirements ' + '界'.repeat(60000) }));
  await target(jsonPage);
  await panel.getByRole('button', { name: 'Capture current posting', exact: true }).click();
  await panel.locator('#capture-description').waitFor();
  await panel.getByRole('button', { name: 'Prepare offline request', exact: true }).click();
  await panel.getByRole('alert').filter({ hasText: 'nothing was uploaded' }).waitFor();
  assert.equal((await panel.locator('#capture-description').inputValue()).length, 60013);
  const fullLocalDownload = panel.waitForEvent('download');
  await panel.getByRole('button', { name: 'Export local pilot JSON', exact: true }).click();
  const fullLocal = JSON.parse(await readFile(await (await fullLocalDownload).path(), 'utf8'));
  assert.equal(fullLocal.snapshot.candidates[0].source.structured_text.length, 60013);
  panel.once('dialog', dialog => dialog.accept());
  await panel.getByRole('button', { name: 'Delete capture', exact: true }).click();
  await panel.getByText('No local captures yet.', { exact: true }).waitFor();

  // Historical reversed salary evidence survives clearing current amounts,
  // but requires the specific corrected resolution and fresh review.
  await jsonPage.setContent(schema({ ...job, baseSalary: { currency: 'USD', value: { minValue: 90000, maxValue: 50000, unitText: 'YEAR' } } }));
  await target(jsonPage);
  await panel.getByRole('button', { name: 'Capture current posting', exact: true }).click();
  await panel.locator('#capture-salary_min').waitFor();
  await panel.getByRole('button', { name: 'Prepare offline request', exact: true }).click();
  await panel.getByRole('alert').filter({ hasText: 'Salary maximum cannot be below minimum' }).waitFor();
  await panel.locator('#capture-salary_min').fill('');
  await panel.locator('#capture-salary_max').fill('');
  const salaryWarning = panel.locator('.capture-resolution[data-warning-code="invalid_salary_range"]');
  assert.equal(await salaryWarning.locator('option[value="verified_irrelevant"]').count(), 0);
  await salaryWarning.locator('select').selectOption('corrected');
  await salaryWarning.locator('textarea').fill('The original reversed range could not be verified. Both current amounts were explicitly cleared to unknown.');
  for (const code of ['structured_only', 'requirements_unverified']) {
    const control = panel.locator(`.capture-resolution[data-warning-code="${code}"]`);
    await control.locator('select').selectOption('verified_irrelevant');
    await control.locator('textarea').fill('Compared the original requirements with the full posting.');
  }
  await panel.locator('#capture-reviewed').check();
  await panel.getByRole('button', { name: 'Save corrections locally' }).click();
  await panel.getByText('Reviewed by you · Local only', { exact: true }).waitFor();
  await panel.getByRole('button', { name: 'Prepare offline request', exact: true }).click();
  await panel.locator('.capture-transport').waitFor();
  assert.match(await panel.locator('.capture-transport').innerText(), /Local review checks passed/);
  const salaryDownload = panel.waitForEvent('download');
  await panel.getByRole('button', { name: 'Download offline request JSON', exact: true }).click();
  const salaryRequest = JSON.parse(await readFile(await (await salaryDownload).path(), 'utf8'));
  assert.equal(salaryRequest.posting.salary_min, null); assert.equal(salaryRequest.posting.salary_max, null);
  assert.equal(salaryRequest.source.structured_facts.salary_min, 90000); assert.equal(salaryRequest.source.structured_facts.salary_max, 50000);
  assert.ok(salaryRequest.source.corrections.salary_min); assert.ok(salaryRequest.source.corrections.salary_max);
  assert.ok(salaryRequest.source.warnings.some(w => w.code === 'invalid_salary_range'));
  panel.once('dialog', dialog => dialog.accept());
  await panel.getByRole('button', { name: 'Delete capture', exact: true }).click();
  await panel.getByText('No local captures yet.', { exact: true }).waitFor();

  await jsonPage.setContent(schema([job, { ...job, title: 'Second requisition' }]));
  await target(jsonPage);
  await panel.getByRole('button', { name: 'Capture current posting', exact: true }).click();
  await panel.locator('#capture-candidate').waitFor();
  assert.equal(await panel.locator('#capture-form').count(), 0, 'ambiguous capture never picks a posting automatically');
  await panel.locator('#capture-candidate').selectOption('1');
  await panel.locator('#capture-role_title').waitFor();
  assert.equal(await panel.locator('#capture-role_title').inputValue(), 'Second requisition');
  await panel.locator('#capture-candidate').selectOption('0');
  await panel.locator('#capture-role_title').waitFor();
  await panel.waitForFunction(() => document.querySelector('#capture-role_title')?.value === 'Support Engineer');
  const forks = await panel.evaluate(async () => Object.entries(await chrome.storage.local.get(null)).filter(([k]) => k.startsWith('posting-capture:')).map(([, v]) => v));
  assert.equal(forks.length, 2, 'changing selected opening keeps the old capture and creates a new identity');
  assert.notEqual(forks[0].id, forks[1].id);
  await panel.locator('[data-tab=settings]').click();
  panel.once('dialog', dialog => dialog.accept());
  await panel.getByRole('button', { name: 'Delete all local data' }).click();
  await panel.getByRole('status').filter({ hasText: 'All local data deleted.' }).waitFor();
  await panel.locator('[data-tab=capture]').click();
  await panel.getByText('No local captures yet.', { exact: true }).waitFor();
  assert.equal(await panel.evaluate(async () => Object.keys(await chrome.storage.local.get(null)).filter(k => k.startsWith('posting-capture:')).length), 0);
  assert.deepEqual(errors, []); assert.deepEqual(externalRequests, []);
  console.log('PASS installed extension: explicit capture, local persistence/reopen, editable corrections, immutable source, safe rendering, export, narrow layout, draft retention and deletion; zero external requests.');
} finally {
  await context.close();
  // mkdtemp returns a unique directory inside the OS temp directory.
  if (!profile.startsWith(join(tmpdir(), 'job-hunt-capture-'))) throw new Error('Unexpected test profile path');
  await rm(profile, { recursive: true, force: true });
}
