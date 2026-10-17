// Local pilot schema. This is not the proposed tracker API payload.
import { composeRequirements, contentHash, reviewHash, sourceVariants, INFORMATIONAL_WARNINGS } from './capture-rules.js';
export const captureFields = [
  ['role_title', 'Role title'], ['company_name', 'Company'], ['description', 'Description'],
  ['qualifications', 'Qualifications (one per line)'], ['location', 'Location'], ['work_model', 'Work model'],
  ['job_type', 'Job type'], ['salary_min', 'Minimum salary'], ['salary_max', 'Maximum salary'],
  ['salary_currency', 'Salary currency'], ['salary_period', 'Salary period (as stated)'], ['job_url', 'Posting URL'], ['job_platform', 'Platform']
];
export function createCapture(snapshot) {
  return { local_schema_version: 2, id: crypto.randomUUID(), snapshot, candidate_index: snapshot.candidates.length === 1 ? 0 : null,
    posting: snapshot.candidates.length === 1 ? structuredClone(snapshot.candidates[0].posting) : null,
    corrections: {}, resolutions: [], reviewed_at: null, review_basis_hash: null, resolution_basis_hash: null, updated_at: snapshot.captured_at };
}
export function selectCandidate(capture, index) {
  if (!Number.isInteger(index) || !capture.snapshot.candidates[index]) throw new Error('Choose an existing posting candidate.');
  if (index === capture.candidate_index) return capture;
  return { ...capture, id: capture.candidate_index == null ? capture.id : crypto.randomUUID(), candidate_index: index,
    posting: structuredClone(capture.snapshot.candidates[index].posting), corrections: {}, resolutions: [],
    reviewed_at: null, review_basis_hash: null, resolution_basis_hash: null, updated_at: new Date().toISOString() };
}
export function captureWarnings(capture) {
  const candidate = capture.snapshot.candidates[capture.candidate_index];
  const p = capture.posting;
  // Never infer codes from legacy English messages. IDs are stable within an
  // immutable capture, with separate scopes for page and selected-candidate data.
  const records = (list, scope) => (list || []).map((w, i) => typeof w === 'string'
    ? { id: `${scope}-${i}`, code: 'unclassified_warning', message: w }
    : { ...w, id: `${scope}-${i}` });
  const warnings = [...records(capture.snapshot.warnings, 'snapshot'), ...records(candidate?.warnings, `candidate-${capture.candidate_index}`)];
  const add = (code, message, field) => warnings.push({ id: `quality-${code}${field ? '-' + field : ''}`, code, message, ...(field ? { field } : {}) });
  if (!p) { add('ambiguous_posting', 'Choose the intended posting before reviewing.'); return warnings; }
  // Preserve original quality warnings even after corrections, and detect newly
  // introduced problems as well. Corrections/review never erase source evidence.
  for (const posting of [candidate.posting, p]) {
    if (!posting.role_title?.trim()) add('missing_role_title', 'Role title is missing.', 'role_title');
    if (!posting.company_name?.trim()) add('missing_company_name', 'Company name is missing.', 'company_name');
    const requirements = composeRequirements(posting);
    if (!requirements.trim()) add('missing_requirements', 'Little or no requirements text was captured. Add the full posting text or use Gemini.', 'description');
    if (!posting.work_model) add('unknown_work_model', 'Work model is unknown; it has been left blank.', 'work_model');
    if (!posting.job_type) add('unknown_job_type', 'Job type is unknown; it has been left blank.', 'job_type');
    if ((posting.salary_min != null || posting.salary_max != null) && !posting.salary_currency) add('unknown_salary_currency', 'Salary currency is unknown; no currency has been assumed.', 'salary_currency');
    if ((posting.salary_min != null || posting.salary_max != null) && !posting.salary_period) add('unknown_salary_period', 'Salary period is unknown; no pay period has been assumed.', 'salary_period');
    if (posting.salary_min != null && posting.salary_max != null && posting.salary_min > posting.salary_max) add('invalid_salary_range', 'The extracted salary range is reversed. Check and correct it.', 'salary_min');
    if (requirements.length > 30000) add('oversized_requirements', 'Composed requirements exceed the tracker assessment limit of 30,000 UTF-16 code units.', 'description');
  }
  add('requirements_unverified', `Completeness is unverified. ${composeRequirements(p).trim().length < 100 ? 'Only a short excerpt is present. ' : ''}Compare the preview with the full posting, including collapsed sections.`);
  return [...new Map(warnings.map(w => [w.id, w])).values()];
}
export function resolutionActions(capture, warning) {
  if (INFORMATIONAL_WARNINGS.has(warning.code) || ['missing_role_title', 'missing_company_name', 'ambiguous_posting'].includes(warning.code)) return [];
  const actions = ['corrected'];
  if (warning.field === 'description' && warning.code === 'conflicting_sources') {
    for (const variant of sourceVariants(capture.snapshot.candidates[capture.candidate_index])) actions.unshift(`use_${variant.id}`);
  }
  if (!['missing_requirements', 'oversized_requirements', 'invalid_salary_range'].includes(warning.code)) actions.push('verified_irrelevant');
  return actions;
}
export function resolutionErrors(capture, resolutions) {
  const warnings = captureWarnings(capture), seen = new Set(), errors = [];
  for (const r of resolutions) {
    const warning = warnings.find(w => w.id === r.warning_id);
    if (!warning || seen.has(r.warning_id)) { errors.push('Unknown or duplicate warning resolution.'); continue; }
    seen.add(r.warning_id);
    if (!resolutionActions(capture, warning).includes(r.action)) errors.push(`Unsupported resolution for ${warning.code}.`);
    if (typeof r.note !== 'string' || !r.note.trim()) errors.push('Every resolution needs an explanation.');
    if (r.action === 'use_rendered' || r.action === 'use_structured') {
      const variant = sourceVariants(capture.snapshot.candidates[capture.candidate_index]).find(v => r.action === `use_${v.id}`);
      if (!variant || capture.posting.description !== variant.text) errors.push('The corrected description must match the chosen original source variant.');
    }
    if (r.action === 'corrected') {
      const changed = warning.code === 'invalid_salary_range' ? capture.corrections.salary_min || capture.corrections.salary_max
        : warning.code === 'missing_requirements' || warning.code === 'oversized_requirements' ? capture.corrections.description || capture.corrections.qualifications
          : warning.field ? capture.corrections[warning.field] : capture.corrections.description || capture.corrections.qualifications;
      if (!changed) errors.push(`Save an actual correction before resolving ${warning.code} as corrected.`);
    }
    if (warning.code === 'missing_requirements' && !composeRequirements(capture.posting).trim()) errors.push('Missing requirements must be supplied; acknowledgement is insufficient.');
    if (warning.code === 'oversized_requirements' && composeRequirements(capture.posting).length > 30000) errors.push('Oversized requirements cannot be waived.');
    if (warning.code === 'invalid_salary_range' && capture.posting.salary_min != null && capture.posting.salary_max != null && capture.posting.salary_min > capture.posting.salary_max) errors.push('Correct the reversed salary range.');
  }
  return errors;
}
export async function correctCapture(capture, values, reviewed, resolutions = []) {
  const posting = structuredClone(capture.posting);
  for (const [key] of captureFields) {
    const input = String(values[key] ?? '');
    const value = key === 'description' ? input : input.trim();
    if (['salary_min', 'salary_max'].includes(key)) {
      if (value && (!Number.isFinite(Number(value)) || Number(value) < 0)) throw new Error('Salary must be a nonnegative number or blank.');
      posting[key] = value ? Number(value) : null;
    } else if (key === 'qualifications') posting[key] = input === (capture.posting.qualifications || []).join('\n')
      ? structuredClone(capture.posting.qualifications || []) : value ? value.split('\n').map(s => s.trim()).filter(Boolean) : [];
    else posting[key] = value || (key === 'description' ? '' : null);
  }
  if (posting.salary_currency) {
    if (!/^[A-Za-z]{3}$/.test(posting.salary_currency)) throw new Error('Use a three-letter salary currency or leave it blank.');
    posting.salary_currency = posting.salary_currency.toUpperCase();
  }
  if (posting.salary_min != null && posting.salary_max != null && posting.salary_min > posting.salary_max) throw new Error('Maximum salary must be at least the minimum.');
  if (posting.work_model && !['ON_SITE', 'HYBRID', 'REMOTE'].includes(posting.work_model)) throw new Error('Choose a listed work model.');
  if (posting.job_type && !['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERNSHIP'].includes(posting.job_type)) throw new Error('Choose a listed job type.');
  if (posting.job_url) {
    let url; try { url = new URL(posting.job_url); } catch { throw new Error('Use an HTTP or HTTPS posting URL.'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Use an HTTP or HTTPS posting URL without embedded credentials.');
  }
  // A page can never supply these classifications or response dates.
  posting.seniority_level = null; posting.first_response_at = null;
  const now = new Date().toISOString();
  const original = capture.snapshot.candidates[capture.candidate_index].posting;
  const corrections = Object.fromEntries(captureFields.filter(([key]) => JSON.stringify(posting[key] ?? null) !== JSON.stringify(original[key] ?? null)).map(([key]) => [key,
    JSON.stringify(posting[key]) === JSON.stringify(capture.posting[key]) && capture.corrections[key] ? capture.corrections[key] : { method: 'user', updated_at: now }]));
  const result = { ...capture, local_schema_version: 2, posting, corrections, resolutions: structuredClone(resolutions), updated_at: now,
    reviewed_at: reviewed ? now : null, review_basis_hash: null, resolution_basis_hash: null };
  const errors = resolutionErrors(result, resolutions);
  if (errors.length) throw new Error(errors.join(' '));
  if (resolutions.length) result.resolution_basis_hash = await contentHash(result);
  if (reviewed) result.review_basis_hash = await reviewHash(result);
  return result;
}
