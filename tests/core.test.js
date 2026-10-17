import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gatewayURL, localAnswer, validateAnswers, parseJSON, requestAI, answerCacheIdentity, aiFieldData } from '../src/core.js';

test('cached answers are isolated by application, repeated field, role context and gateway', () => {
  const field = { key: '0:f1', frameId: 0, label: 'Role Description', type: 'textarea', context: { heading: 'Experience', fields: [{ label: 'Employer', value: 'CloudJi' }] } };
  const page = { url: 'https://example.com/apply?job=1', frames: [{ frameId: 0, title: 'Job 1', url: 'https://example.com/apply' }] };
  const settings = { baseUrl: 'https://gateway.example/v1', model: 'luna' };
  const key = (f = field, p = page, s = settings) => answerCacheIdentity(f, p, {}, 'Resume', s);
  assert.equal(key(), key(structuredClone(field)));
  assert.notEqual(key(), key({ ...field, key: '0:f2' }));
  assert.notEqual(key(), key({ ...field, context: { heading: 'Experience', fields: [{ label: 'Employer', value: 'Example IT' }] } }));
  assert.notEqual(key(), key(field, { ...page, url: 'https://example.com/apply?job=2' }));
  assert.notEqual(key(), key(field, { ...page, frames: [{ ...page.frames[0], title: 'Different role' }] }));
  assert.notEqual(key(), key(field, page, { ...settings, model: 'other' }));
  assert.equal(aiFieldData(field).context.fields[0].value, 'CloudJi', 'shared AI descriptor carries role context');
});

test('personal profile matching excludes employer, school and other people', () => {
  const profile = { firstName: 'Jiji', email: 'jiji@example.com', phone: '12345', city: 'Manila', country: 'Philippines', addressLine1: '12 Sample Street' };
  for (const label of ['Employer city', 'Company phone', 'Reference email', 'Referee first name', 'Emergency contact phone', 'School address', 'Supervisor phone']) {
    assert.equal(localAnswer({ label, autocomplete: 'email' }, profile), '', label);
  }
  assert.equal(localAnswer({ label: 'City', context: { heading: 'Employer details' }, autocomplete: 'address-level2' }, profile), '');
  assert.equal(localAnswer({ label: 'Email', context: { heading: 'References' } }, profile), '');
  assert.equal(localAnswer({ label: 'City', context: { heading: 'Personal details' } }, profile), 'Manila');
});
test('local matching handles browser autocomplete and never guesses choices', () => {
  assert.equal(localAnswer({ label: 'Name', autocomplete: 'given-name' }, { firstName: 'Jiji' }), 'Jiji');
  assert.equal(localAnswer({ label: 'Full name' }, { firstName: 'Jiji', lastName: 'Casia' }), 'Jiji Casia');
  assert.equal(localAnswer({ label: 'Email consent', type: 'checkbox' }, { email: 'a@b.co' }), '');
  assert.equal(localAnswer({ label: 'Are you authorized to work?' }, {}), '');
});
test('AI answers must reference known fields and available select options', () => {
  const fields = [{ id: 'a', type: 'text' }, { id: 'b', type: 'select', options: [{ label: 'Philippines', value: 'PH' }] }, { id: 'c', type: 'file' }];
  const valid = validateAnswers({ answers: [{ id: 'a', value: 'Yes' }, { id: 'a', value: 'Duplicate' }, { id: 'fake', value: 'Injected' }, { id: 'b', value: 'USA' }, { id: 'c', value: '/etc/file' }] }, fields);
  assert.deepEqual(valid, [{ id: 'a', value: 'Yes', source: 'AI' }]);
  assert.equal(validateAnswers({ answers: [{ id: 'b', value: 'PH' }] }, fields).length, 1);
});

