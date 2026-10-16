import { isExtension } from './storage.js';
export async function activePage() {
  if (!isExtension) throw new Error('Page filling works in the installed extension. Load the build folder in chrome://extensions.');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https?:/.test(tab.url || '')) throw new Error('Open a normal job application webpage first. Browser settings and store pages cannot be filled.');
  return tab;
}
export async function scanPage() {
  const tab = await activePage();
  await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['content.js'] });
  const results = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: () => window.__jobHuntFill?.scan() });
  return { tabId: tab.id, url: tab.url, frames: results.filter(r => r.result?.fields?.length).map(r => ({ frameId: r.frameId, documentId: r.documentId, ...r.result })) };
}
export async function runFrame(page, frame, action, payload) {
  const tab = await activePage();
  if (tab.id !== page.tabId || tab.url !== page.url) throw new Error('The application page changed. Scan it again before filling.');
  const result = await chrome.scripting.executeScript({ target: { tabId: page.tabId, documentIds: [frame.documentId] }, func: async (action, payload) => {
    if (!window.__jobHuntFill) throw new Error('Page changed. Scan again.');
    return window.__jobHuntFill[action](payload);
  }, args: [action, payload ?? null] });
  return result[0]?.result;
}
