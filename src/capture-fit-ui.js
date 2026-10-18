import { load } from './storage.js';
import { loadCaptures, captureWorkspaces } from './capture-storage.js';
import { workStore } from './local-work-store.js';
import { makeFitInputs, PROMPT_VERSION, canonicalJSON } from './role-fit.js';
import { RoleFitQueue } from './role-fit-queue.js';
import { CaptureDelivery, JOB_HUNT_ORIGIN } from './capture-delivery.js';
import { serializeCapture } from './capture-transport.js';
import { serializeAssessedCapture } from './assessed-capture.js';
import { TrackerPreferences, effectivePreferences } from './tracker-preferences.js';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const resumeFor = (state, index) => ({ id: `resume-slot-${index + 1}`, label: state.resumes[index]?.name ?? null, text: state.resumes[index]?.text });
export async function clearCaptureRecords() {
  for (const prefix of ['fit-job:', 'capture-delivery:']) for (const record of await workStore.list(prefix)) await workStore.remove(prefix + record.id);
}
export async function clearCaptureWork() {
  await clearCaptureRecords();
  await workStore.remove('fit-preferences'); await workStore.remove('tracker-preferences'); await workStore.remove('tracker-connection');
}
export class CaptureFitPanel {
  jobs = []; deliveries = []; preferences = null; localPreferences = null; preferenceSource = null; connection = null;
  constructor(owner) {
    this.owner = owner;
    this.queue = new RoleFitQueue({ resolveInputs: inputs => this.resolve(inputs), getSettings: async () => (await load()).settings });
    this.delivery = new CaptureDelivery({ guard: record => this.deliveryGuard(record) });
    this.preferenceSync = new TrackerPreferences({delivery:this.delivery,onStatus:()=>{const label=globalThis.document?.querySelector('.preference-live-status');if(label)label.textContent=this.preferenceStatus()}});
  }
  async load() { await this.queue.recover(); await this.delivery.recover(); await this.reload(); }
  async reload() {
    [this.jobs, this.deliveries, this.localPreferences, this.connection] = await Promise.all([this.queue.jobs(), this.delivery.records(), workStore.get('fit-preferences'), this.delivery.connection()]);
    const snapshot=await this.preferenceSync.cached(this.connection);
    this.preferences=effectivePreferences(snapshot,this.localPreferences);
    this.preferenceSource=snapshot ? {origin:snapshot.origin,account_id:snapshot.account_id} : null;
  }
  setLiveActive(active) { this.preferenceSync.setActive(active,this.connection); }
  preferenceStatus() {
    if(!this.connection?.capabilities.preferences)return 'Preferences not shared. Enable sharing on a new Job Hunt credential.';
    const state=this.preferenceSync.status;
    return ({live:'Job Hunt preferences: live',shared:'Job Hunt preferences: live in another panel',connecting:'Connecting preference updates…',reconnecting:'Preference updates reconnecting…',reconnect:'Reconnect Job Hunt to restore preference updates',error:'Preference updates unavailable'})[state] || 'Job Hunt preferences sync before assessment';
  }
  async preferenceContext(fresh = true) {
    const c=await this.delivery.connection(), local=await workStore.get('fit-preferences');
    const snapshot=c?.capabilities.preferences === true ? fresh ? await this.preferenceSync.fresh(c) : await this.preferenceSync.cached(c) : null;
    const source=snapshot ? {origin:snapshot.origin,account_id:snapshot.account_id} : null;
    return {preferences:effectivePreferences(snapshot,local),source};
  }
  async resolve(previous) {
    const state = await load(), capture = (await loadCaptures()).find(c => c.id === previous.capture_id);
    if (!capture || this.preferenceDraft || this.owner.drafts.has(capture.id)) throw new Error('Save current capture review/preferences first.');
    const index = Number(previous.resume.id.replace('resume-slot-', '')) - 1;
    const context=await this.preferenceContext();
    return makeFitInputs(capture, await serializeCapture(capture), resumeFor(state, index), context.preferences, state.settings, context.source);
  }
  async inputs(index = this.runtime.getState().selected) {
    const capture = this.owner.current;
    if (!capture || this.owner.drafts.has(capture.id)) throw new Error('Save corrections and current review first.');
    const state = await load(), saved = (await loadCaptures()).find(c => c.id === capture.id);
    if (!saved || canonicalJSON(saved) !== canonicalJSON(capture)) throw new Error('The capture changed in another panel. Reopen the panel before proceeding.');
    const context=await this.preferenceContext();this.preferences=context.preferences;this.preferenceSource=context.source;
    return makeFitInputs(capture, await serializeCapture(capture), resumeFor(state, index), context.preferences, state.settings, context.source);
  }
  matches(job, capture) {
    if (!this.runtime || !capture || this.preferenceDraft || this.owner.drafts.has(capture.id)) return false;
    if(this.connection?.capabilities.preferences === true && !this.preferenceSource)return false;
    const s = this.runtime.getState(), r = resumeFor(s, s.selected), i = job.inputs;
    return job.state === 'succeeded' && i.capture_id === capture.id && i.review_hash === capture.review_basis_hash &&
      i.resume.id === r.id && i.resume.text === r.text && i.resume.label === r.label && i.model === s.settings.model &&
      i.baseUrl === s.settings.baseUrl && i.prompt_version === PROMPT_VERSION && canonicalJSON(i.preferences) === canonicalJSON(this.preferences) && canonicalJSON(i.preference_source || null) === canonicalJSON(this.preferenceSource);
  }
  async prepare(unassessed = false) {
    const c = this.owner.current;
    if (this.owner.drafts.has(c.id)) throw new Error('Save corrections and review before preparing a request.');
    const job = !unassessed && this.jobs.find(j => this.matches(j, c));
    if(!unassessed && !job)throw new Error('Assess the current posting before saving its fit.');
    const prepared = job ? await serializeAssessedCapture(c, await this.inputs(), job) : await serializeCapture(c);
    this.owner.transport.set(c.id, prepared); return prepared;
  }
  async assessCurrent() {
    if(this.preferenceDraft)throw new Error('Save preference edits in Settings first.');
    const capture=this.owner.current;
    if((await this.delivery.records()).some(r=>r.id===capture?.id))throw new Error('This capture already has a saved request. Continue its save instead of assessing it again.');
    const inputs=await this.inputs();
    await this.reload();
    if(this.jobs.some(j=>this.matches(j,capture)))return;
    const pending=this.jobs.find(j=>['queued','interrupted'].includes(j.state) && j.inputs.binding_hash===inputs.binding_hash);
    const job=pending || await this.queue.enqueue(inputs);
    const result=await this.queue.run([job.id]);
    if(result===null)throw new Error('Another AI request is active. Try this assessment again after it finishes.');
    await this.reload();
    if(!this.jobs.some(j=>this.matches(j,capture)))throw new Error(this.jobs.find(j=>j.id===job.id)?.error || 'The assessment did not finish. Try again when ready.');
  }
  async freezeCurrent(prepared, expectedConnection = null) {
    if (this.preferenceDraft) throw new Error('Save preference edits first.');
    const current = await this.prepare(!prepared.payload.extension_assessment);
    if (current.json !== prepared.json) { this.owner.transport.delete(this.owner.current.id); throw new Error('Inputs changed since preparation. Prepare a fresh request.'); }
    const base = await serializeCapture(this.owner.current), hasFit = !!prepared.payload.extension_assessment;
    return this.delivery.freeze(prepared, { review_hash: this.owner.current.review_basis_hash, capture_json: JSON.stringify(base.payload), inputs: hasFit ? await this.inputs() : null }, expectedConnection);
  }
  async saveToJobHunt(unassessed = false) {
    const capture = this.owner.current;
    if (!capture || this.owner.drafts.has(capture.id) || this.preferenceDraft) throw new Error('Save current corrections, review and preferences first.');
    const connection = await this.delivery.connection();
    if (!connection?.verified || Date.now() >= connection.expires_at) throw new Error('Connect Job Hunt with a current tracker credential first.');
    // A frozen or delivered capture is immutable. Continue that delivery before
    // doing any AI work; never change its bytes or manufacture a new capture ID.
    const existing = (await this.delivery.records()).find(r => r.id === capture.id);
    if (existing) {
      if (unassessed && JSON.parse(existing.body).extension_assessment) throw new Error('The frozen request includes a fit. Use Continue saved delivery to send that exact request; it cannot be changed to Unassessed under the same capture ID.');
      return this.delivery.send(existing.id);
    }
    const verified = await this.delivery.verify(connection.origin, connection.credential);
    if (verified.account.id !== connection.account.id) throw new Error('The connected Job Hunt account changed. Reconnect the intended account before saving.');
    if (!unassessed) {
      if (verified.capabilities.extension_assessments !== true) throw new Error('This Job Hunt server does not accept extension fit results yet. Deploy the current capture API or save without assessment.');
      const inputs = await this.inputs(); // Includes current identity/completeness validation.
      await this.reload();
      if (!this.jobs.some(j => this.matches(j, capture) && j.inputs.binding_hash===inputs.binding_hash)) throw new Error('Assess the current posting first, read the result, then save it to Job Hunt.');
    }
    const prepared = await this.prepare(unassessed), frozen = await this.freezeCurrent(prepared, { origin: connection.origin, account_id: connection.account.id });
    return this.delivery.send(frozen.id);
  }
  async deliveryGuard(record) {
    const capture = (await loadCaptures()).find(c => c.id === record.id);
    if (!capture || this.owner.drafts.has(record.id)) return false;
    const base = await serializeCapture(capture);
    if (record.guard.review_hash !== capture.review_basis_hash || JSON.stringify(base.payload) !== record.guard.capture_json) return false;
    if (record.guard.inputs) {
      const workspace=(await captureWorkspaces()).find(w=>w.capture_id===record.id);
      if(workspace?.resume_index != null && record.guard.inputs.resume.id !== `resume-slot-${workspace.resume_index + 1}`)return false;
      return (await this.resolve(record.guard.inputs)).binding_hash === record.guard.inputs.binding_hash;
    }
    return true;
  }
  renderSettings(busy) {
    const c=this.connection, disabled=busy?'disabled':'';
    const connected=c?.verified && Date.now()<c.expires_at;
    const recoverable=this.deliveries.filter(r=>!['delivered','stopped','conflict','too_large','validation_error'].includes(r.state));
    const label=r=>{try{return JSON.parse(r.body).posting?.role_title || 'Saved posting';}catch{return 'Saved posting';}};
    return `<section class="card tracker-settings"><h2>Job Hunt connection</h2>
      <p class="connection-status">${connected ? `Connected as ${esc(c.account.email)}` : c ? 'Connection expired or needs reconnecting.' : 'Connect Job Hunt to save reviewed postings and fit results.'}</p>
      <p class="hint"><a href="${JOB_HUNT_ORIGIN}" target="_blank" rel="noreferrer">Create an extension credential in Job Hunt</a> under My preferences → Job Hunt extension.</p>
      <form id="tracker-connect-form"><label class="label" for="tracker-origin">Server address</label><input id="tracker-origin" type="url" value="${esc(c?.origin || JOB_HUNT_ORIGIN)}" required ${disabled}>
      <label class="label" for="tracker-credential">${c?'New extension credential':'Extension credential'}</label><input id="tracker-credential" type="password" autocomplete="off" required ${disabled}>
      <button class="button secondary full" ${disabled}>${c?'Update connection':'Connect Job Hunt'}</button></form>
      ${c?`<p class="hint">Credential expires ${esc(new Date(c.expires_at).toLocaleString())}</p><button id="tracker-disconnect" class="text-button" ${disabled}>Disconnect Job Hunt</button>`:''}
      </section><section class="card"><h2>Additional preference notes</h2><p class="hint">Optional notes shared across tabs. ${c?.capabilities.preferences?'Added to your saved Job Hunt preferences.':'Used when Job Hunt preferences are not shared.'}</p>
      <form id="fit-preferences-form"><textarea id="fit-preferences" aria-label="Additional preference notes" maxlength="12000" rows="3" ${disabled}>${esc(this.preferenceDraft?this.preferenceDraftText:this.localPreferences?.notes || '')}</textarea><button class="button secondary full" ${disabled}>Save notes</button></form></section>
      ${recoverable.length?`<section class="card"><h2>Unfinished saves</h2><p class="hint">Retrying checks the original save and never runs AI again.</p>${recoverable.map(r=>`<article><h3>${esc(label(r))}</h3>${r.error?`<p class="hint">${esc(r.error)}</p>`:''}<button data-delivery-send="${esc(r.id)}" class="button secondary full" ${disabled}>Retry save</button></article>`).join('')}</section>`:''}`;
  }
  render(capture, busy) {
    if(!capture || !this.runtime)return '';
    const s=this.runtime.getState(), disabled=busy?'disabled':'';
    const current=this.jobs.find(j=>this.matches(j,capture));
    const latest=this.jobs.find(j=>j.inputs.capture_id===capture.id && j.inputs.resume.id===`resume-slot-${s.selected+1}`);
    const c=this.connection, connected=c?.verified && Date.now()<c.expires_at;
    const delivery=this.deliveries.find(r=>r.id===capture.id), saved=delivery?.state==='delivered';
    const terminal=delivery && ['stopped','conflict','too_large','validation_error'].includes(delivery.state);
    const reviewed=this.owner.readiness.get(capture.id)?.eligible && !this.owner.drafts.has(capture.id);
    const hasResume=!!s.resumes[s.selected]?.text;
    const canAssess=reviewed && hasResume && !this.preferenceDraft && !delivery;
    const canSave=connected && !this.preferenceDraft && !this.owner.drafts.has(capture.id) && !terminal && (delivery || reviewed && current);
    const outcome=r=>r.receipt?.record_deleted?'The linked role was deleted. It has not been recreated.':r.receipt?.disposition==='draft'?'Saved as a draft in Job Hunt.':r.receipt?.extension_assessment?.disposition==='stored_only'?'Saved to capture history. Your existing role and rating were kept.':r.receipt?.extension_assessment?.disposition==='applied'?'Posting and fit saved as a Not started role.':'Posting saved without assessment.';
    return `<section class="card capture-fit"><div class="section-head"><span class="step">3</span><h2>Assess role fit</h2></div>
      <label class="label" for="fit-resume">Resume for this job</label><select id="fit-resume" ${disabled}>${s.resumes.map((r,i)=>`<option value="${i}" ${s.selected===i?'selected':''}>${esc(r?.name || `Version ${i+1} (empty)`)}</option>`).join('')}</select>
      ${connected?`<p class="hint preference-live-status" role="status">${esc(this.preferenceStatus())}</p>`:''}
      ${!hasResume?'<p class="hint">Add a resume in the Resumes tab first.</p>':''}
      ${!reviewed?'<p class="hint">Confirm the posting review above before assessing.</p>':''}
      ${this.preferenceDraft?'<p class="hint">Save your preference changes in Settings first.</p>':''}
      ${!current && !delivery?`<button id="fit-assess" class="button primary full fit-assess-action" ${busy || !canAssess?'disabled':''}>${busy==='fit'?'Assessing…':latest && ['failed','interrupted','queued'].includes(latest.state)?'Retry assessment only':'Assess fit only'}</button><p class="hint">Uses your AI gateway. Nothing is uploaded to Job Hunt.</p>`:''}
      ${latest?.error && !current && !delivery?`<p class="fit-error notice error">${esc(latest.error)}</p>`:''}
      ${current?`<section class="fit-result" aria-label="Role fit assessment"><h3>Role fit: ${esc(({STRONG:'Strong',POSSIBLE:'Possible',WEAK:'Weak'})[current.result.fit] || current.result.fit)}</h3><p>${esc(current.result.explanation)}</p><h4>Strengths</h4>${current.result.strengths.length?`<ul>${current.result.strengths.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:'<p>None identified.</p>'}<h4>Gaps</h4>${current.result.gaps.length?`<ul>${current.result.gaps.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:'<p>None identified.</p>'}<h4>Your preferences: ${esc(({ALIGNED:'Aligned',MIXED:'Mixed',MISALIGNED:'Not aligned',UNKNOWN:'Not assessed'})[current.result.preference_alignment])}</h4>${current.result.preference_notes?`<p>${esc(current.result.preference_notes)}</p>`:''}</section>`:''}
      <section class="capture-save"><h3>Save to Job Hunt</h3>
      ${saved?`<div class="capture-saved" role="status"><strong>Saved to Job Hunt</strong><p>${esc(outcome(delivery))}</p><a href="${esc(delivery.origin)}" target="_blank" rel="noreferrer">Open Job Hunt ↗</a></div>`:`<p class="hint">${delivery?'Continues the original save. No new AI request.':current?'Read the assessment above, then save the posting and result.':'Assess first to save this job with its fit result.'}</p>
      ${!connected?'<button id="capture-open-settings" class="text-button" '+disabled+'>Connect Job Hunt in Settings</button>':''}
      <button id="tracker-save" class="button secondary full" ${busy || !canSave?'disabled':''}>${busy==='deliver'?'Saving…':delivery?'Retry save to Job Hunt':'Save to Job Hunt'}</button>
      ${delivery?.error?`<p class="notice error">${esc(delivery.error)}</p>`:''}${delivery?.next_retry_at && Date.now()<delivery.next_retry_at?`<p class="hint">Try again after ${esc(new Date(delivery.next_retry_at).toLocaleTimeString())}.</p>`:''}
      ${!delivery && !current?`<button id="tracker-save-unassessed" class="text-button" ${busy || !connected || this.owner.drafts.has(capture.id) || this.preferenceDraft?'disabled':''}>Save without assessment</button><p class="hint">Saves only the posting. This capture cannot gain a fit later.</p>`:''}`}
      </section></section>`;
  }
  bind(app, task) {
    const on=(selector,event,fn)=>app.querySelector(selector)?.addEventListener(event,fn);
    const perform=(name,fn)=>task(name,async()=>{try{await fn();}finally{await this.reload();}});
    on('#fit-resume','change',e=>perform('save',()=>this.runtime.setSelected(Number(e.target.value))));
    on('#fit-preferences','input',e=>{
      this.owner.transport.clear();this.preferenceDraft=true;this.preferenceDraftText=e.target.value;
    });
    on('#fit-preferences-form','submit',e=>{e.preventDefault();const notes=app.querySelector('#fit-preferences').value;perform('save',async()=>{await workStore.set('fit-preferences',notes.trim()?{notes}:null);this.preferenceDraft=false;this.owner.transport.clear();});});
    on('#fit-assess','click',()=>perform('fit',()=>this.assessCurrent()));
    on('#tracker-connect-form','submit',e=>{e.preventDefault();const origin=app.querySelector('#tracker-origin').value,token=app.querySelector('#tracker-credential').value;perform('connect',()=>this.delivery.connect(origin,token));});
    on('#tracker-disconnect','click',()=>perform('connect',async()=>{this.preferenceSync.stop();await this.delivery.disconnect();await workStore.remove('tracker-preferences');}));
    on('#tracker-save','click',()=>perform('deliver',()=>this.saveToJobHunt(false)));
    on('#tracker-save-unassessed','click',()=>perform('deliver',()=>this.saveToJobHunt(true)));
    app.querySelectorAll('[data-delivery-send]').forEach(button=>button.addEventListener('click',()=>perform('deliver',async()=>{
      if(this.preferenceDraft)throw new Error('Save preference edits first.');
      await this.delivery.send(button.dataset.deliverySend);
    })));
  }
}
