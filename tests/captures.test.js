import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCapture, correctCapture, captureWarnings, captureFields } from '../src/captures.js';

function fixture() {
  return createCapture({ captured_at: '2026-10-18T00:00:00Z', warnings: [], candidates: [{
    posting: { role_title: 'Engineer', company_name: 'Example', description: 'Requirements: JavaScript experience. '.repeat(5), qualifications: [], work_model: null, job_type: null, job_url: 'https://example.com/job?id=1', salary_min: null, salary_max: null, salary_currency: null, location: null, job_platform: null, seniority_level: null, first_response_at: null },
    source: { rendered_text: 'Original source', salary_period: null }, provenance: {}, warnings: ['Layout needs review.']
  }] });
}
const valuesFor = capture => Object.fromEntries(captureFields.map(([key]) => [key, Array.isArray(capture.posting[key]) ? capture.posting[key].join('\n') : capture.posting[key] ?? '']));
test('corrections preserve original source, retain unknowns, and record user provenance', async () => {
  const original = fixture(), before = structuredClone(original);
  const corrected = await correctCapture(original, { ...valuesFor(original), role_title: 'Support Engineer', description: 'Corrected requirements', owner: 'attacker', seniority_level: 'SENIOR', first_response_at: 'today' }, true);
  assert.deepEqual(original, before);
  assert.deepEqual(corrected.snapshot, before.snapshot);
  assert.equal(corrected.posting.role_title, 'Support Engineer');
  assert.equal(corrected.corrections.role_title.method, 'user');
  assert.equal(corrected.posting.work_model, null);
  assert.equal(corrected.posting.salary_currency, null);
  assert.equal(corrected.posting.seniority_level, null);
  assert.equal(corrected.posting.first_response_at, null);
  assert.equal(corrected.posting.owner, undefined);
  assert.ok(corrected.reviewed_at);
  assert.ok(captureWarnings(corrected).some(w => w.message === 'Layout needs review.' && w.code === 'unclassified_warning'), 'review never hides or guesses codes for legacy warnings');
});
test('invalid corrections do not change a saved capture', async () => {
  const capture = fixture(), values = valuesFor(capture);
  for (const patch of [{ salary_min: '-1' }, { salary_min: '20', salary_max: '10' }, { salary_currency: '$' }, { job_url: 'javascript:alert(1)' }, { job_type: 'PERMANENT' }, { work_model: 'probably remote' }]) {
    await assert.rejects(() => correctCapture(capture, { ...values, ...patch }, false));
  }
  assert.equal(capture.posting.salary_min, null);
});
test('multiple candidates require explicit selection; incomplete and oversized text stays flagged', () => {
  const capture = fixture();
  const multiple = createCapture({ ...capture.snapshot, candidates: [capture.snapshot.candidates[0], capture.snapshot.candidates[0]] });
  assert.equal(multiple.posting, null);
  assert.match(captureWarnings(multiple).map(w => w.message).join(' '), /Choose/);
  capture.posting.description = '';
  assert.match(captureWarnings(capture).map(w => w.message).join(' '), /Little or no requirements/);
  capture.posting.description = 'Requirements '.repeat(3000);
  assert.match(captureWarnings(capture).map(w => w.message).join(' '), /30,000/);
});
