import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve, extname, join } from 'node:path';
import { tmpdir } from 'node:os';
import JSZip from 'jszip';

function pdfFixture() {
  const content = 'BT /F1 12 Tf 40 740 Td (Jiji Casia - Operations specialist with three years of experience in project coordination.) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${content.length} >>\nstream\n${content}\nendstream`
  ];
  let pdf = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}

const fixture = `<!doctype html><title>Example Co · Application</title><body>
<form><label>First name<input id="first" name="firstName"></label><label>Last name<input id="last" value="Keep me"></label>
<label>Email<input id="email" type="email"></label><label>Why this role?<textarea id="why"></textarea></label>
<label>Additional skills<textarea id="extra"></textarea></label>
<label>Country<select id="country"><option value="">Choose</option><option value="PH">Philippines</option></select></label>
<label>Resume<input type="file" id="resume" accept=".txt,.pdf,.docx"></label>
<label>I agree to terms<input id="consent" type="checkbox"></label><input type="password" id="password">
<button type="submit">Submit</button></form><div id="shadow"></div><iframe src="/frame"></iframe>
<script>document.querySelector('form').onsubmit=e=>{e.preventDefault();window.submitted=true};document.querySelector('#shadow').attachShadow({mode:'open'}).innerHTML='<label>Phone<input id="phone"></label>';</script>`;
const server = createServer(async (req, res) => {
  if (req.url === '/application') { res.setHeader('Content-Type', 'text/html'); res.end(fixture); return; }
  if (req.url === '/frame') { res.setHeader('Content-Type', 'text/html'); res.end('<label>City<input id="city"></label>'); return; }
  try {
    const path = resolve('build', req.url === '/' ? 'index.html' : req.url.slice(1).split('?')[0]);
    if (!path.startsWith(resolve('build') + '\\') && !path.startsWith(resolve('build') + '/')) throw new Error('Invalid path');
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' })[extname(path)] || 'application/octet-stream');
    res.end(await readFile(path));
  } catch { res.statusCode = 404; res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(join(tmpdir(), 'job-hunt-fill-test-'));
let context;
try {
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${resolve('build')}`, `--load-extension=${resolve('build')}`]
  });
  let worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).hostname;
  const application = await context.newPage(); await application.goto(`${origin}/application`);
  const panel = await context.newPage();
  const errors = []; panel.on('pageerror', e => errors.push(e.message));
  await panel.setViewportSize({ width: 400, height: 1000 });
  await panel.goto(`chrome-extension://${extensionId}/index.html`);
  await panel.getByRole('heading', { name: 'Big ambitions.' }).waitFor();
  // The real side panel is not a tab. Emulate its active application target here.
  await panel.evaluate(async origin => {
    const tabs = await chrome.tabs.query({});
    const target = tabs.find(t => t.url === origin + '/application');
    window.testTarget = target.id;
    chrome.tabs.query = async () => [await chrome.tabs.get(window.testTarget)];
  }, origin);
  await panel.locator('[data-tab=profile]').click();
  await panel.getByLabel('First name', { exact: true }).fill('Jiji');
  await panel.getByLabel('Last name', { exact: true }).fill('Casia');
  await panel.getByLabel('Email', { exact: true }).fill('jiji@example.com');
  await panel.getByLabel('City', { exact: true }).fill('Manila');
  await panel.getByLabel('Country', { exact: true }).fill('Philippines');
  await panel.getByLabel('Phone', { exact: true }).fill('09123456789');
  assert.equal(await panel.getByLabel('Current salary (optional', { exact: false }).getAttribute('required'), null);
  await panel.getByLabel('Current salary (optional', { exact: false }).fill('PHP 30,000 / month');
  await panel.getByRole('button', { name: 'Save my profile' }).click();
  await panel.getByRole('status').filter({ hasText: 'Profile saved' }).waitFor();
  await panel.getByRole('button', { name: 'Resumes', exact: false }).click();
  await panel.locator('[data-upload="0"]').setInputFiles({ name: 'operations.txt', mimeType: 'text/plain', buffer: Buffer.from('Jiji Casia\njiji@example.com\nOperations specialist with three years of experience in process improvement and customer support.') });
  await panel.getByRole('status').filter({ hasText: 'Resume saved' }).waitFor();
  await panel.getByRole('button', { name: 'Fill', exact: false }).first().click();
  await panel.getByRole('button', { name: 'Scan current page' }).click();
  await panel.getByRole('status').filter({ hasText: 'Page scanned' }).waitFor();
  assert.equal(await panel.locator('[data-value]').count(), 6, 'profile fields, shadow DOM, iframe and resume detected');
  let requests = 0;
  await context.route('https://api.jizellecasia.site/v1/chat/completions', async route => {
    requests++;
    const payload = route.request().postDataJSON();
    const input = JSON.parse(payload.messages[1].content);
    assert.equal(payload.model, 'luna');
    assert.ok(!JSON.stringify(input).includes('Keep me'));
    if (input.field) {
      assert.equal(payload.max_tokens, 1200);
      assert.equal(input.fields, undefined, 'revision sends only one field');
      const revised = /Additional skills/.test(input.field.label) ? 'I also speak Spanish.' : 'My operations and customer support experience fit this role.';
      const answers = input.request.includes('unknown credential') ? [] : [{ id: input.field.id, value: revised }, { id: 'invented', value: 'Must not affect other fields' }];
      await route.fulfill({ json: { choices: [{ message: { content: JSON.stringify({ answers }) } }] } });
      return;
    }
    const f = input.fields.find(f => /Why this role/.test(f.label));
    await route.fulfill({ json: { choices: [{ message: { content: JSON.stringify({ answers: f ? [{ id: f.id, value: 'My operations experience fits this role.' }, { id: 'invented', value: 'Ignore me' }] : [] }) } }], usage: { total_tokens: 180 } } });
  });
  await panel.getByRole('button', { name: 'Draft missing answers' }).click();
  await panel.getByRole('status').filter({ hasText: '1 AI answers added' }).waitFor();
  await panel.getByRole('button', { name: 'Fill reviewed answers' }).click();
  await panel.getByRole('status').filter({ hasText: '7 fields filled' }).waitFor();
  assert.equal(await application.locator('#first').inputValue(), 'Jiji');
  assert.equal(await application.locator('#last').inputValue(), 'Keep me');
  assert.equal(await application.locator('#country').inputValue(), 'PH');
  assert.equal(await application.locator('#why').inputValue(), 'My operations experience fits this role.');
  assert.equal(await application.locator('#resume').evaluate(el => el.files[0].name), 'operations.txt');
  assert.equal(await application.frameLocator('iframe').locator('#city').inputValue(), 'Manila');
  assert.equal(await application.locator('#phone').inputValue(), '09123456789');
  assert.equal(await application.locator('#consent').isChecked(), false);
  assert.equal(await application.evaluate(() => !!window.submitted), false);
  await panel.getByRole('button', { name: 'Undo last fill' }).click();
  await panel.getByRole('status').filter({ hasText: 'Restored 7 fields' }).waitFor();
  assert.equal(await application.locator('#first').inputValue(), '');
  assert.equal(await application.locator('#resume').evaluate(el => el.files.length), 0);
  await panel.getByRole('button', { name: 'Scan page again' }).click();
  await panel.getByRole('status').filter({ hasText: 'Page scanned' }).waitFor();
  await panel.getByRole('button', { name: 'Draft missing answers' }).click();
  await panel.getByRole('status').filter({ hasText: '0 AI answers added' }).waitFor();
  assert.equal(requests, 2, 'cached answer reused; only the still-unknown field is requested');
  await panel.locator('#speed').selectOption('gentle');
  await panel.getByRole('button', { name: 'Fill reviewed answers' }).click();
  await panel.getByRole('button', { name: 'Stop', exact: true }).click();
  await panel.getByRole('status').filter({ hasText: 'Stopped' }).waitFor();
  await panel.getByRole('button', { name: 'Undo last fill' }).click();
  await panel.getByRole('status').filter({ hasText: 'Restored' }).waitFor();
  await panel.locator('#speed').selectOption('instant');
  await application.locator('#first').fill('Leave this alone');
  await application.locator('#why').fill('Original page answer');
  const whyKey = await panel.locator('#repair-field option').evaluateAll(options => options.find(o => o.textContent === 'Why this role?').value);
  await panel.locator('#repair-field').selectOption(whyKey);
  await panel.getByLabel('WHAT SHOULD AI ADD OR CHANGE?').fill('Include my customer support experience.');
  await panel.getByRole('button', { name: 'Update this answer with AI' }).click();
  await panel.getByRole('status').filter({ hasText: 'One answer updated' }).waitFor();
  assert.equal(await application.locator('#why').inputValue(), 'Original page answer', 'revision does not fill automatically');
  const whyAnswer = panel.locator('.answer').filter({ hasText: 'Why this role?' }).locator('[data-value]');
  assert.equal(await whyAnswer.inputValue(), 'My operations and customer support experience fit this role.');
  await panel.getByRole('button', { name: 'Fill this field', exact: true }).click();
  await panel.getByRole('status').filter({ hasText: 'Selected field filled' }).waitFor();
  assert.equal(await application.locator('#why').inputValue(), 'My operations and customer support experience fit this role.');
  assert.equal(await application.locator('#first').inputValue(), 'Leave this alone', 'targeted fill leaves other fields unchanged');
  assert.equal(await panel.locator('#overwrite').isChecked(), false, 'global overwrite stays disabled');
  await panel.getByRole('button', { name: 'Undo last fill' }).click();
  await panel.getByRole('status').filter({ hasText: 'Restored' }).waitFor();
  assert.equal(await application.locator('#why').inputValue(), 'Original page answer');
  await panel.locator('#repair-prompt').fill('Add an unknown credential.');
  await panel.getByRole('button', { name: 'Update this answer with AI' }).click();
  await panel.getByRole('alert').filter({ hasText: 'previous answer is kept' }).waitFor();
  assert.equal(await whyAnswer.inputValue(), 'My operations and customer support experience fit this role.');
  assert.equal(await panel.locator('#repair-prompt').inputValue(), 'Add an unknown credential.');
  const extraKey = await panel.locator('#repair-field option').evaluateAll(options => options.find(o => o.textContent === 'Additional skills').value);
  await panel.locator('#repair-field').selectOption(extraKey);
  await panel.locator('#repair-prompt').fill('I also speak Spanish. Add that.');
  await panel.getByRole('button', { name: 'Update this answer with AI' }).click();
  await panel.getByRole('status').filter({ hasText: 'One answer updated' }).waitFor();
  assert.equal(await panel.locator('.answer').filter({ hasText: 'Additional skills' }).locator('[data-value]').inputValue(), 'I also speak Spanish.', 'a skipped field can receive a new draft');
  await panel.getByRole('button', { name: 'Fill this field', exact: true }).click();
  await panel.getByRole('status').filter({ hasText: 'Selected field filled' }).waitFor();
  assert.equal(await application.locator('#extra').inputValue(), 'I also speak Spanish.');
  assert.equal(await application.locator('#first').inputValue(), 'Leave this alone');
  await mkdir('artifacts', { recursive: true });
  await panel.screenshot({ path: 'artifacts/fill-panel.png', fullPage: true });
  await panel.setViewportSize({ width: 320, height: 850 });
  assert.equal(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no horizontal overflow at narrow side-panel width');
  await panel.getByRole('button', { name: 'Resumes', exact: false }).click();
  await panel.locator('[data-upload="1"]').setInputFiles({ name: 'project.pdf', mimeType: 'application/pdf', buffer: pdfFixture() });
  await panel.locator('.notice').waitFor();
  assert.match(await panel.locator('.notice').innerText(), /Resume saved/, 'PDF import must succeed');
  assert.match(await panel.locator('.resume-slot').nth(1).innerText(), /characters/);
  const docx = new JSZip();
  docx.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  docx.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  docx.file('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Jiji Casia. Customer support specialist with three years of experience in operations.</w:t></w:r></w:p></w:body></w:document>');
  await panel.locator('[data-upload="2"]').setInputFiles({ name: 'support.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: await docx.generateAsync({ type: 'nodebuffer' }) });
  await panel.getByRole('status').filter({ hasText: 'Resume saved' }).waitFor();
  assert.match(await panel.locator('.resume-slot').nth(2).innerText(), /characters/);
  await panel.locator('[data-upload="0"]').setInputFiles({ name: 'replacement.txt', mimeType: 'text/plain', buffer: Buffer.from('Jiji Casia. A replacement resume with detailed operations and project coordination experience.') });
  await panel.getByRole('status').filter({ hasText: 'Resume saved' }).waitFor();
  assert.equal(await panel.locator('.resume-slot').count(), 3);
  await panel.reload();
  await panel.getByRole('button', { name: 'Resumes', exact: false }).click();
  await panel.getByText('replacement.txt', { exact: true }).waitFor();
  await panel.locator('[data-tab=profile]').click();
  assert.equal(await panel.getByLabel('Current salary (optional', { exact: false }).inputValue(), 'PHP 30,000 / month');
  assert.deepEqual(errors, []);
  console.log('PASS: installed extension, PDF/DOCX/TXT, scan/fill, cache, per-field AI revision, skipped-field recovery, preserved drafts on failure, targeted replacement/undo, existing values, no consent/submit, stop, 320px layout.');
} finally {
  await context?.close(); server.close(); await rm(profile, { recursive: true, force: true });
}
