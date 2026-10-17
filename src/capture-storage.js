import { isExtension } from './storage.js';
const prefix = 'posting-capture:';
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
}