test('address parts fill independently without inferring a full address from a city', () => {
  const profile = { addressLine1: '12 Sample Street', addressLine2: 'Unit 4', city: 'Manila', state: 'Metro Manila', postalCode: '0123', country: 'Philippines', email: 'jiji@example.com' };
  for (const [label, key] of [['Street address', 'addressLine1'], ['Address line 2', 'addressLine2'], ['State / province', 'state'], ['Region', 'state'], ['ZIP code', 'postalCode'], ['City', 'city'], ['Country', 'country'], ['Email address', 'email']]) {
    assert.equal(localAnswer({ label }, profile), profile[key]);
  }
  assert.equal(localAnswer({ label: 'Address', autocomplete: 'section-home shipping address-line2' }, profile), profile.addressLine2);
  assert.equal(localAnswer({ label: 'Location', autocomplete: 'address-level1' }, profile), profile.state);
  assert.equal(localAnswer({ label: 'Address', autocomplete: 'street-address' }, profile), '12 Sample Street\nUnit 4');
  assert.equal(localAnswer({ label: '', name: 'postalCode' }, profile), '0123');
  assert.equal(localAnswer({ label: 'Full address' }, profile), '12 Sample Street, Unit 4, Manila, Metro Manila, 0123, Philippines');
  assert.equal(localAnswer({ label: 'Full address' }, { city: 'Manila', country: 'Philippines' }), '');
  assert.equal(localAnswer({ label: 'Address line 2' }, { addressLine1: '12 Sample Street' }), '');
  assert.equal(localAnswer({ label: 'Employer address' }, profile), '');
  assert.equal(localAnswer({ label: 'Employment state' }, profile), '');
});
test('current salary is optional and distinct from expected salary', () => {
  const profile = { currentSalary: 'PHP 30,000 / month', salary: 'PHP 45,000 / month' };
  for (const label of ['Current salary', 'Current basic salary', 'Present salary', 'Last drawn salary', 'Current compensation']) {
    assert.equal(localAnswer({ label }, profile), profile.currentSalary);
    assert.equal(localAnswer({ label }, { salary: profile.salary }), '');
  }
  assert.equal(localAnswer({ label: 'Expected salary' }, profile), profile.salary);
  assert.equal(localAnswer({ label: 'Expected salary' }, { currentSalary: profile.currentSalary }), '');
  assert.equal(localAnswer({ label: 'Salary' }, profile), '', 'ambiguous salary fields are left for review');
});
test('gateway URL rejects unsafe protocols and embedded credentials', () => {
  assert.equal(gatewayURL('https://api.jizellecasia.site/v1/'), 'https://api.jizellecasia.site/v1/chat/completions');
  assert.throws(() => gatewayURL('http://example.com/v1'));
  assert.throws(() => gatewayURL('https://user:secret@example.com/v1'));
  assert.throws(() => gatewayURL('https://example.com/v1?key=secret'));
});
test('partial searchable dropdowns allow labels for runtime verification; complete and multi lists stay constrained', () => {
  const fields = [
    { id: 'school', type: 'custom-select', options: [{ label: 'Aalto University', value: 'Aalto University' }], optionsIncomplete: true },
    { id: 'skills', type: 'custom-select', multiple: true, options: [{ label: 'Python', value: 'Python' }, { label: 'SQL', value: 'SQL' }] },
    { id: 'country', type: 'custom-select', options: [{ label: 'Philippines', value: 'Philippines' }] }
  ];
  const valid = validateAnswers({ answers: [{ id: 'school', value: 'National University of Singapore' }, { id: 'skills', value: 'Python\nSQL' }, { id: 'country', value: 'Unknown' }] }, fields);
  assert.equal(valid.length, 2);
  assert.equal(validateAnswers({ answers: [{ id: 'skills', value: 'Python\nUnknown' }] }, fields).length, 0);
  assert.equal(localAnswer({ type: 'custom-select', label: 'Contact Number — country calling code' }, { phone: '09123456789', country: 'Philippines' }), '');
  assert.equal(localAnswer({ type: 'custom-select', label: 'Current Location' }, { country: 'Philippines' }), 'Philippines');
  assert.equal(localAnswer({ type: 'text', label: 'Contact Number' }, { phone: '09123456789' }), '09123456789');
});
test('parses fenced JSON and reports malformed content', () => {
  assert.deepEqual(parseJSON('```json\n{"answers":[]}\n```'), { answers: [] });
  assert.throws(() => parseJSON('hello'), /valid JSON/);
});
test('gateway makes one bounded request and reports authentication errors', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(url, 'https://test.example/v1/chat/completions');
    assert.equal(options.headers.Authorization, 'Bearer private-key');
    assert.equal(JSON.parse(options.body).max_tokens, 700);
    return { ok: false, status: 401 };
  };
  try { await assert.rejects(requestAI({ baseUrl: 'https://test.example/v1', model: 'luna', apiKey: 'private-key' }, [], { maxTokens: 700 }), /401/); assert.equal(calls, 1); }
  finally { globalThis.fetch = original; }
});
