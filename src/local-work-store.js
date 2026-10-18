import { isExtension } from './storage.js';
export const workStore = {
  async get(key) { return isExtension ? (await chrome.storage.local.get(key))[key] : JSON.parse(localStorage.getItem(key) || 'null'); },
  async set(key, value) { if (isExtension) await chrome.storage.local.set({ [key]: value }); else localStorage.setItem(key, JSON.stringify(value)); },
  async remove(key) { if (isExtension) await chrome.storage.local.remove(key); else localStorage.removeItem(key); },
  async list(prefix) {
    const all = isExtension ? await chrome.storage.local.get(null) : Object.fromEntries(Object.keys(localStorage).filter(k => k.startsWith(prefix)).map(k => [k, JSON.parse(localStorage.getItem(k))]));
    return Object.entries(all).filter(([key]) => key.startsWith(prefix)).map(([, value]) => value);
  }
};
let localLock = false;
export async function withCaptureDataLock(work) {
  if (globalThis.navigator?.locks) return navigator.locks.request('job-hunt-capture-data', work);
  return work();
}
export async function oneAtATime(name, work) {
  if (globalThis.navigator?.locks) return navigator.locks.request(name, { ifAvailable: true }, lock => lock ? work() : null);
  // Node tests share this module. Chrome extension pages use the cross-page lock.
  if (localLock) return null;
  localLock = true;
  try { return await work(); } finally { localLock = false; }
}
