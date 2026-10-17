export const defaults = {
  resumes: [null, null, null], selected: 0, profile: {},
  settings: { baseUrl: 'https://api.jizellecasia.site/v1', model: 'luna', apiKey: '', speed: 'instant', overwrite: false },
  cache: {}
};
export const profileFields = [
  ['firstName', 'First name'], ['lastName', 'Last name'], ['email', 'Email'],
  ['phone', 'Phone'], ['addressLine1', 'Address line 1 (street / house number)'],
  ['addressLine2', 'Address line 2 (apartment / unit, optional)'],
  ['city', 'City'], ['state', 'State / province / region'], ['postalCode', 'Postal / ZIP code'], ['country', 'Country'],
  ['linkedin', 'LinkedIn URL'], ['website', 'Portfolio / website'],
  ['currentSalary', 'Current salary (optional · include currency / period)'],
  ['salary', 'Expected salary (include currency / period)'], ['notice', 'Notice period / availability']
];
export function normalize(value) { return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
export function isOtherPersonField(field) {
  const identity = normalize(`${field.label || ''} ${field.name || ''} ${field.context?.heading || ''}`.replace(/([a-z])([A-Z])/g, '$1 $2'));
  return /\b(employers?|company|references?|referees?|supervisors?|manager|emergency contacts?|schools?|university|institution)\b/.test(identity);
}
export function aiFieldData(field) {
  return { id: field.key || field.id, label: field.label, name: field.name, context: field.context,
    type: field.type, options: field.options, optionsIncomplete: field.optionsIncomplete, multiple: field.multiple,
    currentValue: field.value, maxLength: field.maxLength, minLength: field.minLength, min: field.min, max: field.max, pattern: field.pattern };
}
export function answerCacheIdentity(field, page, profile, resume, settings) {
  // Versioned so older, label-only cache entries can never be reused.
  const frame = page.frames?.find(frame => frame.frameId === field.frameId);
  return JSON.stringify(['context-v2', page.url, frame?.url, frame?.title, aiFieldData(field), profile, resume, settings.baseUrl, settings.model]);
}
export function localAnswer(field, profile) {
  const text = normalize(`${field.label} ${field.autocomplete || ''} ${field.name || ''}`);
  if (['file', 'checkbox', 'radio'].includes(field.type)) return '';
  if (isOtherPersonField(field)) return '';
  const addressTokens = { 'address-line1': 'addressLine1', 'address-line2': 'addressLine2', 'address-level2': 'city', 'address-level1': 'state', 'postal-code': 'postalCode', 'country-name': 'country', country: 'country' };
  const autocomplete = String(field.autocomplete || '').split(/\s+/);
  const addressToken = autocomplete.find(token => addressTokens[token] || token === 'street-address');
  if (addressToken === 'street-address') return profile.addressLine1 ? [profile.addressLine1, profile.addressLine2].filter(Boolean).join('\n') : '';
  if (addressToken) return profile[addressTokens[addressToken]] || '';
  const addressAliases = [
    ['addressLine2', /^(?:address line 2|address line2|address 2|addressline2|street address 2|street line 2|apartment|unit|suite|apartment unit|apartment suite unit)(?: optional)?$/],
    ['addressLine1', /^(?:address line 1|address line1|address 1|addressline1|street address|street address 1|street line 1|address|house number and street)$/],
    ['state', /^(?:state|province|region|state province|state province region|province region)$/],
    ['postalCode', /^(?:postal code|postalcode|postcode|post code|zip|zip code|zipcode|postal zip code|zip postal code)$/]
  ];
  for (const candidate of [field.label, field.name]) {
    const addressLabel = normalize(String(candidate || '').replace(/([a-z])([A-Z])/g, '$1 $2')).replace(/^(?:your|home|residential|mailing|current) /, '').replace(/ (?:required|optional)$/, '');
    if (/^(?:full|complete) (?:home |residential |mailing )?address$/.test(addressLabel)) return profile.addressLine1 ? [profile.addressLine1, profile.addressLine2, profile.city, profile.state, profile.postalCode, profile.country].filter(Boolean).join(', ') : '';
    const match = addressAliases.find(([, pattern]) => pattern.test(addressLabel));
    if (match) return profile[match[0]] || '';
  }
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
