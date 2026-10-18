// Offline projection only: no fetch, credentials, outbox or network side effects.
import { captureWarnings, resolutionErrors } from './captures.js';
import { MAX_CAPTURE_BYTES, POSTING_FIELDS, INFORMATIONAL_WARNINGS, composeRequirements, normalizeSalaryPeriod,
  sourceVariants, contentHash, reviewHash } from './capture-rules.js';
import { validateExtensionAssessment } from './role-fit.js';

export class CaptureTransportError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'CaptureTransportError'; this.code = code; Object.assign(this, details); }
}
function fail(code, message, field) { throw new CaptureTransportError(code, message, { field }); }
function text(value, field, max = Infinity, nullable = true) {
  if (value == null && nullable) return null;
  if (typeof value !== 'string') fail('INVALID_FIELD', `${field} must be text${nullable ? ' or null' : ''}.`, field);
  if (value.length > max) fail('FIELD_TOO_LARGE', `${field} exceeds ${max} UTF-16 code units.`, field);
  return value;
}
function timestamp(value, field) {
  text(value, field, Infinity, false);
  if (!/^\d{4}-\d\d-\d\dT(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value.slice(0, 10)).toISOString().slice(0, 10) !== value.slice(0, 10)) fail('INVALID_TIMESTAMP', `${field} must be a valid ISO timestamp with timezone.`, field);
  return value;
}
function httpUrl(value, field) {
  text(value, field, Infinity, false);
  let url; try { url = new URL(value); } catch { fail('INVALID_URL', `${field} must be an absolute HTTP(S) URL.`, field); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) fail('INVALID_URL', `${field} must be an HTTP(S) URL without credentials.`, field);
  return value;
}
function qualifications(value, field) {
  if (!Array.isArray(value) || value.length > 200) fail('INVALID_QUALIFICATIONS', `${field} must contain at most 200 text items.`, field);
  return Array.from(value, (q, i) => text(q, `${field}[${i}]`, 4000, false));
}
function postingProjection(input) {
  const posting = Object.fromEntries(POSTING_FIELDS.map(key => [key, input[key] ?? (key === 'description' ? '' : key === 'qualifications' ? [] : null)]));
  for (const key of POSTING_FIELDS.filter(k => !['qualifications', 'salary_min', 'salary_max'].includes(k))) text(posting[key], `posting.${key}`, key === 'description' ? 120000 : Infinity);
  posting.qualifications = qualifications(posting.qualifications, 'posting.qualifications');
  for (const key of ['salary_min', 'salary_max']) if (posting[key] != null && (typeof posting[key] !== 'number' || !Number.isFinite(posting[key]) || posting[key] < 0)) fail('INVALID_SALARY', 'Salary amounts must be finite nonnegative numbers or null.', key);
  if (posting.salary_min != null && posting.salary_max != null && posting.salary_min > posting.salary_max) fail('INVALID_SALARY', 'Salary maximum cannot be below minimum.');
  if (posting.salary_currency != null && !/^[A-Za-z]{3}$/.test(posting.salary_currency)) fail('INVALID_CURRENCY', 'Salary currency must be a three-letter code.');
  for (const [field, allowed] of [['work_model', ['ON_SITE', 'HYBRID', 'REMOTE']], ['job_type', ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERNSHIP']]]) {
    if (posting[field] != null && !allowed.includes(posting[field])) fail('INVALID_ENUM', `Invalid ${field}.`, field);
  }
  if (posting.seniority_level != null || posting.first_response_at != null) fail('PROTECTED_FIELD', 'Capture seniority and first employer response must remain null.');
  const normalized = normalizeSalaryPeriod(posting.salary_period);
  if (posting.salary_pay_period != null && posting.salary_pay_period !== normalized) fail('SALARY_PERIOD_CONFLICT', 'Raw and normalized salary periods conflict.');
  posting.salary_pay_period = normalized;
  posting.job_url = httpUrl(posting.job_url, 'posting.job_url');
  return posting;
}
function channel(value) {
  if (typeof value !== 'string') return null;
  const key = value.trim().toLowerCase().replace(/[\s_-]+/g, '');
  return key === 'referral' ? 'Referral' : key === 'walkin' ? 'Walk-in' : null;
}
// Derive only from the captured URL, never a user-edited URL or company label.
function platformFromUrl(value) {
  const host = new URL(value).hostname.toLowerCase();
  const registry = { GREENHOUSE: ['job-boards.greenhouse.io', 'boards.greenhouse.io'], LEVER: ['jobs.lever.co'],
    LINKEDIN: ['linkedin.com'], JOBSTREET: ['jobstreet.com', 'jobstreet.com.ph', 'jobstreet.com.sg', 'jobstreet.com.my', 'jobstreet.co.id'],
    INDEED: ['indeed.com', 'indeed.com.ph', 'indeed.co.uk'], WORKDAY: ['myworkdayjobs.com'], ASHBY: ['jobs.ashbyhq.com'] };
  return Object.entries(registry).find(([, domains]) => domains.some(d => host === d || host.endsWith('.' + d)))?.[0] || null;
}
function structuredFacts(source) {
  if (source.structured_data == null) return undefined;
  let data; try { data = typeof source.structured_data === 'string' ? JSON.parse(source.structured_data) : source.structured_data; }
  catch { fail('INVALID_STRUCTURED_FACTS', 'Preserved structured facts are not valid JSON.'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail('INVALID_STRUCTURED_FACTS', 'Structured facts must be an object.');
  const allowed = new Set(['title', 'company', 'location', 'salary_period', 'description', 'qualifications', 'employmentType', 'salary_min', 'salary_max', 'salary_currency']);
  const result = {};
  for (const [key, value] of Object.entries(data)) {
    if (!allowed.has(key)) fail('UNKNOWN_STRUCTURED_FACT', `Unknown original fact: ${key}.`, `source.structured_facts.${key}`);
    if (['qualifications', 'employmentType'].includes(key)) result[key] = qualifications(value, `source.structured_facts.${key}`);
    else if (['salary_min', 'salary_max'].includes(key)) {
      if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) fail('INVALID_STRUCTURED_FACTS', 'Invalid structured salary fact.', `source.structured_facts.${key}`);
      result[key] = value;
    } else {
      if (value !== null && typeof value !== 'string') fail('INVALID_STRUCTURED_FACTS', 'Original text facts must be strings or null.', `source.structured_facts.${key}`);
      result[key] = text(value, `source.structured_facts.${key}`, key === 'description' ? 120000 : Infinity);
      if (key === 'salary_currency' && value !== null && !/^[A-Za-z]{3}$/.test(value)) fail('INVALID_CURRENCY', 'Original salary currency must be three ASCII letters or null.', `source.structured_facts.${key}`);
    }
  }
  return result;
}
export async function serializeCapture(capture, { requestAssessment = false, extensionAssessment = null } = {}) {
  if (typeof requestAssessment !== 'boolean') fail('INVALID_FIELD', 'requestAssessment must be explicitly boolean.');
  const index = capture.candidate_index;
  if (!capture.snapshot.candidates.length || !Number.isInteger(index) || index < 0 || !capture.snapshot.candidates[index] || !capture.posting) fail('SELECTION_REQUIRED', 'Select one posting locally before preparing transport JSON.');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(capture.id)) fail('INVALID_CAPTURE_ID', 'A capture UUID is required.');
  const candidate = capture.snapshot.candidates[index];
  const variants = sourceVariants(candidate);
  if (!variants.some(v => v.text.trim())) fail('SOURCE_VARIANTS_REQUIRED', 'At least one non-whitespace original text variant is required. This capture remains local.');
  for (const variant of variants) text(variant.text, `source.variants.${variant.id}.text`, 120000, false);
  const posting = postingProjection(capture.posting);
  const pageUrl = httpUrl(capture.snapshot.page_url, 'source.page_url');
  const corrections = {};
  for (const [key, value] of Object.entries(capture.corrections || {})) {
    if (!POSTING_FIELDS.includes(key)) continue;
    if (value?.method !== 'user') fail('INVALID_CORRECTION', 'Saved corrections must have user provenance.');
    corrections[key] = { method: 'user', updated_at: timestamp(value.updated_at, `source.corrections.${key}.updated_at`) };
  }
  const userChannel = channel(posting.job_platform);
  if (channel(candidate.posting.job_platform)) fail('PAGE_SUPPLIED_CHANNEL', 'Original posting facts cannot claim Referral or Walk-in.');
  let userContext;
  if (userChannel) {
    if (!corrections.job_platform) fail('UNSAVED_USER_CHANNEL', 'A user channel requires an explicit saved user correction.');
    userContext = { application_channel: userChannel, supplied_at: corrections.job_platform.updated_at };
    posting.job_platform = platformFromUrl(pageUrl);
  }
  const provenance = {};
  for (const [key, value] of Object.entries(candidate.provenance || {})) {
    if (!POSTING_FIELDS.includes(key)) continue;
    if (!['dom', 'jsonld', 'browser', 'url'].includes(value?.method)) fail('INVALID_PROVENANCE', 'Invalid original provenance method.');
    const entry = { method: value.method, locator: text(value.locator, `source.field_provenance.${key}.locator`, 2000, false) };
    const variantId = value.variant_id ?? (value.method === 'dom' ? 'rendered' : value.method === 'jsonld' ? 'structured' : null);
    if (value.variant_id && !variants.some(v => v.id === value.variant_id)) fail('INVALID_VARIANT_REFERENCE', 'A provenance variant reference does not exist.');
    if (variants.some(v => v.id === variantId)) entry.variant_id = variantId;
    provenance[key] = entry;
  }
  const warnings = captureWarnings(capture).map(w => {
    const warning = { id: text(w.id, 'warning.id', 100, false), code: text(w.code, 'warning.code', 100, false), message: text(w.message, 'warning.message', 2000, false) };
    if (w.field) warning.field = text(w.field, 'warning.field', 100, false);
    if (w.variant_ids) {
      if (!Array.isArray(w.variant_ids) || w.variant_ids.some(id => !variants.some(v => v.id === id))) fail('INVALID_VARIANT_REFERENCE', 'A warning references an absent source variant.');
      warning.variant_ids = [...w.variant_ids];
    }
    return warning;
  });
  if (warnings.length > 100 || (capture.resolutions || []).length > 100) fail('TOO_MANY_ENTRIES', 'Warnings and resolutions are limited to 100 entries each.');
  const resolutions = (capture.resolutions || []).map(r => ({ warning_id: text(r.warning_id, 'resolution.warning_id', 100, false),
    action: text(r.action, 'resolution.action', 100, false), note: text(r.note, 'resolution.note', 2000, false) }));
  const problems = resolutionErrors(capture, resolutions);
  if (problems.length) fail('INVALID_RESOLUTION', problems.join(' '));
  if (resolutions.length && capture.resolution_basis_hash !== await contentHash(capture)) fail('STALE_REVIEW', 'Posting or source changed after resolutions were saved. Resolve and review the current content again.');
  if (capture.reviewed_at && capture.review_basis_hash !== await reviewHash(capture)) fail('STALE_REVIEW', 'Posting, source or resolutions changed after review. Review the current content again.');
  const historicalSalaryWarnings = warnings.filter(w => w.code === 'invalid_salary_range');
  if (historicalSalaryWarnings.length && (!(corrections.salary_min || corrections.salary_max) || !capture.reviewed_at ||
    historicalSalaryWarnings.some(w => !resolutions.some(r => r.warning_id === w.id && r.action === 'corrected')))) {
    fail('HISTORICAL_SALARY_REVIEW_REQUIRED', 'A historical invalid salary range requires corrected amount metadata, a corrected resolution, and fresh review. Explicitly clearing amounts to unknown is allowed.');
  }
  const source = { method: variants.length === 2 || (variants[0].method === 'dom' && Object.values(provenance).some(p => p.method === 'jsonld')) ? 'jsonld+dom' : variants[0].method === 'dom' ? 'dom' : 'jsonld',
    adapter_id: text(candidate.adapter, 'source.adapter_id', 100, false), adapter_version: text(candidate.adapter_version, 'source.adapter_version', 100, false),
    extractor_version: text(capture.snapshot.extractor_version, 'source.extractor_version', 100, false), page_url: pageUrl, candidate_index: index,
    requisition_id: text(candidate.source.requisition_id, 'source.requisition_id', 100), employer_key: text(candidate.source.employer_key, 'source.employer_key', 100),
    variants, field_provenance: provenance, corrections, warnings };
  const facts = structuredFacts(candidate.source);
  if (facts) source.structured_facts = facts;
  const payload = { schema_version: 1, capture_id: capture.id, captured_at: timestamp(capture.snapshot.captured_at, 'captured_at'), posting, source,
    review: { reviewed_at: capture.reviewed_at ? timestamp(capture.reviewed_at, 'review.reviewed_at') : null, resolutions }, request_assessment: requestAssessment };
  if (userContext) payload.user_context = userContext;
  if (extensionAssessment) {
    if (requestAssessment) fail('SERVER_ASSESSMENT_DISABLED', 'Extension results require request_assessment:false.');
    payload.extension_assessment = await validateExtensionAssessment(extensionAssessment, posting);
  }
  const json = JSON.stringify(payload), bytes = new TextEncoder().encode(json).byteLength;
  if (bytes > MAX_CAPTURE_BYTES) throw new CaptureTransportError('CAPTURE_TOO_LARGE', `Offline request is ${bytes} bytes; the limit is ${MAX_CAPTURE_BYTES}. The full capture remains local and nothing was uploaded.`, { actual_bytes: bytes, max_bytes: MAX_CAPTURE_BYTES });
  const reasons = [];
  if (!posting.role_title?.trim()) reasons.push('missing_role_title');
  if (!posting.company_name?.trim()) reasons.push('missing_company_name');
  if (!payload.review.reviewed_at) reasons.push('pilot_review_required');
  const resolved = new Set(resolutions.map(r => r.warning_id));
  if (!['greenhouse-dom', 'lever-dom'].includes(candidate.adapter) && !warnings.some(w => ['unverified_layout', 'structured_only'].includes(w.code) && resolved.has(w.id))) reasons.push('unverified_layout');
  for (const warning of warnings) {
    // Original missing-identity warnings stay in the evidence, but supplying the
    // identity removes this current blocker without an acknowledgement action.
    if (warning.code === 'missing_role_title' && posting.role_title?.trim()) continue;
    if (warning.code === 'missing_company_name' && posting.company_name?.trim()) continue;
    if (!INFORMATIONAL_WARNINGS.has(warning.code) && !resolved.has(warning.id)) reasons.push(warning.code);
  }
  const requirements = composeRequirements(posting);
  if (!requirements.trim()) reasons.push('missing_requirements');
  if (requirements.length > 30000) reasons.push('oversized_requirements');
  if (extensionAssessment && reasons.length) fail('ASSESSMENT_REQUIRES_REVIEW', 'Resolve current capture review and identity blockers before attaching an extension assessment.');
  return { payload, json, bytes, max_bytes: MAX_CAPTURE_BYTES, headers: { 'Content-Type': 'application/json', 'Idempotency-Key': capture.id },
    // Advisory offline diagnostics. The server must independently determine eligibility.
    assessment: { eligible: reasons.length === 0, reasons: [...new Set(reasons)], requirements_units: requirements.length } };
}
