import { defaults } from './core.js';
export const isExtension = !!globalThis.chrome?.runtime?.id;
export async function load() {
  const value = isExtension ? (await chrome.storage.local.get('state')).state : JSON.parse(localStorage.getItem('job-hunt-fill') || 'null');
  return { ...structuredClone(defaults), ...value, settings: { ...defaults.settings, ...value?.settings }, profile: { ...value?.profile } };
}
export async function save(state) {
  if (isExtension) await chrome.storage.local.set({ state });
  else localStorage.setItem('job-hunt-fill', JSON.stringify(state));
}
