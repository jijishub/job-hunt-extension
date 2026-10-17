import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { reviewedCapture, settings, resume, result, MemoryStore, valuesFor } from './helpers/fit-fixture.js';
import { makeFitInputs, canonicalJSON, sha256, callRoleFit, fitMessages, validateFitResult, assessmentFromJob } from '../src/role-fit.js';
import { RoleFitQueue } from '../src/role-fit-queue.js';
import { serializeCapture } from '../src/capture-transport.js';
import { serializeAssessedCapture } from '../src/assessed-capture.js';
import { correctCapture } from '../src/captures.js';
import { contentHash, reviewHash } from '../src/capture-rules.js';

const inputsFor = async (c, r = resume, p = null, s = settings) => makeFitInputs(c, await serializeCapture(c), r, p, s);
const success = inputs => ({ id: crypto.randomUUID(), state: 'succeeded', inputs, analyzed_at: new Date().toISOString(), result });

test('local review bindings survive JSON storage and recursively reordered object keys without altering text', async () => {
  const capture = await reviewedCapture();
  const reverse = v => v === null || typeof v !== 'object' ? v : Array.isArray(v) ? v.map(reverse) : Object.fromEntries(Object.entries(v).reverse().map(([k, item]) => [k, reverse(item)]));
  const restored = reverse(JSON.parse(JSON.stringify(capture)));
  assert.equal(await contentHash(capture), await contentHash(restored));
  assert.equal(await reviewHash(capture), await reviewHash(restored));
  assert.equal((await serializeCapture(restored)).assessment.eligible, true);
  assert.equal(canonicalJSON({ missing: undefined, list: [undefined, null], text: 'a\r\nb' }), '{"list":[null,null],"text":"a\\r\\nb"}');
});

test('canonical UTF-8 hashes bind final posting projection, exact resume, preferences, model, gateway and review', async () => {
  assert.equal(canonicalJSON({ z: [{ b: 2, a: 1 }], a: '界' }), '{"a":"界","z":[{"a":1,"b":2}]}');
  assert.equal(await sha256(resume.text), createHash('sha256').update(resume.text, 'utf8').digest('hex'));
  const c = await reviewedCapture(), a = await inputsFor(c);
  const changes = [await inputsFor(c, { ...resume, id: 'resume-slot-2' }), await inputsFor(c, { ...resume, text: resume.text.replace('\r\n', '\n') }),
    await inputsFor(c, resume, { notes: 'USD 5000 per month, remote.' }), await inputsFor(c, resume, null, { ...settings, model: 'other' }),
    await inputsFor(c, resume, null, { ...settings, baseUrl: 'https://gateway.example/v1' })];
  for (const b of changes) assert.notEqual(b.binding_hash, a.binding_hash);
  assert.equal(a.preferences_hash, null);
  assert.equal(changes[2].preferences_hash, await sha256(canonicalJSON({ notes: 'USD 5000 per month, remote.' })));
  const salary = await correctCapture(c, { ...valuesFor(c), salary_min: '10', salary_period: 'YEAR', job_platform: 'Referral' }, true, c.resolutions);
  const projected = await inputsFor(salary), serialized = await serializeCapture(salary);
  assert.equal(projected.posting_hash, await sha256(canonicalJSON(serialized.payload.posting)));
  assert.equal(projected.posting.salary_pay_period, 'ANNUAL');
  assert.equal(serialized.payload.user_context.application_channel, 'Referral');
});

test('role-fit uses full resume and requirements, only explicit preferences, and rejects oversized input without truncation', async () => {
  const c = await reviewedCapture(), text = 'Evidence '.repeat(4000) + 'TAIL_MUST_REACH_PROVIDER';
  const inputs = await inputsFor(c, { ...resume, text }); let request;
  const answer = await callRoleFit(inputs, settings, { fetcher: async (url, options) => {
    request = JSON.parse(options.body); assert.equal(options.headers.Authorization, 'Bearer PRIVATE_GATEWAY_KEY');
    assert.match(url, /\/v1\/chat\/completions$/);
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(result) } }] });
  } });
  const sent = JSON.parse(request.messages[1].content);
  assert.equal(sent.resume, text); assert.deepEqual(sent.posting, inputs.posting); assert.equal(sent.preferences, null); assert.deepEqual(answer, result);
  assert.match(request.messages[0].content, /untrusted data/); assert.doesNotMatch(JSON.stringify(request), /profile|PRIVATE_GATEWAY_KEY/);
  assert.throws(() => fitMessages({ ...inputs, resume: { text: '界'.repeat(80000) } }), /Nothing was truncated/);
  assert.throws(() => fitMessages({ ...inputs, resume: { text: 'x'.repeat(120000) } }), /Nothing was truncated/);
});

test('strict result validation rejects invented fields, preference assumptions, malformed and partial provider responses', async () => {
  for (const raw of [{ ...result, score: 99 }, { ...result, fit: 'PERFECT' }, { ...result, explanation: ' ' }, { ...result, strengths: Array(21).fill('x') },
    { ...result, gaps: ['x'.repeat(1001)] }, { ...result, preference_alignment: 'ALIGNED' }, { ...result, preference_notes: 'Assumed remote' }]) assert.throws(() => validateFitResult(raw, false));
  assert.doesNotThrow(() => validateFitResult({ ...result, preference_alignment: 'MIXED', preference_notes: 'Currency cannot be compared.' }, true));
  const inputs = await inputsFor(await reviewedCapture());
  for (const response of [new Response('unavailable', { status: 503 }), Response.json({ choices: [{ message: { content: 'broken' } }] }),
    Response.json({ choices: [{ finish_reason: 'length', message: { content: JSON.stringify(result) } }] }), Response.json({ choices: [{ message: { content: JSON.stringify({ ...result, score: 5 }) } }] })]) {
    await assert.rejects(() => callRoleFit(inputs, settings, { fetcher: async () => response }));
  }
});

