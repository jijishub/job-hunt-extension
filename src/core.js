export const defaults = {
  resumes: [null, null, null], selected: 0, profile: {},
  settings: { baseUrl: 'https://api.jizellecasia.site/v1', model: 'luna', apiKey: '', speed: 'instant', overwrite: false },
  cache: {}
};
export const profileFields = [
  ['firstName', 'First name'], ['lastName', 'Last name'], ['email', 'Email'],
  ['phone', 'Phone'], ['city', 'City'], ['country', 'Country'],
  ['linkedin', 'LinkedIn URL'], ['website', 'Portfolio / website'],
  ['currentSalary', 'Current salary (optional · include currency / period)'],
  ['salary', 'Expected salary (include currency / period)'], ['notice', 'Notice period / availability']
];
export function normalize(value) { return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
export function localAnswer(field, profile) {
  const text = normalize(`${field.label} ${field.autocomplete || ''} ${field.name || ''}`);
  if (/country calling code/.test(text)) return '';
  if (field.type === 'custom-select' && normalize(field.label) === 'current location') return profile.country || '';
  const aliases = {
    firstName: /\b(first name|given name|given name|firstname)\b/,
    lastName: /\b(last name|family name|surname|lastname)\b/,
    email: /\b(e mail|email)\b/, phone: /\b(phone|telephone|mobile|tel|contact number)\b/,
    city: /\b(city|address level2)\b/, country: /\b(country|country name)\b/,
    linkedin: /\blinkedin\b/, website: /\b(website|portfolio|personal site)\b/,
    currentSalary: /\b(current (?:basic )?(?:salary|compensation|pay)|present salary|last drawn salary|currentsalary)\b/,
    salary: /\b(expected salary|salary expectation|desired salary)\b/,
    notice: /\b(notice period|availability|available to start)\b/
  };
  if (field.type === 'file' || field.type === 'checkbox' || field.type === 'radio') return '';
  if (/\b(full name|your name)\b/.test(text)) return [profile.firstName, profile.lastName].filter(Boolean).join(' ');
  for (const [key, re] of Object.entries(aliases)) if (re.test(text) && profile[key]) return profile[key];
  return '';
}
export function parseJSON(content) {
  const text = String(content).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(text); } catch { throw new Error('The AI did not return valid JSON. Try again or choose a different model.'); }
}
export function validateAnswers(raw, fields) {
  if (!Array.isArray(raw?.answers)) throw new Error('The AI response is missing its answers list.');
  const byId = new Map(fields.map(f => [f.id, f]));
  const seen = new Set();
  return raw.answers.filter(a => {
    const f = byId.get(a?.id);
    if (!f || seen.has(a.id) || typeof a.value !== 'string' || !a.value.trim() || a.value.length > 6000 || f.type === 'file') return false;
    const choices = f.multiple ? a.value.split('\n').map(v => v.trim()).filter(Boolean) : [a.value];
    if (f.options?.length && !f.optionsIncomplete && !choices.every(value => f.options.some(o => normalize(o.label) === normalize(value) || o.value === value))) return false;
    if (f.type === 'checkbox' && !['true', 'false'].includes(a.value)) return false;
    seen.add(a.id); return true;
  }).map(a => ({ id: a.id, value: a.value, source: 'AI' }));
}
export function gatewayURL(base) {
  const url = new URL(base.trim().replace(/\/+$/, '') + '/chat/completions');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error('Use an HTTPS gateway URL (HTTP is allowed on localhost).');
  if (url.username || url.password || url.search || url.hash) throw new Error('Enter only the gateway base URL, without credentials, query, or fragment.');
  return url.href;
}
export async function requestAI(settings, messages, { signal, maxTokens = 1800 } = {}) {
  const response = await fetch(gatewayURL(settings.baseUrl), {
    method: 'POST', signal: signal || AbortSignal.timeout(90000),
    headers: { 'Content-Type': 'application/json', ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}) },
    body: JSON.stringify({ model: settings.model, messages, max_tokens: maxTokens, stream: false })
  });
  if (!response.ok) throw new Error(`Gateway returned ${response.status}. ${response.status === 401 || response.status === 403 ? 'Check your API key and gateway access.' : 'Check the model ID and gateway availability.'}`);
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('The gateway returned no text. Use a model that supports /chat/completions.');
  return { data: parseJSON(content), usage: data.usage };
}
