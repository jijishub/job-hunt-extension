import { isExtension } from './storage.js';
import { extractPosting } from './posting-extractor.js';
export async function capturePosting() {
  const tab = await activePage();
  const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractPosting });
  if (!result?.result) throw new Error('The page changed or could not be read. Open the full posting and try again.');
  const current = await chrome.tabs.get(tab.id);
  if (current.url !== result.result.page_url) throw new Error('The posting changed during capture. Capture it again.');
  return result.result;
}
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
