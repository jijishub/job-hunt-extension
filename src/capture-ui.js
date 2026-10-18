import { capturePosting } from './browser.js';
import { captureFields, captureWarnings, createCapture, correctCapture, selectCandidate, resolutionActions } from './captures.js';
import { serializeCapture } from './capture-transport.js';
import { composeRequirements, sourceVariants, normalizeSalaryPeriod, INFORMATIONAL_WARNINGS } from './capture-rules.js';
import { loadCaptures, saveCapture, deleteCapture } from './capture-storage.js';
import { CaptureFitPanel } from './capture-fit-ui.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export class CapturePanel {
  captures = [];
  selected = null;
  drafts = new Map();
  transport = new Map();
  readiness = new Map();
  lastCaptureFailure = null;
  diagnosticsCopied = false;
  fit = new CaptureFitPanel(this);
  configure(runtime) { this.fit.runtime = runtime; }
  async load() { this.captures = await loadCaptures(); this.selected = this.captures[0]?.id || null; await this.fit.load(); await this.checkReadiness(); }
  async checkReadiness() {
    const c = this.current;
    if (!c) return;
    try { const request = await serializeCapture(c); this.readiness.set(c.id, request.assessment); }
    catch (e) { this.readiness.set(c.id, { eligible: false, reasons: [e.code || 'invalid_capture'], message: e.message }); }
  }
  get current() { return this.captures.find(c => c.id === this.selected); }
  reset() { this.captures = []; this.selected = null; this.drafts.clear(); this.transport.clear(); this.readiness.clear(); this.lastCaptureFailure = null; this.diagnosticsCopied = false; this.fit.jobs = []; this.fit.deliveries = []; this.fit.preferences = null; this.fit.connection = null; this.fit.preferenceDraft = false; }
  render(busy) {
    const capture = this.current, candidate = capture?.snapshot.candidates[capture.candidate_index];
    const draft = this.drafts.get(capture?.id), posting = draft?.values || capture?.posting;
    const disabled = busy ? 'disabled' : '';
    const warnings = capture ? captureWarnings(capture) : [];
    const resolutions = draft?.resolutions || capture?.resolutions || [];
    const statusFor = w => INFORMATIONAL_WARNINGS.has(w.code) ? 'Information · Unknown is allowed'
      : w.code === 'missing_role_title' && posting?.role_title?.trim() || w.code === 'missing_company_name' && posting?.company_name?.trim() ? 'Resolved by current correction'
        : resolutions.some(r => r.warning_id === w.id && r.action && r.note?.trim()) ? draft ? 'Resolution pending save' : 'Resolved · Original warning preserved' : 'Needs review';
    const warningList = list => list.map(w => `<li data-warning-id="${esc(w.id)}" data-warning-state="${INFORMATIONAL_WARNINGS.has(w.code) ? 'informational' : statusFor(w).startsWith('Resolved') ? 'resolved' : 'unresolved'}"><strong>${esc(w.code)}</strong>: ${esc(w.message)}<br><span class="warning-status">${esc(statusFor(w))}</span></li>`).join('');
    const readiness = this.readiness.get(capture?.id);
    const blockerActions = {
      pilot_review_required: 'Compare the posting and preserved sources, then confirm requirements and save review below.',
      requirements_unverified: 'Confirm completeness using the requirements review action below.',
      conflicting_sources: 'Compare both sources. Choose the complete description, save a correction, or explain why a specific difference is irrelevant.',
      structured_only: 'Compare the captured requirements with the visible posting, then confirm completeness below.',
      collapsed_content: 'Expand the description on the page and capture again, or document a verified resolution after checking the complete original.',
      missing_role_title: 'Enter the role title and save corrections.', missing_company_name: 'Enter the company name and save corrections.',
      missing_requirements: 'Supply the full requirements from the posting and save a correction. Confirmation alone is insufficient.',
      oversized_requirements: 'The current requirements exceed the agreed assessment limit. Keep the full local capture or supply a suitable corrected posting.',
      frames_not_read: 'Check whether the embedded frame contains requirements. Record an explained resolution under review warnings.',
      unverified_layout: 'Compare the intended job title, employer, location and all posting sections with the page, then confirm the layout and requirements below.',
    };
    const reviewCodes = new Set(['pilot_review_required', 'requirements_unverified', 'structured_only', 'unverified_layout']);
    const nextActions = [...new Set((readiness?.reasons || []).map(code => reviewCodes.has(code) ? 'Compare with the job page, then confirm review below.' : code === 'collapsed_content' ? 'Expand the original description and check that all text is included.' : blockerActions[code] || readiness?.message || 'Resolve the review note below.'))];
    const readinessHTML = `<div class="capture-assessment-status ${readiness?.eligible && !draft ? 'is-ready' : ''}" role="status">${draft ? '<p>Changes not saved. Confirm review below.</p>' : readiness?.eligible ? '<p>✓ Reviewed. Choose your resume and save in step 3.</p>' : nextActions.length ? `<ul>${nextActions.map(action=>`<li>${esc(action)}</li>`).join('')}</ul>` : '<p>Compare this with the job page before saving.</p>'}</div>`;
    const warningNames = { conflicting_sources:'Sources differ', collapsed_content:'Description may be clipped', missing_requirements:'Missing requirements', oversized_requirements:'Description is too long', invalid_salary_range:'Check the salary range', frames_not_read:'Check embedded content', source_truncated:'Source text was shortened' };
    const labels = { use_rendered: 'Use text from the page', use_structured: 'Use structured source text', corrected: 'I corrected this', verified_irrelevant: 'I checked this; nothing is missing or incorrect' };
    const controls = capture ? warnings.map((warning, i) => {
      const actions = resolutionActions(capture, warning);
      if (!actions.length) return '';
      const resolution = resolutions.find(r => r.warning_id === warning.id);
      return { warning, html: `<div class="capture-resolution" data-warning-code="${esc(warning.code)}"><label class="label" for="resolution-action-${i}">${esc(warningNames[warning.code] || 'Review decision')}</label><p class="hint">${esc(warning.message)}</p>
        <select id="resolution-action-${i}" data-resolution-action="${esc(warning.id)}" ${disabled}><option value="">Unresolved</option>${actions.map(action => `<option value="${action}" ${resolution?.action === action ? 'selected' : ''}>${labels[action]}</option>`).join('')}</select>
        <label class="label" for="resolution-note-${i}">What did you check or correct?</label><textarea id="resolution-note-${i}" data-resolution-note="${esc(warning.id)}" rows="2" maxlength="2000" ${disabled}>${esc(resolution?.note || '')}</textarea></div>` };
    }).filter(Boolean) : [];
    const needsDecision = w => !reviewCodes.has(w.code) && w.code !== 'collapsed_content' && !(w.code === 'conflicting_sources' && w.field === 'description') && !statusFor(w).startsWith('Resolved');
    const resolutionControls = controls.filter(c=>needsDecision(c.warning)).map(c=>c.html).join('');
    const advancedControls = controls.filter(c=>!needsDecision(c.warning)).map(c=>c.html).join('');
    const clipping = warnings.filter(w=>w.code === 'collapsed_content');
    const clippingResolved = clipping.length && clipping.every(w=>resolutions.some(r=>r.warning_id===w.id && r.action && r.note?.trim()));
    const transport = this.transport.get(capture?.id);
    const field = ([key, label]) => {
      const value = key === 'description' ? composeRequirements(posting) : posting[key];
      const options = key === 'work_model' ? ['ON_SITE', 'HYBRID', 'REMOTE'] : key === 'job_type' ? ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERNSHIP'] : null;
      const optionLabels = {ON_SITE:'On-site',HYBRID:'Hybrid',REMOTE:'Remote',FULL_TIME:'Full-time',PART_TIME:'Part-time',CONTRACT:'Contract',INTERNSHIP:'Internship'};
      return `<label class="label" for="capture-${key}">${label}</label>${options
        ? `<select id="capture-${key}" name="${key}" ${disabled}><option value="">Unknown</option>${options.map(o => `<option value="${o}" ${value === o ? 'selected' : ''}>${optionLabels[o]}</option>`).join('')}</select>`
        : ['role_title', 'description', 'qualifications'].includes(key)
          ? `<textarea id="capture-${key}" name="${key}" rows="${key === 'role_title' ? 2 : 8}" maxlength="120000" ${disabled}>${esc(value)}</textarea>`
          : `<input id="capture-${key}" name="${key}" value="${esc(value)}" ${['salary_min', 'salary_max'].includes(key) ? 'type="number" min="0" step="any"' : ''} ${disabled}>`}
        `;
    };
    return `<section class="card"><div class="section-head"><span class="step">1</span><h2>Capture</h2></div>
      <button id="capture-posting" class="button ${capture ? 'secondary' : 'primary'} full" ${disabled}>${busy === 'capture' ? 'Capturing…' : capture ? 'Capture this page again' : 'Capture current job'}</button>
      ${this.lastCaptureFailure ? `<div class="capture-diagnostics"><p class="hint">No capture was saved for this attempt. Diagnostics contain job ID, recognition flags and character counts. They exclude description text, resumes, profile and credentials.</p><div class="button-row"><button id="capture-diagnostics-copy" class="text-button" ${disabled}>${this.diagnosticsCopied ? 'Diagnostics copied' : 'Copy capture diagnostics'}</button><button id="capture-diagnostics-export" class="text-button" ${disabled}>Download diagnostics</button></div><details><summary>Recognition diagnostics</summary><pre>${esc(JSON.stringify(this.lastCaptureFailure, null, 2))}</pre></details></div>` : ''}
      <p class="hint">Open a job posting first. Nothing is uploaded yet.</p>
      ${this.captures.length ? `<details><summary>Saved captures (${this.captures.length})</summary><select id="capture-history" aria-label="Saved captures" ${disabled}>${this.captures.map(c => `<option value="${esc(c.id)}" ${c.id === this.selected ? 'selected' : ''}>${esc(c.posting?.role_title || 'Choose posting')} · ${esc(c.posting?.company_name || new URL(c.snapshot.page_url).hostname)}</option>`).join('')}</select></details>` : ''}</section>
      ${capture ? `<section class="card capture-preview"><div class="section-head"><span class="step">2</span><h2>Review posting</h2></div>
      <p class="capture-status">${draft ? 'Unsaved changes' : capture.reviewed_at && capture.review_basis_hash ? 'Reviewed' : 'Check the details below'}</p>
      ${readinessHTML}
      ${capture.snapshot.candidates.length > 1 ? `<label class="label" for="capture-candidate">WHICH POSTING?</label><select id="capture-candidate" ${disabled}><option value="">Choose a posting</option>${capture.snapshot.candidates.map((c, i) => `<option value="${i}" ${capture.candidate_index === i ? 'selected' : ''}>${esc(c.posting.role_title || 'Untitled')} · ${esc(c.posting.company_name || 'Unknown company')} (${esc(c.adapter)})</option>`).join('')}</select>` : ''}
      ${posting ? `<form id="capture-form">${captureFields.filter(([key]) => ['role_title','company_name','description'].includes(key)).map(field).join('')}
      <div class="capture-facts">${[posting.location,({REMOTE:'Remote',HYBRID:'Hybrid',ON_SITE:'On-site'})[posting.work_model],({FULL_TIME:'Full-time',PART_TIME:'Part-time',CONTRACT:'Contract',INTERNSHIP:'Internship'})[posting.job_type]].filter(Boolean).map(value=>`<span>${esc(value)}</span>`).join('')}</div>
      <details><summary>Edit location, work type & salary</summary>${captureFields.filter(([key]) => !['role_title','company_name','description','qualifications'].includes(key)).map(field).join('')}<p class="hint">Unknown is allowed. Salary period: ${esc(normalizeSalaryPeriod(posting.salary_period) || 'Unknown')}.</p></details>
      ${resolutionControls ? `<div class="capture-resolutions"><h3>Check these differences</h3>${resolutionControls}</div>` : ''}
      ${readiness?.eligible && !draft ? '<details class="capture-review-again"><summary>Review again</summary>' : ''}<div class="capture-completeness">${clipping.length ? `<p class="hint">The page may hide part of the description.</p><label class="check"><input id="capture-clipping-confirmed" type="checkbox" ${clippingResolved && !draft ? 'checked' : ''} ${disabled}> I expanded the original posting and verified that all its text is included here.</label>` : ''}<label class="check"><input id="capture-completeness-confirmed" type="checkbox" ${disabled}> I checked the title, company and full description against the job page.</label><button id="capture-confirm-completeness" type="button" class="button ${readiness?.eligible && !draft ? 'secondary' : 'primary'} full" disabled>Confirm review</button></div>${readiness?.eligible && !draft ? '</details>' : ''}
      <details><summary>Advanced review options</summary>${advancedControls}<label class="check"><input id="capture-reviewed" type="checkbox" ${draft ? draft.reviewed ? 'checked' : '' : capture.reviewed_at && capture.review_basis_hash ? 'checked' : ''} ${disabled}> Mark these changes reviewed</label><button class="button secondary full" ${disabled}>Save corrections locally</button></details></form>` : ''}
      <details><summary>Sources & review history</summary><p class="hint">${esc(capture.snapshot.captured_at)} · ${esc(capture.snapshot.extractor_version)}<br>${esc(capture.snapshot.page_url)}</p><div class="capture-warnings" role="note"><ul>${warningList(warnings.filter(w => !INFORMATIONAL_WARNINGS.has(w.code)))}</ul><details class="capture-information"><summary>Unknown details · do not block saving</summary><ul>${warningList(warnings.filter(w => INFORMATIONAL_WARNINGS.has(w.code)))}</ul></details></div>
      ${capture.snapshot.candidates.map((c, i) => `<article class="capture-source"><h3>Source ${i + 1}: ${esc(c.adapter)}</h3><p class="hint">Requisition: ${esc(c.source.requisition_id || 'Unknown')} · Salary period: ${esc(c.source.salary_period || 'Unknown')}</p><h4>Rendered posting text</h4><pre>${esc(c.source.rendered_text || '(None captured)')}</pre><h4>Structured posting text</h4><pre>${esc(c.source.structured_text || '(None captured)')}</pre><details><summary>Selected structured facts and field provenance</summary><pre>${esc(JSON.stringify({ structured_data: c.source.structured_data, structured_url: c.source.structured_url, provenance: c.provenance }, null, 2))}</pre></details></article>`).join('')}</details>
      </section>` : ''}
      ${this.fit.render(capture, busy)}
      ${capture ? `<details class="card capture-advanced"><summary>Export & advanced tools</summary><div class="button-row"><button id="capture-export" class="text-button" ${disabled}>Export local capture</button><button id="capture-delete" class="text-button danger" ${disabled}>Delete capture</button></div><p class="hint">Offline requests do not upload or call AI.</p><button id="capture-prepare" class="button secondary full" ${disabled}>Prepare offline request</button>
      ${transport ? `<div class="capture-transport"><p>${transport.bytes} / ${transport.max_bytes} UTF-8 bytes</p><p>${transport.assessment.eligible ? 'Local review checks passed; server validation is still required.' : `Assessment blocked: ${esc(transport.assessment.reasons.join(', '))}`}</p><details><summary>Proposed request JSON</summary><pre>${esc(transport.json)}</pre></details><button id="capture-transport-export" class="text-button">Download offline request JSON</button></div>` : ''}</details>` : ''}`;
  }
  bind(app, task, refresh) {
    this.fit.bind(app, task, refresh);
    const on = (selector, event, fn) => app.querySelector(selector)?.addEventListener(event, fn);
    on('#capture-posting', 'click', () => task('capture', async () => {
      this.lastCaptureFailure = null; this.diagnosticsCopied = false;
      const snapshot = await capturePosting();
      if (!snapshot.candidates.length) {
        this.lastCaptureFailure = snapshot.diagnostics || null;
        throw new Error(snapshot.warnings.map(w => typeof w === 'string' ? w : w.message).join(' '));
      }
      const capture = createCapture(snapshot);
      await saveCapture(capture);
      this.captures.unshift(capture); this.selected = capture.id;
    }));
    on('#capture-history', 'change', e => task('review', async () => { this.selected = e.target.value; await this.checkReadiness(); }));
    on('#capture-candidate', 'change', e => {
      if (e.target.value === '') return;
      const index = Number(e.target.value), current = this.current;
      if (index === current.candidate_index) return;
      const capture = selectCandidate(current, index);
      task('save', async () => {
        await saveCapture(capture);
        if (capture.id === current.id) { this.captures[this.captures.indexOf(current)] = capture; this.drafts.delete(current.id); }
        else this.captures.unshift(capture);
        this.selected = capture.id;
      });
    });
    const form = app.querySelector('#capture-form');
    const readResolutions = () => [...form.querySelectorAll('[data-resolution-action]')].filter(el => el.value).map(el => ({
      warning_id: el.dataset.resolutionAction, action: el.value,
      note: [...form.querySelectorAll('[data-resolution-note]')].find(n => n.dataset.resolutionNote === el.dataset.resolutionAction).value
    }));
    const keepDraft = () => {
      this.drafts.set(this.current.id, { values: Object.fromEntries(new FormData(form)), reviewed: form.querySelector('#capture-reviewed').checked, resolutions: readResolutions() });
      this.transport.delete(this.current.id);
      app.querySelector('.capture-transport')?.remove();
      app.querySelector('.fit-result')?.remove();
      app.querySelectorAll('[data-warning-state="resolved"]').forEach(node => { node.dataset.warningState = 'unresolved'; node.querySelector('.warning-status').textContent = 'Needs current saved review'; });
      const status = app.querySelector('.capture-assessment-status');
      if (status) { status.innerHTML = '<p>Changes not saved. Confirm review below.</p>'; status.classList.remove('is-ready'); }
      const saveButton = app.querySelector('#tracker-save');
      if (saveButton) { saveButton.disabled = true; saveButton.textContent = 'Confirm review above'; }
      app.querySelector('.capture-status').textContent = 'Unsaved changes';
    };
    const invalidate = (resolutions) => {
      form.querySelector('.capture-review-again')?.setAttribute('open','');
      form.querySelector('#capture-reviewed').checked = false;
      form.querySelector('#capture-completeness-confirmed').checked = false;
      form.querySelector('#capture-confirm-completeness').disabled = true;
      if (resolutions) {
        const clippingCheck = form.querySelector('#capture-clipping-confirmed');
        if (clippingCheck) clippingCheck.checked = false;
        form.querySelectorAll('[data-resolution-action]').forEach(el => { el.value = ''; });
        form.querySelectorAll('[data-resolution-note]').forEach(el => { el.value = ''; });
      }
    };
    form?.addEventListener('input', e => {
      if (e.target.matches('[data-resolution-action]')) return;
      if (!['capture-reviewed', 'capture-completeness-confirmed', 'capture-clipping-confirmed'].includes(e.target.id)) invalidate(!!e.target.name);
      keepDraft();
    });
    form?.querySelectorAll('[data-resolution-action]').forEach(el => el.addEventListener('change', () => {
      const action = el.value;
      if (action.startsWith('use_')) {
        const variant = sourceVariants(this.current.snapshot.candidates[this.current.candidate_index]).find(v => action === `use_${v.id}`);
        if (variant) form.elements.description.value = variant.text;
        invalidate(true); el.value = action;
      } else invalidate(false);
      keepDraft();
    }));
    const canConfirm = () => app.querySelector('#capture-completeness-confirmed')?.checked && (!app.querySelector('#capture-clipping-confirmed') || app.querySelector('#capture-clipping-confirmed').checked);
    const updateConfirm = () => { app.querySelector('#capture-confirm-completeness').disabled = !canConfirm(); };
    on('#capture-completeness-confirmed', 'change', updateConfirm);
    on('#capture-clipping-confirmed', 'change', updateConfirm);
    on('#capture-confirm-completeness', 'click', () => {
      if (!canConfirm()) return;
      const current = this.current, values = Object.fromEntries(new FormData(form)), decisions = readResolutions();
      const note = 'Compared the intended job title, employer and location, all available posting sections and qualifications with the original page and preserved source versions. Confirmed the current layout captures the intended job and its requirements are complete.';
      for (const w of captureWarnings(current)) {
        let action;
        if (['requirements_unverified', 'structured_only', 'unverified_layout'].includes(w.code)) action = 'verified_irrelevant';
        if (w.code === 'collapsed_content' && app.querySelector('#capture-clipping-confirmed')?.checked) action = 'verified_irrelevant';
        if (w.code === 'conflicting_sources' && w.field === 'description') {
          const variant = sourceVariants(current.snapshot.candidates[current.candidate_index]).find(v => v.text === values.description);
          action = variant ? `use_${variant.id}` : 'corrected';
        }
        if (action) { const index = decisions.findIndex(r => r.warning_id === w.id); if (index >= 0) decisions.splice(index, 1); decisions.push({ warning_id: w.id, action, note: w.code === 'collapsed_content' ? 'Expanded the original posting and compared all of its text with the current description. Verified that the clipping warning does not indicate omitted text. ' + note : note }); }
      }
      task('review', async () => {
        const corrected = await correctCapture(current, values, true, decisions);
        await saveCapture(corrected); this.transport.delete(current.id);
        this.captures[this.captures.indexOf(current)] = corrected; this.drafts.delete(current.id);
        await this.checkReadiness();
      });
    });
    on('#capture-prepare', 'click', () => task('serialize', async () => {
      if (this.drafts.has(this.current.id)) throw new Error('Save corrections and resolutions before preparing offline request JSON.');
      if (this.fit.preferenceDraft) throw new Error('Save preference edits first.');
      await this.fit.prepare();
    }));
    const download = (value, filename) => {
      const url = URL.createObjectURL(new Blob([value], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    on('#capture-diagnostics-copy', 'click', () => task('copy', async () => { await navigator.clipboard.writeText(JSON.stringify(this.lastCaptureFailure, null, 2)); this.diagnosticsCopied = true; }));
    on('#capture-diagnostics-export', 'click', () => download(JSON.stringify(this.lastCaptureFailure, null, 2), 'job-hunt-capture-diagnostics.json'));
    on('#capture-transport-export', 'click', () => {
      const prepared = this.transport.get(this.current.id);
      if (prepared) download(prepared.json, `job-hunt-offline-request-${this.current.id}.json`);
    });
    form?.addEventListener('submit', e => {
      e.preventDefault();
      const values = Object.fromEntries(new FormData(form)), reviewed = form.querySelector('#capture-reviewed').checked, resolutions = readResolutions(), current = this.current;
      task('save', async () => {
        const corrected = await correctCapture(current, values, reviewed, resolutions);
        await saveCapture(corrected);
        this.transport.delete(current.id);
        this.captures[this.captures.indexOf(current)] = corrected; this.drafts.delete(current.id);
      });
    });
    on('#capture-export', 'click', () => {
      if (this.drafts.has(this.current.id)) { alert('Save your corrections before exporting.'); return; }
      download(JSON.stringify(this.current, null, 2), `job-hunt-capture-${this.current.id}.json`);
    });
    on('#capture-delete', 'click', () => {
      const current = this.current;
      if (!confirm('Delete this local capture, its corrections and preserved source?')) return;
      task('save', async () => { await deleteCapture(current.id); await this.fit.deleteCapture(current.id); this.transport.delete(current.id); this.drafts.delete(current.id); this.captures = this.captures.filter(c => c.id !== current.id); this.selected = this.captures[0]?.id || null; });
    });
  }
}
