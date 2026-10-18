import { isExtension } from './storage.js';
import { extractPosting } from './posting-extractor.js';
export async function capturePosting() {
  const tab = await activePage();
  const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractPosting });
  if (!result?.result) throw new Error('The page changed or could not be read. Open the full posting and try again.');
  const current = await chrome.tabs.get(tab.id);
  if (current.url !== result.result.page_url) throw new Error('The posting changed during capture. Capture it again.');
  if (result.result.selection_guard) {
    const [check] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, args: [result.result.selection, result.result.selection_guard], func: (selection, guard) => {
      const visible = n => { for (; n; n = n.parentElement) if (n.hidden || n.getAttribute('aria-hidden') === 'true' || getComputedStyle(n).display === 'none' || getComputedStyle(n).visibility === 'hidden') return false; return true; };
      const root = guard.root_locator ? document.querySelector(guard.root_locator) : [...document.querySelectorAll(guard.pane_selector)].find(visible) || (location.pathname.includes('/jobs/view/') ? document.querySelector('main, [role="main"]') : null);
      const heading = guard.title_missing ? null : guard.title_locator ? document.querySelector(guard.title_locator) : root?.querySelector(guard.title_selector) || root?.querySelector('h1');
      const body = guard.description_locator ? document.querySelector(guard.description_locator) : guard.description_selector.split(',').flatMap(selector => [...(root?.querySelectorAll(selector.trim()) || [])]).find(visible);
      const idFrom = value => { try { const url = new URL(value, location.href); return url.pathname.match(/\/jobs\/view\/(?:[^/?#]*-)?(\d+)(?:[/?#]|$)/)?.[1] || url.searchParams.get('currentJobId'); } catch { return null; } };
      const link = heading?.matches('a[href]') ? heading : heading?.querySelector('a[href*="/jobs/view/"]');
      const linkId = idFrom(link?.href), urlId = idFrom(location.href);
      const paneId = root?.getAttribute('data-job-id') || root?.getAttribute('data-current-job-id') || root?.getAttribute('data-entity-urn')?.match(/jobPosting:(\d+)/)?.[1];
      const bodyId = body?.closest('[data-job-description-id]')?.getAttribute('data-job-description-id') || body?.closest('[data-job-id]')?.getAttribute('data-job-id');
      const header = guard.header_locator ? document.querySelector(guard.header_locator) : null;
      const headerMatches = !guard.header_locator || !!header && visible(header) && !!root?.contains(header) && header.textContent === guard.header_text;
      const titleMatches = guard.title_missing ? !guard.title && !guard.title_locator : !!heading && visible(heading) && !!root?.contains(heading) && heading.textContent.replace(/\s+/g, ' ').trim() === guard.title.replace(/\s+/g, ' ').trim();
      return !!root && !!body && visible(root) && visible(body) && titleMatches && headerMatches && root.contains(body) && body.textContent === guard.description_text &&
        [urlId, linkId, paneId, bodyId].filter(Boolean).every(id => id === selection.job_id) && !!(urlId || linkId || paneId);
    } });
    if (!check?.result) throw new Error('The selected LinkedIn job changed during capture. Wait for its description, then capture again.');
    delete result.result.selection_guard;
  }
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