test('attachment requires fresh review and selected variant; payload excludes resume text, preferences, gateway credentials and prompts', async () => {
  const c = await reviewedCapture(), i = await inputsFor(c), job = success(i), prepared = await serializeAssessedCapture(c, i, job);
  assert.deepEqual(prepared.payload.extension_assessment, assessmentFromJob(job)); assert.equal(prepared.payload.request_assessment, false);
  assert.equal(prepared.bytes, Buffer.byteLength(prepared.json));
  assert.doesNotMatch(prepared.json, /Exact résumé evidence|PRIVATE_GATEWAY_KEY|baseUrl|binding_hash|resume-slot-2|ROLE_FIT_SYSTEM/);
  const other = await inputsFor(c, { ...resume, id: 'resume-slot-2', text: 'Different resume evidence' });
  await assert.rejects(() => serializeAssessedCapture(c, other, job), /stale/);
  const changed = structuredClone(c); changed.posting.description += '\nNew required certification.';
  await assert.rejects(() => serializeAssessedCapture(changed, i, job));
  const unreviewed = await correctCapture(c, valuesFor(c), false, c.resolutions);
  await assert.rejects(() => serializeAssessedCapture(unreviewed, i, job));
  const forged = structuredClone(job); forged.inputs.posting_hash = '0'.repeat(64);
  await assert.rejects(() => serializeCapture(c, { extensionAssessment: assessmentFromJob(forged) }), /STALE/);
});

test('total UTF-8 payload limit includes the attached assessment and never drops source evidence', async () => {
  const c = await reviewedCapture(), text = '界'.repeat(10000);
  // Local snapshots can keep larger evidence than the AI input budget; attach only to an already matching small posting.
  c.snapshot.candidates[0].source.rendered_text = text.repeat(8);
  const reviewed = await correctCapture(c, valuesFor(c), true, c.resolutions);
  const i = await inputsFor(reviewed), job = success(i);
  const base = await serializeCapture(reviewed); assert.ok(base.bytes < 262144);
  const extra = 262144 - base.bytes - 50;
  reviewed.snapshot.candidates[0].source.rendered_text += 'x'.repeat(extra);
  const fresh = await correctCapture(reviewed, valuesFor(reviewed), true, reviewed.resolutions);
  const fi = await inputsFor(fresh);
  await assert.rejects(() => serializeAssessedCapture(fresh, fi, success(fi)), e => e.code === 'CAPTURE_TOO_LARGE');
  assert.ok(fresh.snapshot.candidates[0].source.rendered_text.length > 80000);
});

test('persisted assessment queue serializes calls, preserves last success after failure, and recovers interrupted work', async () => {
  const store = new MemoryStore(), i = await inputsFor(await reviewedCapture()); let calls = 0, active = 0, maxActive = 0, fail = false;
  const options = { store, resolveInputs: async () => i, getSettings: async () => settings, call: async () => {
    calls++; active++; maxActive = Math.max(maxActive, active); await new Promise(r => setTimeout(r, 2)); active--;
    if (fail) throw new Error('Provider unavailable'); return result;
  } };
  const queue = new RoleFitQueue(options); const first = await queue.enqueue(i); await queue.enqueue(i);
  await Promise.all([queue.run(), queue.run()]); assert.equal(calls, 2); assert.equal(maxActive, 1);
  fail = true; await queue.enqueue(i); await queue.run();
  assert.equal((await queue.jobs()).filter(j => j.state === 'succeeded').length, 2);
  assert.equal((await store.get('fit-job:' + first.id)).state, 'succeeded');
  const interrupted = await queue.enqueue(i); interrupted.state = 'running'; await store.set('fit-job:' + interrupted.id, interrupted);
  const reopened = new RoleFitQueue(options); await reopened.recover();
  assert.equal((await store.get('fit-job:' + interrupted.id)).state, 'interrupted'); assert.equal(calls, 3, 'recovery itself never calls AI');
  fail = false; await reopened.run(); assert.equal(calls, 4);
  assert.equal((await store.get('fit-job:' + interrupted.id)).state, 'succeeded');
});

test('queued or in-flight changed inputs become stale and cannot replace a matching success', async () => {
  const store = new MemoryStore(), i = await inputsFor(await reviewedCapture()); let current = i, calls = 0;
  const q = new RoleFitQueue({ store, resolveInputs: async () => current, getSettings: async () => settings, call: async () => { calls++; current = { ...i, binding_hash: 'changed-during-call' }; return result; } });
  const inflight = await q.enqueue(i); await q.run(); assert.equal((await store.get('fit-job:' + inflight.id)).state, 'stale');
  const pending = await q.enqueue(i); await q.run(); assert.equal((await store.get('fit-job:' + pending.id)).state, 'stale'); assert.equal(calls, 1);
});
