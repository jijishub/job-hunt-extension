import { canonicalJSON } from './canonical-json.js';
export const MAX_CAPTURE_BYTES = 262144;
export const POSTING_FIELDS = ['role_title', 'company_name', 'description', 'qualifications', 'location', 'work_model', 'job_type',
  'salary_min', 'salary_max', 'salary_currency', 'salary_period', 'salary_pay_period', 'job_url', 'seniority_level', 'job_platform', 'first_response_at'];
export const INFORMATIONAL_WARNINGS = new Set(['unknown_work_model', 'unknown_job_type', 'unknown_salary_currency', 'unknown_salary_period', 'unsupported_employment_type']);
export function normalizeSalaryPeriod(raw) {
  return ({ HOUR: 'HOURLY', HOURLY: 'HOURLY', DAY: 'DAILY', DAILY: 'DAILY', WEEK: 'WEEKLY', WEEKLY: 'WEEKLY',
    MONTH: 'MONTHLY', MONTHLY: 'MONTHLY', YEAR: 'ANNUAL', YEARLY: 'ANNUAL', ANNUAL: 'ANNUAL' })[String(raw ?? '').trim().toUpperCase()] || null;
}
const whitespace = value => value.replace(/\s+/g, ' ').trim();
// Exact normalized paragraphs/list items only. Substrings are not duplicates.
export function composeRequirements(posting) {
  const description = posting.description || '';
  const existing = new Set();
  let block = '';
  const flush = () => { if (block.trim()) existing.add(whitespace(block)); block = ''; };
  for (const line of description.split('\n')) {
    const match = line.replace(/\r$/, '').match(/^\s*(?:[-*•]|\d+[.)])\s+(.+)$/);
    if (!line.trim()) flush();
    else if (match) { flush(); block = match[1]; }
    else block += (block ? '\n' : '') + line;
  }
  flush();
  const remaining = (posting.qualifications || []).filter(q => whitespace(q) && !existing.has(whitespace(q)));
  return [description, remaining.length ? `Qualifications:\n${remaining.map(q => `- ${q}`).join('\n')}` : ''].filter(Boolean).join('\n\n');
}
export function sourceVariants(candidate) {
  const rendered = candidate.source.rendered_text;
  const extra = candidate.source.salary_excerpt?.split('\n').filter(line => !rendered?.includes(line)).join('\n');
  const withSalary = rendered && extra ? `${rendered}\n\nSalary wording from the selected posting:\n${extra}` : rendered;
  return [['rendered', 'dom', withSalary], ['structured', 'jsonld', candidate.source.structured_text]]
    .filter(([, , text]) => typeof text === 'string' && text.length > 0).map(([id, method, text]) => ({ id, method, text }));
}
export async function contentHash(capture) {
  const candidate = capture.snapshot.candidates[capture.candidate_index];
  // A local integrity binding, not an authorization mechanism. Include original
  // facts/provenance as well as source text; exclude unrelated candidates.
  const content = canonicalJSON([capture.id, capture.candidate_index, capture.snapshot.captured_at,
    capture.snapshot.page_url, capture.snapshot.extractor_version, capture.snapshot.warnings, candidate, capture.posting, capture.corrections]);
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}
export async function reviewHash(capture) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJSON([await contentHash(capture), capture.resolutions || []])));
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}
