export function canonicalJSON(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + Array.from(value, item => canonicalJSON(item) ?? 'null').join(',') + ']';
  return '{' + Object.keys(value).sort().filter(key => !['undefined', 'function', 'symbol'].includes(typeof value[key]))
    .map(key => JSON.stringify(key) + ':' + canonicalJSON(value[key])).join(',') + '}';
}
export async function sha256(text) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
}
