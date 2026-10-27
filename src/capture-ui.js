import { capturePosting } from './browser.js';
import { captureFields, captureWarnings, createCapture, correctCapture, selectCandidate, resolutionActions } from './captures.js';
import { serializeCapture } from './capture-transport.js';
import { composeRequirements, sourceVariants, normalizeSalaryPeriod, INFORMATIONAL_WARNINGS } from './capture-rules.js';
import { loadCaptures, saveCapture, startCapture, clearCaptures, activeCaptureId, withCaptureWorkIdle, captureWorkspace, updateCaptureWorkspace } from './capture-storage.js';
import { CaptureFitPanel, clearCaptureRecords } from './capture-fit-ui.js';
import { load as loadSettings } from './storage.js';
import { salarySnippets, suggestSalary } from './salary-extractor.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export class CapturePanel {
  captures = [];
  selected = null;
  tabId = 'preview';
  tabUrl = null;
  resumeIndex = null;
  tabDiagnostics = new Map();
  drafts = new Map();
  transport = new Map();
  readiness = new Map();
  lastCaptureFailure = null;
  diagnosticsCopied = false;
  fit = new CaptureFitPanel(this);
  configure(runtime) { this.fit.runtime = runtime; }
  async load(context = {}) { await this.switchTab(context); await this.fit.load(); }
  async switchTab({id = 'preview',url = null} = {}) {
    this.tabDiagnostics.set(this.tabId,{failure:this.lastCaptureFailure,copied:this.diagnosticsCopied});
    this.tabId=id; this.tabUrl=url;
    this.captures=await loadCaptures();
    this.selected=await activeCaptureId(this.captures,id,url);
    this.resumeIndex=(await captureWorkspace(id))?.resume_index ?? null;
    const diagnostics=this.tabDiagnostics.get(id);
    this.lastCaptureFailure=diagnostics?.failure || null;this.diagnosticsCopied=diagnostics?.copied || false;
    await this.checkReadiness();
  }
  async selectResume(index) { await updateCaptureWorkspace(this.tabId,{resume_index:index});this.resumeIndex=index;this.transport.clear(); }
  async checkReadiness() {
    const c = this.current;
    if (!c) return;
    try { const request = await serializeCapture(c); this.readiness.set(c.id, request.assessment); }
    catch (e) { this.readiness.set(c.id, { eligible: false, reasons: [e.code || 'invalid_capture'], message: e.message }); }
  }
  get current() { return this.captures.find(c => c.id === this.selected); }
  reset() { this.fit.setLiveActive(false); this.captures = []; this.selected = null; this.resumeIndex=null;this.tabDiagnostics.clear();this.drafts.clear(); this.transport.clear(); this.readiness.clear(); this.lastCaptureFailure = null; this.diagnosticsCopied = false; this.fit.jobs = []; this.fit.deliveries = []; this.fit.preferences = null; this.fit.localPreferences = null; this.fit.preferenceSource = null; this.fit.connection = null; this.fit.preferenceDraft = false; }
  render(busy) {
    const capture = this.current;
    const draft = this.drafts.get(capture?.id), posting = draft?.values || capture?.posting;
    const salaryMin = posting?.salary_min === '' ? null : posting?.salary_min;
    const salaryMax = posting?.salary_max === '' ? null : posting?.salary_max;
    const disabled = busy ? 'disabled' : '';
    const warnings = capture ? captureWarnings(capture) : [];
    const readiness = this.readiness.get(capture?.id);
    const canConfirm = Boolean((posting?.role_title || '').trim() && (posting?.company_name || '').trim());
    const readinessHTML = `<div class="capture-assessment-status ${readiness?.eligible && !draft ? 'is-ready' : ''}" role="status">${draft ? '<p>Changes not saved. Click Confirm changes below.</p>' : readiness?.eligible ? '<p>✓ Reviewed. Choose your resume and assess in step 3.</p>' : '<p>Check the details below, then click Confirm review.</p>'}</div>`;
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
      <p class="hint">This tab has its own posting and assessment. Nothing uploads until you save to Job Hunt.</p>
      <button id="capture-clear" class="button secondary full danger" ${disabled} ${this.captures.length || this.fit.jobs.length || this.fit.deliveries.length || this.lastCaptureFailure ? '' : 'disabled'}>Clear capture data</button>
      <p class="hint">Clears capture data in all tabs, including pending deliveries. Keeps resumes, settings and Job Hunt records.</p></section>
      ${capture ? `<section class="card capture-preview"><div class="section-head"><span class="step">2</span><h2>Review posting</h2></div>
      <p class="capture-status">${draft ? 'Unsaved changes' : capture.reviewed_at && capture.review_basis_hash ? 'Reviewed' : 'Check the details below'}</p>
      ${readinessHTML}
      ${capture.snapshot.candidates.length > 1 ? `<label class="label" for="capture-candidate">WHICH POSTING?</label><select id="capture-candidate" ${disabled}><option value="">Choose a posting</option>${capture.snapshot.candidates.map((c, i) => `<option value="${i}" ${capture.candidate_index === i ? 'selected' : ''}>${esc(c.posting.role_title || 'Untitled')} · ${esc(c.posting.company_name || 'Unknown company')} (${esc(c.adapter)})</option>`).join('')}</select>` : ''}
      ${posting ? `<form id="capture-form">
      <div class="capture-preview-summary">
        <h3 class="capture-summary-title">${esc(posting.role_title || '(Missing role title)')}</h3>
        <p class="capture-summary-company">${esc(posting.company_name || '(Missing company)')}</p>
        <div class="capture-facts">${[posting.location,({REMOTE:'Remote',HYBRID:'Hybrid',ON_SITE:'On-site'})[posting.work_model],({FULL_TIME:'Full-time',PART_TIME:'Part-time',CONTRACT:'Contract',INTERNSHIP:'Internship'})[posting.job_type]].filter(Boolean).map(value=>`<span>${esc(value)}</span>`).join('')}</div>
        <p class="hint">Salary: ${salaryMin == null && salaryMax == null ? 'Not listed / not extracted' : esc(`${posting.salary_currency || 'Currency unknown'} ${salaryMin == null ? 'Up to ' + salaryMax : salaryMax == null ? 'From ' + salaryMin : salaryMin === salaryMax ? salaryMin : salaryMin + ' – ' + salaryMax}${posting.salary_period ? ' / ' + posting.salary_period.toLowerCase() : ' (period unknown)'}`)}</p>
      </div>
      ${['LINKEDIN','JOBSTREET','INDEED'].includes(posting.job_platform) && salaryMin == null && salaryMax == null && salarySnippets(capture.snapshot.candidates[capture.candidate_index]) ? `<button id="capture-salary-ai" type="button" class="button secondary full" ${disabled}>Interpret salary with AI</button><p class="hint">Sends salary excerpts to your configured AI gateway. Review the suggestion before saving.</p>` : ''}
      <p id="capture-salary-suggestion" class="hint" role="status">${draft?.salaryQuote ? `AI suggestion from: “${esc(draft.salaryQuote)}”. Check the salary fields and confirm review.` : ''}</p>
      <details id="capture-edit-details" class="capture-manual-edit" ${draft || !posting.role_title?.trim() || !posting.company_name?.trim() ? 'open' : ''}><summary>Manual edit</summary>
        ${captureFields.filter(([key]) => ['role_title','company_name','description'].includes(key)).map(field).join('')}
        ${captureFields.filter(([key]) => !['role_title','company_name','description','qualifications'].includes(key)).map(field).join('')}
        <p class="hint">Unknown is allowed. Salary period: ${esc(normalizeSalaryPeriod(posting.salary_period) || 'Unknown')}.</p>
      </details>
      <div class="capture-completeness" ${readiness?.eligible && !draft?'hidden':''}>
        <button id="capture-confirm-completeness" type="button" class="button primary full" ${canConfirm && !disabled ? '' : 'disabled'}>${draft ? 'Confirm changes' : 'Confirm review'}</button>
      </div>
      </form>` : ''}
      <details class="capture-evidence"><summary>Sources & review history</summary><p class="hint">${capture.snapshot.candidates.length} source(s) · ${capture.reviewed_at && !draft ? 'Reviewed' : 'Needs review'}</p><a href="${esc(capture.snapshot.page_url)}" target="_blank" rel="noreferrer">Original posting ↗</a>
      <div class="capture-evidence-body">
      ${capture.snapshot.candidates[capture.candidate_index]?.source.salary_excerpt ? `<h4>Salary wording</h4><pre>${esc(capture.snapshot.candidates[capture.candidate_index].source.salary_excerpt)}</pre>` : ''}
      ${capture.snapshot.candidates.map((c, i) => `<article class="capture-source"><h3>Source ${i + 1} · ${esc(c.adapter)}</h3><h4>Page text</h4><pre>${esc(c.source.rendered_text || '(None captured)')}</pre><h4>Structured text</h4><pre>${esc(c.source.structured_text || '(None captured)')}</pre></article>`).join('')}</div><p class="hint">Export capture includes all original evidence and extraction details.</p></details>
      </section>` : ''}
      ${this.fit.render(capture, busy)}
      ${capture ? `<div class="button-row"><button id="capture-export" class="text-button" ${disabled}>Export capture</button></div>` : ''}`;
  }
  bind(app, task) {
    this.fit.bind(app, task);
    const on = (selector, event, fn) => app.querySelector(selector)?.addEventListener(event, fn);
    on('#capture-posting', 'click', () => task('capture', async () => {
      this.lastCaptureFailure = null; this.diagnosticsCopied = false;
      const snapshot = await capturePosting(typeof this.tabId === 'number' ? this.tabId : undefined);
      if (!snapshot.candidates.length) {
        this.lastCaptureFailure = snapshot.diagnostics || null;
        throw new Error(snapshot.warnings.map(w => typeof w === 'string' ? w : w.message).join(' '));
      }
      const capture = createCapture(snapshot);
      const previousId=this.selected;
      await startCapture(capture,this.tabId);
      this.captures = await loadCaptures(); this.selected = capture.id;
      this.drafts.delete(previousId); this.transport.delete(previousId); this.readiness.delete(previousId);
      await this.fit.reload();
    }));
    on('#capture-clear', 'click', () => task('save', async () => {
      await withCaptureWorkIdle(async () => { await clearCaptures(); await clearCaptureRecords(); });
      this.captures = []; this.selected = null;
      this.drafts.clear(); this.transport.clear(); this.readiness.clear();
      this.lastCaptureFailure = null; this.diagnosticsCopied = false;
      this.tabDiagnostics.clear();
      await this.fit.reload();
    }));
    on('#capture-candidate', 'change', e => {
      if (e.target.value === '') return;
      const index = Number(e.target.value), current = this.current;
      if (index === current.candidate_index) return;
      const capture = selectCandidate(current, index);
      task('save', async () => {
        if (capture.id === current.id) await saveCapture(capture);
        else await startCapture(capture,this.tabId);
        if (capture.id === current.id) { this.captures[this.captures.indexOf(current)] = capture; this.drafts.delete(current.id); }
        else this.captures = await loadCaptures();
        this.selected = capture.id;
      });
    });
    const form = app.querySelector('#capture-form');
    let inheritedResolutions = this.drafts.get(this.current?.id)?.resolutions || this.current?.resolutions || [];
    const readResolutions = () => {
      const controls = [...form.querySelectorAll('[data-resolution-action]')];
      const edited = new Set(controls.map(el=>el.dataset.resolutionAction));
      return [...inheritedResolutions.filter(r=>!edited.has(r.warning_id)), ...controls.filter(el=>el.value).map(el=>({
        warning_id: el.dataset.resolutionAction, action: el.value,
        note: [...form.querySelectorAll('[data-resolution-note]')].find(n=>n.dataset.resolutionNote===el.dataset.resolutionAction)?.value || ''
      }))];
    };
    const keepDraft = () => {
      const values = Object.fromEntries(new FormData(form));
      this.drafts.set(this.current.id, { values, reviewed: false, resolutions: readResolutions() });
      this.transport.delete(this.current.id);
      app.querySelector('.fit-result')?.remove();
      const status = app.querySelector('.capture-assessment-status');
      if (status) { status.innerHTML = '<p>Changes not saved. Click Confirm changes below.</p>'; status.classList.remove('is-ready'); }
      const saveButton = app.querySelector('#tracker-save');
      if (saveButton) { saveButton.disabled = true; saveButton.textContent = 'Confirm review above'; }
      const assessButton=app.querySelector('#fit-assess');
      if(assessButton)assessButton.disabled=true;
      const completeness=app.querySelector('.capture-completeness');
      if(completeness)completeness.hidden=false;
      const confirmButton=app.querySelector('#capture-confirm-completeness');
      if(confirmButton){
        confirmButton.disabled = !((values.role_title||'').trim() && (values.company_name||'').trim());
        confirmButton.textContent = 'Confirm changes';
      }
      const captureStatus = app.querySelector('.capture-status');
      if(captureStatus)captureStatus.textContent = 'Unsaved changes';
    };
    on('#capture-salary-ai', 'click', () => {
      const current = this.current, values = Object.fromEntries(new FormData(form)), resolutions = readResolutions();
      return task('salary', async () => {
        const suggestion = await suggestSalary(current.snapshot.candidates[current.candidate_index], (await loadSettings()).settings);
        if (this.current?.id !== current.id) throw new Error('The selected capture changed. Try again on the intended posting.');
        for (const key of ['salary_min','salary_max','salary_currency','salary_period']) values[key] = suggestion[key] ?? '';
        this.drafts.set(current.id, {values, resolutions, reviewed:false, salaryQuote:suggestion.quote});
        this.transport.delete(current.id); this.readiness.delete(current.id);
      });
    });
    form?.addEventListener('input', e => {
      keepDraft();
    });
    on('#capture-confirm-completeness', 'click', () => {
      const current = this.current;
      if (!current) return;
      const values = Object.fromEntries(new FormData(form));
      for (const [key] of captureFields) {
        if (values[key] === undefined && current.posting?.[key] !== undefined) {
          values[key] = current.posting[key];
        }
      }
      if (!(values.role_title || '').trim() || !(values.company_name || '').trim()) return;
      const decisions = readResolutions();
      const note = 'Compared the intended job title, employer and location, all available posting sections and qualifications with the original page and preserved source versions. Confirmed the current layout captures the intended job and its requirements are complete.';
      for (const w of captureWarnings(current)) {
        let action;
        if (['requirements_unverified', 'structured_only', 'unverified_layout'].includes(w.code)) action = 'verified_irrelevant';
        if (w.code === 'collapsed_content') action = 'verified_irrelevant';
        if (w.code === 'conflicting_sources' && w.field === 'description') {
          const variant = sourceVariants(current.snapshot.candidates[current.candidate_index]).find(v => v.text === values.description);
          action = variant ? `use_${variant.id}` : 'corrected';
        }
        if (['frames_not_read', 'source_truncated'].includes(w.code)) action = 'verified_irrelevant';
        if (w.code === 'invalid_salary_range' && values.salary_min != null && values.salary_max != null && Number(values.salary_min) <= Number(values.salary_max)) action = 'corrected';
        if (action) {
          const index = decisions.findIndex(r => r.warning_id === w.id);
          if (index >= 0) decisions.splice(index, 1);
          decisions.push({ warning_id: w.id, action, note: w.code === 'collapsed_content' ? 'Expanded the original posting and compared all of its text with the current description. Verified that the clipping warning does not indicate omitted text. ' + note : note });
        }
      }
      task('review', async () => {
        const corrected = await correctCapture(current, values, true, decisions);
        await saveCapture(corrected); this.transport.delete(current.id);
        this.captures[this.captures.indexOf(current)] = corrected; this.drafts.delete(current.id);
        await this.checkReadiness();
      });
    });
    const download = (value, filename) => {
      const url = URL.createObjectURL(new Blob([value], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    on('#capture-diagnostics-copy', 'click', () => task('copy', async () => { await navigator.clipboard.writeText(JSON.stringify(this.lastCaptureFailure, null, 2)); this.diagnosticsCopied = true; }));
    on('#capture-diagnostics-export', 'click', () => download(JSON.stringify(this.lastCaptureFailure, null, 2), 'job-hunt-capture-diagnostics.json'));
    form?.addEventListener('submit', e => e.preventDefault());
    on('#capture-export', 'click', () => {
      if (this.drafts.has(this.current.id)) { alert('Save your corrections before exporting.'); return; }
      download(JSON.stringify(this.current, null, 2), `job-hunt-capture-${this.current.id}.json`);
    });
  }
}
