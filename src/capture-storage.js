import { isExtension } from './storage.js';
import { workStore, oneAtATime, withCaptureDataLock } from './local-work-store.js';
const prefix = 'posting-capture:';
const activeKey = 'capture-active-id';
export async function activeCaptureId(captures) {
  const id = await workStore.get(activeKey);
  // Existing installations initially open their latest capture.
  return id === undefined || id === null ? captures[0]?.id || null : id || null;
}
export async function withCaptureWorkIdle(work) {
  const unavailable = () => { throw new Error('An assessment or delivery is running. Let it finish, then try again.'); };
  if (!globalThis.navigator?.locks) {
    const result = await oneAtATime('job-hunt-capture-work', async () => { await withCaptureDataLock(work); return true; });
    if (result === null) unavailable();
    return;
  }
  await navigator.locks.request('job-hunt-role-fit', { ifAvailable: true }, async fitLock => {
    if (!fitLock) unavailable();
    await navigator.locks.request('job-hunt-delivery', { ifAvailable: true }, async deliveryLock => {
      if (!deliveryLock) unavailable();
      await withCaptureDataLock(work);
    });
  });
}
export async function startCapture(capture) {
  await withCaptureWorkIdle(async () => {
    await saveCapture(capture);
    await workStore.set(activeKey, capture.id);
    const deliveries = await workStore.list('capture-delivery:');
    const terminal = new Set(['delivered', 'stopped', 'conflict', 'too_large', 'validation_error']);
    // Keep outstanding frozen requests and their review evidence recoverable.
    const pending = new Set(deliveries.filter(d => !terminal.has(d.state)).map(d => d.id));
    for (const previous of await loadCaptures()) {
      if (previous.id === capture.id || pending.has(previous.id)) continue;
      await deleteCapture(previous.id);
      await workStore.remove('capture-delivery:' + previous.id);
    }
    for (const job of await workStore.list('fit-job:')) {
      if (job.inputs.capture_id !== capture.id && !pending.has(job.inputs.capture_id)) await workStore.remove('fit-job:' + job.id);
    }
  });
}
export async function loadCaptures() {
  const data = isExtension ? await chrome.storage.local.get(null) : Object.fromEntries(Object.keys(localStorage).filter(k => k.startsWith(prefix)).map(k => [k, JSON.parse(localStorage.getItem(k))]));
  return Object.entries(data).filter(([key]) => key.startsWith(prefix)).map(([, value]) => value).sort((a, b) => b.snapshot.captured_at.localeCompare(a.snapshot.captured_at));
}
export async function saveCapture(capture) {
  const key = prefix + capture.id;
  if (isExtension) await chrome.storage.local.set({ [key]: capture });
  else localStorage.setItem(key, JSON.stringify(capture));
}
export async function deleteCapture(id) {
  if (isExtension) await chrome.storage.local.remove(prefix + id);
  else localStorage.removeItem(prefix + id);
}
export async function clearCaptures() {
  const captures = await loadCaptures();
  for (const capture of captures) await deleteCapture(capture.id);
  await workStore.set(activeKey, '');
}
