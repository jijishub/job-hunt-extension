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
test('gateway URL rejects unsafe protocols and embedded credentials', () => {
  assert.equal(gatewayURL('https://api.jizellecasia.site/v1/'), 'https://api.jizellecasia.site/v1/chat/completions');
  assert.throws(() => gatewayURL('http://example.com/v1'));
  assert.throws(() => gatewayURL('https://user:secret@example.com/v1'));
  assert.throws(() => gatewayURL('https://example.com/v1?key=secret'));
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
