import { isExtension } from './storage.js';
import { workStore, oneAtATime, withCaptureDataLock } from './local-work-store.js';
const prefix = 'posting-capture:';
const activeKey = 'capture-active-id';
const tabPrefix = 'capture-tab:';
export async function captureWorkspaces() {
  if (!isExtension) return workStore.list(tabPrefix);
  return Object.entries(await chrome.storage.session.get(null)).filter(([key])=>key.startsWith(tabPrefix)).map(([,value])=>value);
}
export async function captureWorkspace(tabId) {
  const key = tabPrefix + tabId;
  return isExtension ? (await chrome.storage.session.get(key))[key] : await workStore.get(key);
}
export async function updateCaptureWorkspace(tabId, patch) {
  const key = tabPrefix + tabId, workspace = {...await captureWorkspace(tabId), tab_id:tabId, ...patch};
  if (isExtension) await chrome.storage.session.set({[key]:workspace});
  else await workStore.set(key, workspace);
  return workspace;
}
const samePage = (a,b) => { try { const x=new URL(a),y=new URL(b);x.hash='';y.hash='';return x.href===y.href; } catch { return a===b; } };
export async function activeCaptureId(captures, tabId = 'preview', url) {
  let workspace = await captureWorkspace(tabId);
  if (!workspace) {
    // Migrate only the old posting that actually belongs to this page.
    const legacy = await workStore.get(activeKey);
    const capture = isExtension ? captures.find(c=>c.id===legacy && url && samePage(c.snapshot.page_url,url)) : captures.find(c=>c.id===legacy) || captures[0];
    workspace = await updateCaptureWorkspace(tabId,{capture_id:capture?.id || null,page_url:url || null});
    if(capture)await workStore.remove(activeKey);
  } else if (url && workspace.page_url && !samePage(url,workspace.page_url)) {
    workspace = await updateCaptureWorkspace(tabId,{capture_id:null,page_url:url});
  } else if(isExtension && !url && workspace.capture_id) {
    workspace = await updateCaptureWorkspace(tabId,{capture_id:null,page_url:null});
  }
  return workspace.capture_id || null;
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
async function pruneCaptureRecords() {
  const active = new Set((await captureWorkspaces()).map(w=>w.capture_id).filter(Boolean));
  const terminal = new Set(['delivered', 'stopped', 'conflict', 'too_large', 'validation_error']);
  const pending = new Set((await workStore.list('capture-delivery:')).filter(d=>!terminal.has(d.state)).map(d=>d.id));
  const retained = new Set([...active,...pending]);
  for (const previous of await loadCaptures()) {
    if(retained.has(previous.id))continue;
    await deleteCapture(previous.id);
    await workStore.remove('capture-delivery:'+previous.id);
  }
  for(const job of await workStore.list('fit-job:'))if(!retained.has(job.inputs.capture_id))await workStore.remove('fit-job:'+job.id);
}
export async function cleanupCaptureTabs() {
  await withCaptureWorkIdle(async()=>{
    if(isExtension){
      const open = new Set((await chrome.tabs.query({})).map(t=>t.id));
      for(const workspace of await captureWorkspaces())if(!open.has(workspace.tab_id))await chrome.storage.session.remove(tabPrefix+workspace.tab_id);
    }
    await pruneCaptureRecords();
  });
}
export async function startCapture(capture, tabId = 'preview') {
  await withCaptureWorkIdle(async () => {
    await saveCapture(capture);
    await updateCaptureWorkspace(tabId,{capture_id:capture.id,page_url:capture.snapshot.page_url});
    // Keep other tabs and outstanding frozen requests with their original evidence.
    await pruneCaptureRecords();
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
  for(const workspace of await captureWorkspaces())await updateCaptureWorkspace(workspace.tab_id,{capture_id:null});
}
