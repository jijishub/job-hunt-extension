import { load } from './storage.js';
import { loadCaptures } from './capture-storage.js';
import { workStore } from './local-work-store.js';
import { makeFitInputs, PROMPT_VERSION, canonicalJSON } from './role-fit.js';
import { RoleFitQueue } from './role-fit-queue.js';
import { CaptureDelivery, JOB_HUNT_ORIGIN } from './capture-delivery.js';
import { serializeCapture } from './capture-transport.js';
import { serializeAssessedCapture } from './assessed-capture.js';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const resumeFor = (state, index) => ({ id: `resume-slot-${index + 1}`, label: state.resumes[index]?.name ?? null, text: state.resumes[index]?.text });
export async function clearCaptureWork() {
  for (const prefix of ['fit-job:', 'capture-delivery:']) for (const record of await workStore.list(prefix)) await workStore.remove(prefix + record.id);
  await workStore.remove('fit-preferences'); await workStore.remove('tracker-connection');
}
export class CaptureFitPanel {
  jobs = []; deliveries = []; preferences = null; connection = null;
  constructor(owner) {
    this.owner = owner;
    this.queue = new RoleFitQueue({ resolveInputs: inputs => this.resolve(inputs), getSettings: async () => (await load()).settings });
    this.delivery = new CaptureDelivery({ guard: record => this.deliveryGuard(record) });
  }
  async load() { await this.queue.recover(); await this.delivery.recover(); await this.reload(); }
  async reload() {
    [this.jobs, this.deliveries, this.preferences, this.connection] = await Promise.all([this.queue.jobs(), this.delivery.records(), workStore.get('fit-preferences'), this.delivery.connection()]);
    this.preferences ??= null;
  }
  async resolve(previous) {
    const state = await load(), capture = (await loadCaptures()).find(c => c.id === previous.capture_id);
    if (!capture || this.preferenceDraft || this.owner.drafts.has(capture.id)) throw new Error('Save current capture review/preferences first.');
    const index = Number(previous.resume.id.replace('resume-slot-', '')) - 1;
    return makeFitInputs(capture, await serializeCapture(capture), resumeFor(state, index), await workStore.get('fit-preferences'), state.settings);
  }
  async inputs(index = this.runtime.getState().selected) {
    const capture = this.owner.current;
    if (!capture || this.owner.drafts.has(capture.id)) throw new Error('Save corrections and current review first.');
    const state = await load(), saved = (await loadCaptures()).find(c => c.id === capture.id);
    if (!saved || canonicalJSON(saved) !== canonicalJSON(capture)) throw new Error('The capture changed in another panel. Reopen the panel before proceeding.');
    return makeFitInputs(capture, await serializeCapture(capture), resumeFor(state, index), await workStore.get('fit-preferences'), state.settings);
  }
  matches(job, capture) {
    if (!this.runtime || !capture || this.preferenceDraft || this.owner.drafts.has(capture.id)) return false;
    const s = this.runtime.getState(), r = resumeFor(s, s.selected), i = job.inputs;
    return job.state === 'succeeded' && i.capture_id === capture.id && i.review_hash === capture.review_basis_hash &&
      i.resume.id === r.id && i.resume.text === r.text && i.resume.label === r.label && i.model === s.settings.model &&
      i.baseUrl === s.settings.baseUrl && i.prompt_version === PROMPT_VERSION && JSON.stringify(i.preferences) === JSON.stringify(this.preferences);
  }
  async prepare(unassessed = false) {
    const c = this.owner.current;
    if (this.owner.drafts.has(c.id)) throw new Error('Save corrections and review before preparing a request.');
    const job = !unassessed && this.jobs.find(j => this.matches(j, c));
    const prepared = job ? await serializeAssessedCapture(c, await this.inputs(), job) : await serializeCapture(c);
    this.owner.transport.set(c.id, prepared); return prepared;
  }
  async deleteCapture(id) {
    for (const job of await this.queue.jobs()) if (job.inputs.capture_id === id) await workStore.remove('fit-job:' + job.id);
    await workStore.remove('capture-delivery:' + id); await this.reload();
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
      if (!(await this.queue.jobs()).some(j => this.matches(j, capture))) {
        const job = await this.queue.enqueue(inputs); await this.queue.run([job.id]);
      }
      await this.reload();
      if (!this.jobs.some(j => this.matches(j, capture))) throw new Error('Assessment did not complete for the current inputs. The capture is still local. Review the assessment error, retry explicitly, or choose Save without assessment.');
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
      const state = await load();
      if (record.guard.inputs.resume.id !== `resume-slot-${state.selected + 1}`) return false;
      return (await this.resolve(record.guard.inputs)).binding_hash === record.guard.inputs.binding_hash;
    }
    return true;
  }
  render(capture, busy) {
    if (!capture || !this.runtime) return '';
    const s = this.runtime.getState(), disabled = busy ? 'disabled' : '', current = this.jobs.find(j => this.matches(j, capture));
    const jobs = this.jobs.filter(j => j.inputs.capture_id === capture.id);
    const c = this.connection;
    return `<section class="card capture-fit"><h2>Fit against your resume</h2>
      <p class="hint">On your click, your configured AI provider receives this reviewed posting, the complete selected resume text and any explicit preferences below. Model inference runs at that provider. Results stay in this browser until you save to Job Hunt.</p>
      <label class="label" for="fit-resume">RESUME YOU INTEND TO APPLY WITH</label><select id="fit-resume" ${disabled}>${s.resumes.map((r, i) => `<option value="${i}" ${s.selected === i ? 'selected' : ''}>${esc(r?.name || `Version ${i + 1} (empty)`)}</option>`).join('')}</select>
      <form id="fit-preferences-form"><label class="label" for="fit-preferences">OPTIONAL EXPLICIT PREFERENCES</label><textarea id="fit-preferences" maxlength="12000" rows="3" ${disabled}>${esc(this.preferenceDraft ? this.preferenceDraftText : this.preferences?.notes || '')}</textarea><p class="hint">For example: location, work model or salary with currency and period. Profile fields are not used as preferences. Blank means UNKNOWN.</p><button class="text-button" ${disabled}>Save preferences locally</button></form>
      <div class="button-row"><button id="fit-assess" class="button primary" ${disabled}>Assess selected resume</button><button id="fit-compare" class="button secondary" ${disabled}>Compare saved resumes</button></div>
      <p class="hint">One AI request at a time. Comparisons are local; only the intended resume's matching result can be attached. Reopen and explicitly resume interrupted work; processing requires an open panel.</p>
      ${jobs[0]?.error ? `<p class="fit-error notice error" role="note">${esc(jobs[0].inputs.resume.label)}: ${esc(jobs[0].error)}</p>` : ''}
      ${current ? `<article class="fit-result"><h3>${esc(current.result.fit)} experience fit</h3><p>${esc(current.result.explanation)}</p><h4>Strengths</h4><ul>${current.result.strengths.map(x => `<li>${esc(x)}</li>`).join('')}</ul><h4>Gaps</h4><ul>${current.result.gaps.map(x => `<li>${esc(x)}</li>`).join('')}</ul><p>Preferences: ${esc(current.result.preference_alignment)} ${esc(current.result.preference_notes)}</p><p class="hint">${esc(current.inputs.resume.label)} · ${esc(current.inputs.model)} · ${esc(current.analyzed_at)}</p></article>` : '<p class="hint">Unassessed for the current inputs. Changed inputs require a fresh matching result.</p>'}
      ${jobs.length ? `<details><summary>Assessment history (${jobs.length})</summary>${jobs.map(j => `<p data-fit-job="${esc(j.id)}"><strong>${esc(j.inputs.resume.label)}: ${esc(j.state)}</strong>${j.result ? ` · ${esc(j.result.fit)}` : ''}<br>${esc(j.error || j.analyzed_at || j.created_at)}</p>`).join('')}</details>` : ''}
      ${this.jobs.some(j => ['queued', 'interrupted'].includes(j.state)) ? `<button id="fit-resume-jobs" class="text-button" ${disabled}>Resume pending assessments</button>` : ''}
      <button id="fit-unassessed" class="text-button" ${disabled}>Prepare as Unassessed</button>
      <p class="hint">A failed new attempt preserves the last successful result when its inputs still match. Preparing or retrying delivery never calls AI.</p></section>
      <section class="card capture-deliveries"><h2>Save to Job Hunt</h2><p class="hint">Connect your Job Hunt account using a separate credential from <a href="${JOB_HUNT_ORIGIN}" target="_blank" rel="noreferrer">My preferences → Job Hunt extension</a>. Paste that credential here, never your AI gateway key. Your posting, original evidence and chosen fit are saved together; Job Hunt does not run AI again.</p>
      ${c ? `<p>${esc(c.account.email)} · ${esc(c.origin)} · ${c.verified && Date.now() < c.expires_at ? 'Connected' : 'Reconnect required'}<br>Credential expires: ${esc(new Date(c.expires_at).toLocaleString())}</p>` : ''}
      <form id="tracker-connect-form"><label class="label" for="tracker-origin">JOB HUNT SERVER</label><input id="tracker-origin" type="url" value="${esc(c?.origin || JOB_HUNT_ORIGIN)}" required ${disabled}><label class="label" for="tracker-credential">JOB HUNT CREDENTIAL</label><input id="tracker-credential" type="password" autocomplete="off" required ${disabled}><button class="button secondary full" ${disabled}>Connect Job Hunt</button></form>
      ${c ? `<button id="tracker-disconnect" class="text-button" ${disabled}>Disconnect tracker</button><button id="tracker-save" class="button primary full" ${disabled}>${this.deliveries.some(r=>r.id===capture.id) ? 'Continue saved delivery' : current ? 'Save posting + fit to Job Hunt' : 'Assess & save to Job Hunt'}</button><button id="tracker-save-unassessed" class="text-button" ${disabled}>Save without assessment</button><p class="hint">Saving with fit sends the selected resume to your AI provider only if a current result is needed. Saving without assessment makes no AI request and may create a draft or a role needing review. A capture saved without fit cannot have a fit added later through this API.</p><details><summary>Advanced delivery</summary><button id="tracker-freeze" class="button secondary full" ${disabled}>Freeze prepared request</button></details>` : ''}
      ${this.deliveries.map(r => `<article><h3>${r.state === 'delivered' ? 'Saved to Job Hunt' : 'Delivery: ' + esc(r.state)}</h3><p>${esc(r.origin)} · account ${esc(r.account_id)}<br>Capture ${esc(r.id)}</p><p>${esc(r.error || '')}</p>${r.validation ? `<pre>${esc(JSON.stringify(r.validation, null, 2))}</pre>` : ''}${r.receipt ? `<p>${r.receipt.record_deleted ? 'The capture was received, but its linked role was deleted. No role was recreated.' : r.receipt.disposition === 'draft' ? 'Capture saved as a draft. Complete the job identity to create a role.' : r.receipt.extension_assessment?.disposition === 'applied' ? 'Posting and extension fit saved to the new Not started role.' : r.receipt.extension_assessment?.disposition === 'stored_only' ? 'Fit stored in capture history. The existing role and its rating were preserved.' : 'Capture saved without a fit. Review warnings remain recorded.'}</p><a href="${esc(r.origin)}" target="_blank" rel="noreferrer">Open Job Hunt</a>` : `<button data-delivery-send="${esc(r.id)}" class="text-button" ${disabled}>Retry / check delivery</button>`}<details><summary>Frozen request and receipt</summary><pre>${esc(r.body)}</pre><pre>${esc(JSON.stringify(r.receipt, null, 2))}</pre></details></article>`).join('')}</section>`;
  }
  bind(app, task, refresh) {
    const on = (selector, event, fn) => app.querySelector(selector)?.addEventListener(event, fn);
    const perform = (name, fn) => task(name, async () => { try { await fn(); } finally { await this.reload(); } });
    on('#fit-resume', 'change', e => perform('save', () => this.runtime.setSelected(Number(e.target.value))));
    // Unsaved preference edits immediately hide the current result and prepared body.
    on('#fit-preferences', 'input', e => { this.owner.transport.clear(); app.querySelector('.capture-transport')?.remove(); app.querySelector('.fit-result')?.remove(); this.preferenceDraft = true; this.preferenceDraftText = e.target.value; });
    on('#fit-preferences-form', 'submit', e => { e.preventDefault(); const notes = app.querySelector('#fit-preferences').value; perform('save', async () => { await workStore.set('fit-preferences', notes.trim() ? { notes } : null); this.preferenceDraft = false; this.owner.transport.clear(); }); });
    const assess = compare => perform('fit', async () => {
      if (this.preferenceDraft) throw new Error('Save preference edits first.');
      const s = this.runtime.getState(), indexes = compare ? s.resumes.flatMap((r, i) => r?.text ? [i] : []) : [s.selected];
      if (!indexes.length) throw new Error('Add a resume first.');
      // Validate every comparison before queuing any provider request.
      const inputs = await Promise.all(indexes.map(i => this.inputs(i)));
      for (const input of inputs) await this.queue.enqueue(input);
      this.owner.transport.clear(); await this.queue.run();
    });
    on('#fit-assess', 'click', () => assess(false)); on('#fit-compare', 'click', () => assess(true));
    on('#fit-resume-jobs', 'click', () => perform('fit', () => this.queue.run()));
    on('#fit-unassessed', 'click', () => perform('serialize', () => this.prepare(true)));
    on('#tracker-connect-form', 'submit', e => { e.preventDefault(); const origin = app.querySelector('#tracker-origin').value, token = app.querySelector('#tracker-credential').value; perform('connect', () => this.delivery.connect(origin, token)); });
    on('#tracker-disconnect', 'click', () => perform('connect', () => this.delivery.disconnect()));
    on('#tracker-save', 'click', () => perform('deliver', () => this.saveToJobHunt(false)));
    on('#tracker-save-unassessed', 'click', () => perform('deliver', () => this.saveToJobHunt(true)));
    on('#tracker-freeze', 'click', () => perform('serialize', async () => {
      if (this.preferenceDraft) throw new Error('Save preference edits first.');
      const prepared = this.owner.transport.get(this.owner.current.id);
      if (!prepared) throw new Error('Prepare and inspect a current offline request first.');
      await this.freezeCurrent(prepared);
    }));
    app.querySelectorAll('[data-delivery-send]').forEach(button => button.addEventListener('click', () => perform('deliver', async () => { if (this.preferenceDraft) throw new Error('Save preference edits first.'); await this.delivery.send(button.dataset.deliverySend); })));
  }
}
