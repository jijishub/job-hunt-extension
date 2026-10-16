import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gatewayURL, localAnswer, validateAnswers, parseJSON, requestAI } from '../src/core.js';
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
