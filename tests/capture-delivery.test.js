import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CaptureDelivery, localTrackerOrigin } from '../src/capture-delivery.js';
import { serializeCapture } from '../src/capture-transport.js';
import { reviewedCapture, MemoryStore } from './helpers/fit-fixture.js';
const capabilities = { capture_uploads: true, extension_assessments: true, assessments: false, corrections: false, schema_versions: [1] };
const limits = { max_capture_bytes: 262144, max_status_ids: 50 };
async function harness() {
  const store = new MemoryStore(), prepared = await serializeCapture(await reviewedCapture());
  let now = Date.now(), account = 'account-a', handler = () => Response.json({ capture_id: prepared.payload.capture_id, assessment: { state: 'disabled' } });
  const requests = [];
  const d = new CaptureDelivery({ store, now: () => now, fetcher: async (url, options) => {
    requests.push({ url, ...options });
    if (url.endsWith('/connection')) return Response.json({ account: { id: account, email: account + '@example.com' }, capabilities, limits });
    return handler(url, options);
  } });
  await d.connect('http://127.0.0.1:3000', 'SEPARATE_TRACKER_TOKEN');
  const record = await d.freeze(prepared, {});
  return { d, store, prepared, record, requests, advance: () => { now += 400000; }, account: v => { account = v; }, handler: fn => { handler = fn; } };
}

test('only canonical Job Hunt and loopback origins are allowed; redirects and credential leakage are prohibited', async () => {
  for (const url of ['http://jobhunt.jizellecasia.site', 'https://example.com', 'https://jobhunt.jizellecasia.site.evil.test', 'http://localhost.evil.test', 'http://user:secret@localhost', 'file:///local', 'http://127.0.0.1/path']) assert.throws(() => localTrackerOrigin(url));
  assert.equal(localTrackerOrigin('https://jobhunt.jizellecasia.site'), 'https://jobhunt.jizellecasia.site');
  assert.equal(localTrackerOrigin('http://localhost:3000'), 'http://localhost:3000');
  const h = await harness(); await h.d.send(h.record.id);
  for (const req of h.requests) { assert.equal(req.redirect, 'error'); assert.equal(req.credentials, 'omit'); assert.equal(req.headers.Authorization, 'Bearer SEPARATE_TRACKER_TOKEN'); }
  assert.doesNotMatch(JSON.stringify(await h.d.records()), /SEPARATE_TRACKER_TOKEN|PRIVATE_GATEWAY/);
});

test('uncertain delivery checks receipt once, then retries byte-identical body without any assessment work', async () => {
  const h = await harness(); let posts = 0, lookups = 0;
  h.handler((url, options) => {
    if (!options.method) { lookups++; return Response.json({ captures: [] }); }
    posts++; if (posts === 1) throw new Error('response lost');
    return Response.json({ capture_id: h.record.id, assessment: { state: 'disabled' } });
  });
  assert.equal((await h.d.send(h.record.id)).state, 'uncertain'); h.advance();
  const reopened = new CaptureDelivery({ store: h.store, fetcher: h.d.fetcher, now: h.d.now });
  await reopened.recover(); assert.equal((await reopened.send(h.record.id)).state, 'delivered');
  assert.equal(posts, 2); assert.equal(lookups, 1);
  const bodies = h.requests.filter(r => r.method === 'POST').map(r => r.body);
  assert.equal(bodies[0], h.prepared.json); assert.equal(bodies[1], bodies[0]);
  assert.equal((await h.store.list('fit-job:')).length, 0);
});

test('receipt recovery avoids a second POST and interrupted sending becomes uncertain on reopen', async () => {
  const h = await harness(); h.record.state = 'sending'; await h.d.save(h.record); await h.d.recover();
  h.handler(() => Response.json({ captures: [{ capture_id: h.record.id, assessment: { state: 'disabled' } }] }));
  assert.equal((await h.d.send(h.record.id)).state, 'delivered'); assert.equal(h.requests.filter(r => r.method === 'POST').length, 0);
});

test('account changes, disconnect, credential expiry and changed input guard pause delivery', async () => {
  for (const scenario of ['account', 'disconnect', 'expiry', 'inputs']) {
    const h = await harness();
    if (scenario === 'account') h.account('account-b');
    if (scenario === 'disconnect') await h.d.disconnect();
    if (scenario === 'expiry') { const c = await h.d.connection(); c.expires_at = 0; await h.store.set('tracker-connection', c); }
    if (scenario === 'inputs') h.d.guard = async () => { throw new Error('Deleted capture'); };
    assert.equal((await h.d.send(h.record.id)).state, 'paused'); assert.equal(h.requests.filter(r => r.method === 'POST').length, 0);
  }
  const h = await harness(); await h.d.disconnect(); h.account('account-b'); await h.d.connect('http://127.0.0.1:3000', 'OTHER_TOKEN');
  await assert.rejects(() => h.d.freeze(h.prepared, {}), /already frozen/);
});

test('HTTP errors retain frozen evidence and stop, pause or use bounded Retry-After backoff', async () => {
  const states = { 401: 'paused', 403: 'paused', 409: 'conflict', 410: 'stopped', 413: 'too_large', 422: 'validation_error', 429: 'retry_wait', 503: 'retry_wait' };
  for (const [status, state] of Object.entries(states)) {
    const h = await harness(); h.handler(() => Response.json({ error: { code: 'TEST', reasons: ['reason'] } }, { status: Number(status), headers: { 'Retry-After': '60' } }));
    const saved = await h.d.send(h.record.id); assert.equal(saved.state, state); assert.equal(saved.body, h.prepared.json); assert.equal(saved.id, h.record.id);
    if ([429, 503].includes(Number(status))) { assert.ok(saved.next_retry_at >= h.d.now() + 60000); await h.d.send(saved.id); assert.equal(h.requests.filter(r => r.method === 'POST').length, 1); }
    if (Number(status) === 422) assert.deepEqual(saved.validation.reasons, ['reason']);
    if (['conflict', 'stopped', 'too_large', 'validation_error'].includes(state)) { await h.d.send(saved.id); assert.equal(h.requests.filter(r => r.method === 'POST').length, 1); }
  }
});

test('byte limits, altered prepared data and altered frozen bodies reject without trimming', async () => {
  const h = await harness(), c = await h.d.connection(); c.limits.max_capture_bytes = 1; await h.store.set('tracker-connection', c);
  await assert.rejects(() => h.d.freeze(h.prepared, {}), /byte limit/);
  c.limits.max_capture_bytes = 262144; await h.store.set('tracker-connection', c);
  await assert.rejects(() => h.d.freeze({ ...h.prepared, bytes: 1 }, {}), /byte count/);
  h.record.body += ' '; await h.d.save(h.record);
  assert.equal((await h.d.send(h.record.id)).state, 'paused');
  assert.equal(h.requests.filter(r => r.method === 'POST').length, 0);
});
