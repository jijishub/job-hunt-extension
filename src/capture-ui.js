import { capturePosting } from './browser.js';
import { captureFields, captureWarnings, createCapture, correctCapture, selectCandidate, resolutionActions } from './captures.js';
import { serializeCapture } from './capture-transport.js';
import { sourceVariants, normalizeSalaryPeriod } from './capture-rules.js';
import { loadCaptures, saveCapture, deleteCapture } from './capture-storage.js';
import { CaptureFitPanel } from './capture-fit-ui.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export class CapturePanel {
  captures = [];
  selected = null;
  drafts = new Map();
  transport = new Map();
  fit = new CaptureFitPanel(this);
  configure(runtime) { this.fit.runtime = runtime; }
  async load() { this.captures = await loadCaptures(); this.selected = this.captures[0]?.id || null; await this.fit.load(); }
  get current() { return this.captures.find(c => c.id === this.selected); }
  reset() { this.captures = []; this.selected = null; this.drafts.clear(); this.transport.clear(); this.fit.jobs = []; this.fit.deliveries = []; this.fit.preferences = null; this.fit.connection = null; this.fit.preferenceDraft = false; }
  render(busy) {
    const capture = this.current, candidate = capture?.snapshot.candidates[capture.candidate_index];
    const draft = this.drafts.get(capture?.id), posting = draft?.values || capture?.posting;
    const disabled = busy ? 'disabled' : '';
    const warnings = capture ? captureWarnings(capture) : [];
    const resolutions = draft?.resolutions || capture?.resolutions || [];
    const labels = { use_rendered: 'Use original rendered description', use_structured: 'Use original structured description', corrected: 'I corrected the affected content', verified_irrelevant: 'I verified this warning is irrelevant' };
    const resolutionControls = capture ? warnings.map((warning, i) => {
      const actions = resolutionActions(capture, warning);
      if (!actions.length) return '';
      const resolution = resolutions.find(r => r.warning_id === warning.id);
      return `<div class="capture-resolution" data-warning-code="${esc(warning.code)}"><label class="label" for="resolution-action-${i}">${esc(warning.code)}</label><p class="hint">${esc(warning.message)}</p>
        <select id="resolution-action-${i}" data-resolution-action="${esc(warning.id)}" ${disabled}><option value="">Unresolved</option>${actions.map(action => `<option value="${action}" ${resolution?.action === action ? 'selected' : ''}>${labels[action]}</option>`).join('')}</select>
        <label class="label" for="resolution-note-${i}">EXPLANATION</label><textarea id="resolution-note-${i}" data-resolution-note="${esc(warning.id)}" rows="2" maxlength="2000" ${disabled}>${esc(resolution?.note || '')}</textarea></div>`;
    }).join('') : '';
    const transport = this.transport.get(capture?.id);
    const field = ([key, label]) => {
      const value = key === 'qualifications' && Array.isArray(posting[key]) ? posting[key].join('\n') : posting[key];
      const options = key === 'work_model' ? ['ON_SITE', 'HYBRID', 'REMOTE'] : key === 'job_type' ? ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERNSHIP'] : null;
      const provenance = capture.corrections[key] || candidate?.provenance[key];
      return `<label class="label" for="capture-${key}">${label}</label>${options
        ? `<select id="capture-${key}" name="${key}" ${disabled}><option value="">Unknown</option>${options.map(o => `<option ${value === o ? 'selected' : ''}>${o}</option>`).join('')}</select>`
        : ['description', 'qualifications'].includes(key)
          ? `<textarea id="capture-${key}" name="${key}" rows="${key === 'description' ? 12 : 5}" maxlength="120000" ${disabled}>${esc(value)}</textarea>`
          : `<input id="capture-${key}" name="${key}" value="${esc(value)}" ${['salary_min', 'salary_max'].includes(key) ? 'type="number" min="0" step="any"' : ''} ${disabled}>`}
        <p class="capture-provenance">${provenance ? esc(`${provenance.method}${provenance.locator ? ': ' + provenance.locator : ' correction'}`) : 'Not extracted · unknown'}</p>`;
    };
    return `<section class="card"><div class="section-head"><h2>Capture a posting</h2><span class="tag">LOCAL PILOT</span></div>
      <p class="hint">Open one full job posting, then capture it. Review the text against the page. Capturing stays local. Assessment and local tracker delivery each require a separate explicit action.</p>
      <button id="capture-posting" class="button primary full" ${disabled}>${busy === 'capture' ? 'Capturing posting…' : 'Capture current posting'}</button>
      <p class="hint">Your existing Gemini import workflow remains available in Job Hunt.</p>
      ${this.captures.length ? `<label class="label" for="capture-history">SAVED CAPTURES (${this.captures.length})</label><select id="capture-history" ${disabled}>${this.captures.map(c => `<option value="${esc(c.id)}" ${c.id === this.selected ? 'selected' : ''}>${esc(c.posting?.role_title || 'Choose posting')} · ${esc(c.posting?.company_name || new URL(c.snapshot.page_url).hostname)}</option>`).join('')}</select>` : '<p class="hint">No local captures yet.</p>'}</section>
      ${capture ? `<section class="card capture-preview"><h2>Posting preview</h2><p class="hint">${esc(capture.snapshot.captured_at)} · ${esc(capture.snapshot.extractor_version)}<br>${esc(capture.snapshot.page_url)}</p>
      <p class="capture-status">${capture.reviewed_at && capture.review_basis_hash ? 'Reviewed by you · Local only' : 'Needs review · Local only'}${draft ? ' · Unsaved corrections' : ''}</p>
      <div class="capture-warnings" role="note"><strong>Completeness warnings</strong><ul>${warnings.map(w => `<li data-warning-id="${esc(w.id)}"><strong>${esc(w.code)}</strong>: ${esc(w.message)}</li>`).join('')}</ul><p>These checks cannot prove completeness. A review mark does not clear extraction warnings.</p></div>
      ${capture.snapshot.candidates.length > 1 ? `<label class="label" for="capture-candidate">WHICH POSTING?</label><select id="capture-candidate" ${disabled}><option value="">Choose a posting</option>${capture.snapshot.candidates.map((c, i) => `<option value="${i}" ${capture.candidate_index === i ? 'selected' : ''}>${esc(c.posting.role_title || 'Untitled')} · ${esc(c.posting.company_name || 'Unknown company')} (${esc(c.adapter)})</option>`).join('')}</select>` : ''}
      ${posting ? `<form id="capture-form">${captureFields.map(field).join('')}<p class="hint">Normalized salary period: ${esc(normalizeSalaryPeriod(posting.salary_period) || 'Unknown')}. The raw period remains preserved. Leave unknown facts blank. Seniority and first employer response remain null. Referral and Walk-in require a saved user correction.</p>
      ${resolutionControls ? `<div class="capture-resolutions"><h3>Resolve review warnings</h3><p class="hint">Choose a specific decision and explain it. Source choices replace the description with that original variant. Editing posting facts clears prior resolutions and review.</p>${resolutionControls}</div>` : ''}
      <label class="check"><input id="capture-reviewed" type="checkbox" ${draft ? draft.reviewed ? 'checked' : '' : capture.reviewed_at && capture.review_basis_hash ? 'checked' : ''} ${disabled}> I compared this with the full posting and checked the requirements.</label>
      <button class="button primary full" ${disabled}>Save corrections locally</button></form>` : ''}
      <details><summary>Preserved source & provenance</summary><p class="hint">Original extraction is kept separately from corrections. Source text excludes application form controls. This is a posting excerpt, not full-page HTML.</p>
      ${capture.snapshot.candidates.map((c, i) => `<article class="capture-source"><h3>Source ${i + 1}: ${esc(c.adapter)}</h3><p class="hint">Requisition: ${esc(c.source.requisition_id || 'Unknown')} · Salary period: ${esc(c.source.salary_period || 'Unknown')}</p><h4>Rendered posting text</h4><pre>${esc(c.source.rendered_text || '(None captured)')}</pre><h4>Structured posting text</h4><pre>${esc(c.source.structured_text || '(None captured)')}</pre><details><summary>Selected structured facts and field provenance</summary><pre>${esc(JSON.stringify({ structured_data: c.source.structured_data, structured_url: c.source.structured_url, provenance: c.provenance }, null, 2))}</pre></details></article>`).join('')}</details>
      <div class="button-row"><button id="capture-export" class="text-button" ${disabled}>Export local pilot JSON</button><button id="capture-delete" class="text-button danger" ${disabled}>Delete capture</button></div><p class="hint">Export includes preserved source text and corrections. Its pilot schema is not a tracker API contract. Save corrections before exporting.</p></section>` : ''}
      ${this.fit.render(capture, busy)}
      ${capture ? `<section class="card"><h2>Offline transport check</h2><p class="hint">Prepare a request with the current matching fit, if available, or leave it Unassessed. Preparation never uploads or calls AI. Unresolved selections and oversized bodies stay local.</p><button id="capture-prepare" class="button secondary full" ${disabled}>Prepare offline request</button>
      ${transport ? `<div class="capture-transport"><p>${transport.bytes} / ${transport.max_bytes} UTF-8 bytes</p><p>${transport.assessment.eligible ? 'Local review checks passed; server validation is still required.' : `Assessment blocked: ${esc(transport.assessment.reasons.join(', '))}`}</p><details><summary>Proposed request JSON</summary><pre>${esc(transport.json)}</pre></details><button id="capture-transport-export" class="text-button">Download offline request JSON</button></div>` : ''}</section>` : ''}`;
  }
  bind(app, task, refresh) {
    this.fit.bind(app, task, refresh);
    const on = (selector, event, fn) => app.querySelector(selector)?.addEventListener(event, fn);
    on('#capture-posting', 'click', () => task('capture', async () => {
      const snapshot = await capturePosting();
      if (!snapshot.candidates.length) throw new Error(snapshot.warnings.map(w => typeof w === 'string' ? w : w.message).join(' '));
      const capture = createCapture(snapshot);
      await saveCapture(capture);
      this.captures.unshift(capture); this.selected = capture.id;
    }));
    on('#capture-history', 'change', e => { this.selected = e.target.value; refresh(); });
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
      app.querySelector('.capture-status').textContent = 'Unsaved corrections · Local only';
    };
    const invalidate = (resolutions) => {
      form.querySelector('#capture-reviewed').checked = false;
      if (resolutions) {
        form.querySelectorAll('[data-resolution-action]').forEach(el => { el.value = ''; });
        form.querySelectorAll('[data-resolution-note]').forEach(el => { el.value = ''; });
      }
    };
    form?.addEventListener('input', e => {
      if (e.target.matches('[data-resolution-action]')) return;
      if (e.target.id !== 'capture-reviewed') invalidate(!!e.target.name);
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
    on('#capture-prepare', 'click', () => task('serialize', async () => {
      if (this.drafts.has(this.current.id)) throw new Error('Save corrections and resolutions before preparing offline request JSON.');
      if (this.fit.preferenceDraft) throw new Error('Save preference edits first.');
      await this.fit.prepare();
    }));
    const download = (value, filename) => {
      const url = URL.createObjectURL(new Blob([value], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
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
