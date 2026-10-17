import assert from 'node:assert/strict';
import { localTracker } from './helpers/local-tracker.js';
import { reviewedCapture, settings, resume, result, MemoryStore } from './helpers/fit-fixture.js';
import { serializeCapture } from '../src/capture-transport.js';
import { serializeAssessedCapture } from '../src/assessed-capture.js';
import { makeFitInputs, callRoleFit } from '../src/role-fit.js';
import { RoleFitQueue } from '../src/role-fit-queue.js';
import { CaptureDelivery } from '../src/capture-delivery.js';

const tracker = await localTracker();
try {
  const user = await tracker.db.getOrCreateUser({ name: 'Extension interoperability', email: 'extension-interop@example.invalid' });
  const other = await tracker.db.getOrCreateUser({ name: 'Other account', email: 'other-interop@example.invalid' });
  const credential = await tracker.store.issueExtensionCredential(user.id, 'Isolated extension test');
  const foreign = await tracker.store.issueExtensionCredential(other.id, 'Isolated other account');
  const store = new MemoryStore(); let calls = 0, active;
  const queue = new RoleFitQueue({ store, resolveInputs: async () => active, getSettings: async () => settings,
    call: (inputs, s) => callRoleFit(inputs, s, { fetcher: async (_url, options) => {
      calls++; const sent = JSON.parse(options.body); assert.equal(JSON.parse(sent.messages[1].content).resume, resume.text);
      return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(result) } }] });
    } }) });
  async function prepare(url) {
    const capture = await reviewedCapture(url);
    active = await makeFitInputs(capture, await serializeCapture(capture), resume, null, settings);
    const job = await queue.enqueue(active); await queue.run();
    return serializeAssessedCapture(capture, active, await store.get('fit-job:' + job.id));
  }
  let lost = false, now = Date.now();
  const delivery = new CaptureDelivery({ store, now: () => now, fetcher: async (url, options) => {
    const response = await fetch(url, options);
    if (!lost && options.method === 'POST') { lost = true; await response.text(); throw new Error('Synthetic lost receipt after committed ingestion'); }
    return response;
  } });
  await delivery.connect(tracker.origin, credential.token);
  const first = await prepare('https://jobs.lever.co/example/interop');
  await delivery.freeze(first, {});
  assert.equal((await delivery.send(first.payload.capture_id)).state, 'uncertain');
  now += 600000;
  const recovered = await delivery.send(first.payload.capture_id);
  assert.equal(recovered.state, 'delivered'); assert.equal(recovered.receipt.extension_assessment.disposition, 'applied');
  assert.equal(recovered.receipt.assessment.state, 'disabled'); assert.equal(calls, 1);
  assert.equal(tracker.requests.filter(r => r.method === 'POST').length, 1, 'receipt lookup recovers committed POST without a second upload');
  const app = await tracker.db.getApplicationById(recovered.receipt.application_id, user);
  assert.equal(app.role_fit, 'STRONG'); assert.equal(app.role_fit_analysis.origin, 'extension'); assert.equal(app.priority, 'HIGH');
  assert.equal(app.role_fit_analysis.extension_context.resume_hash, first.payload.extension_assessment.resume.sha256);
  await tracker.db.updateApplication(app.id, { role_fit: 'WEAK', role_fit_source: 'manual', priority: 'DREAM', information: 'Preserve existing edits.' });
  const second = await prepare('https://jobs.lever.co/example/interop');
  await delivery.freeze(second, {}); const existing = await delivery.send(second.payload.capture_id);
  assert.equal(existing.state, 'delivered'); assert.equal(existing.receipt.extension_assessment.disposition, 'stored_only');
  const saved = await tracker.db.getApplicationById(app.id, user);
  assert.equal(saved.role_fit, 'WEAK'); assert.equal(saved.priority, 'DREAM'); assert.equal(saved.information, 'Preserve existing edits.');
  assert.equal(calls, 2);
  const pending = await prepare('https://jobs.lever.co/example/other'); await delivery.freeze(pending, {});
  await delivery.connect(tracker.origin, foreign.token);
  assert.equal((await delivery.send(pending.payload.capture_id)).state, 'paused');
  const foreignRead = await fetch(`${tracker.origin}/api/v1/captures?ids=${first.payload.capture_id}`, { headers: { Authorization: `Bearer ${foreign.token}` } });
  assert.deepEqual((await foreignRead.json()).captures, []);
  await delivery.connect(tracker.origin, credential.token);
  assert.equal((await delivery.send(pending.payload.capture_id)).state, 'delivered');
  const replay = await fetch(`${tracker.origin}/api/v1/captures`, { method: 'POST', headers: { ...first.headers, Authorization: `Bearer ${credential.token}` }, body: first.json });
  assert.equal(replay.status, 200); assert.equal(calls, 3, 'delivery never reruns AI');
  const conflict = structuredClone(first.payload); conflict.posting.role_title = 'Altered after freeze';
  const conflictResponse = await fetch(`${tracker.origin}/api/v1/captures`, { method: 'POST', headers: { ...first.headers, Authorization: `Bearer ${credential.token}` }, body: JSON.stringify(conflict) });
  assert.equal(conflictResponse.status, 422, 'actual tracker rejects stale final posting hash');
  for (const request of tracker.requests) {
    assert.match(request.url, /\/api\/v1\/(?:connection|captures)/);
    assert.doesNotMatch(request.body, /Exact résumé evidence|PRIVATE_GATEWAY_KEY|"messages"|"profile"|"baseUrl"/);
  }
  console.log('PASS actual local tracker routes over loopback HTTP: authenticated import, canonical hashes, applied/stored_only, immutable retry receipt, account isolation, stale hash rejection, no tracker AI/resume/preference calls.');
} finally { await tracker.close(); }
