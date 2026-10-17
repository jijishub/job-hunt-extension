import { createCapture, correctCapture, captureFields, captureWarnings, resolutionActions } from '../../src/captures.js';
export const settings = { model: 'test-model', baseUrl: 'http://127.0.0.1:9876/v1', apiKey: 'PRIVATE_GATEWAY_KEY' };
export const result = { fit: 'STRONG', explanation: 'The supplied resume demonstrates TypeScript services and SQL experience.', strengths: ['Built TypeScript services'], gaps: [], preference_alignment: 'UNKNOWN', preference_notes: '' };
export const resume = { id: 'resume-slot-1', label: 'Support', text: 'Exact résumé evidence\r\nBuilt TypeScript services and SQL support tools.\n' };
export const valuesFor = c => Object.fromEntries(captureFields.map(([k]) => [k, Array.isArray(c.posting[k]) ? c.posting[k].join('\n') : c.posting[k] ?? '']));
export async function reviewedCapture(url = 'https://jobs.lever.co/example/fit-pilot') {
  const description = 'Requirements\n\n- Build reliable TypeScript services with SQL databases.\n- Support customers and document production incidents.\n- Work with the team to test and deploy changes.';
  const posting = { role_title: 'Support Engineer', company_name: 'Example', description, qualifications: [], location: null, work_model: null, job_type: null,
    salary_min: null, salary_max: null, salary_currency: null, salary_period: null, job_url: url, seniority_level: null, first_response_at: null, job_platform: 'LEVER' };
  const c = createCapture({ captured_at: '2026-10-18T00:00:00Z', extractor_version: 'posting-pilot-v2', page_url: url, warnings: [], candidates: [{ posting,
    adapter: 'lever-dom', adapter_version: '1', provenance: { description: { method: 'dom', locator: '.description' } },
    source: { rendered_text: description, structured_text: '', structured_data: null, employer_key: 'jobs.lever.co/example', requisition_id: 'fit-pilot' }, warnings: [] }] });
  const resolutions = captureWarnings(c).filter(w => resolutionActions(c, w).includes('verified_irrelevant')).map(w => ({ warning_id: w.id, action: 'verified_irrelevant', note: 'Compared the entire posting and requirements with the source.' }));
  return correctCapture(c, valuesFor(c), true, resolutions);
}
export class MemoryStore {
  data = new Map();
  async get(k) { return structuredClone(this.data.get(k)); }
  async set(k, v) { this.data.set(k, structuredClone(v)); }
  async remove(k) { this.data.delete(k); }
  async list(prefix) { return [...this.data].filter(([k]) => k.startsWith(prefix)).map(([, v]) => structuredClone(v)); }
}
