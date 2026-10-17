// Pilot safety boundary: every tracker request is restricted to loopback.
// This module never imports or calls the AI queue.
import { workStore, oneAtATime } from './local-work-store.js';
import { sha256 } from './role-fit.js';
export function localTrackerOrigin(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Production uploads are disabled. Use an isolated loopback tracker origin.');
  return url.origin;
}
const terminal = new Set(['delivered', 'stopped', 'conflict', 'too_large', 'validation_error']);
export class CaptureDelivery {
  constructor({ store = workStore, fetcher = (...args) => fetch(...args), now = () => Date.now(), guard = async () => true } = {}) { Object.assign(this, { store, fetcher, now, guard }); }
  async records() { return (await this.store.list('capture-delivery:')).sort((a, b) => b.created_at.localeCompare(a.created_at)); }
  async connection() { return this.store.get('tracker-connection'); }
  async request(origin, path, credential, options = {}) {
    const allowed = localTrackerOrigin(origin);
    return this.fetcher(allowed + path, { ...options, credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { ...options.headers, Authorization: `Bearer ${credential}` } });
  }
  async verify(origin, credential) {
    if (typeof credential !== 'string' || !credential.trim()) throw new Error('Enter a separate tracker credential from My preferences → Job Hunt extension.');
    const response = await this.request(origin, '/api/v1/connection', credential);
    if (!response.ok) throw new Error(`Tracker connection returned ${response.status}. Reconnect or check access.`);
    const data = await response.json();
    if (!data.account?.id || typeof data.account.id !== 'string' || typeof data.account.email !== 'string' || data.capabilities?.capture_uploads !== true ||
      !data.capabilities.schema_versions?.includes(1) || !Number.isSafeInteger(data.limits?.max_capture_bytes) || data.limits.max_capture_bytes < 1 ||
      !Number.isSafeInteger(data.limits.max_status_ids) || data.limits.max_status_ids < 1) throw new Error('Tracker connection capability response is incompatible.');
    return data;
  }
  async connect(origin, credential) {
    origin = localTrackerOrigin(origin);
    const data = await this.verify(origin, credential), old = await this.connection();
    const connection = { origin, credential, ...data, verified_at: new Date(this.now()).toISOString(),
      expires_at: old?.credential === credential && old.origin === origin ? Math.min(old.expires_at, this.now() + 86400000) : this.now() + 86400000, verified: true };
    await this.store.set('tracker-connection', connection);
    for (const record of await this.records()) if (!terminal.has(record.state) && (record.origin !== origin || record.account_id !== data.account.id)) {
      record.state = 'paused'; record.error = 'Connected account/origin changed. This frozen delivery belongs to another account.'; await this.save(record);
    }
    return connection;
  }
  async disconnect() {
    await this.store.remove('tracker-connection');
    for (const record of await this.records()) if (!terminal.has(record.state)) { record.state = 'paused'; record.error = 'Disconnected. Reconnect the same account and origin.'; await this.save(record); }
  }
  async save(record) { await this.store.set('capture-delivery:' + record.id, record); return record; }
  async freeze(prepared, guard) {
    const c = await this.connection();
    if (!c?.verified || this.now() >= c.expires_at) throw new Error('Verify a current local tracker connection before freezing delivery.');
    localTrackerOrigin(c.origin);
    if (JSON.stringify(JSON.parse(prepared.json)) !== JSON.stringify(prepared.payload) || new TextEncoder().encode(prepared.json).byteLength !== prepared.bytes) throw new Error('Prepared request content/byte count changed. Prepare it again.');
    if (prepared.bytes > c.limits.max_capture_bytes) throw new Error('The tracker byte limit is smaller than this request. The complete capture remains local.');
    if (prepared.payload.extension_assessment && c.capabilities.extension_assessments !== true) throw new Error('This tracker does not accept extension assessments.');
    const existing = await this.store.get('capture-delivery:' + prepared.payload.capture_id);
    const hash = await sha256(prepared.json);
    if (existing) {
      if (existing.body_hash !== hash || existing.origin !== c.origin || existing.account_id !== c.account.id) throw new Error('A different request/account is already frozen under this capture UUID. Inspect the conflict; no replacement UUID was generated.');
      return existing;
    }
    return this.save({ id: prepared.payload.capture_id, origin: c.origin, account_id: c.account.id, body: prepared.json, body_hash: hash,
      guard: structuredClone(guard), state: 'frozen', created_at: new Date(this.now()).toISOString(), attempts: 0, lookups: 0, next_retry_at: null, receipt: null, error: null });
  }
  async recover() {
    return oneAtATime('job-hunt-delivery', async () => {
      for (const r of await this.records()) if (r.state === 'sending') { r.state = 'uncertain'; r.error = 'Delivery was interrupted. Check a receipt before retrying the identical body.'; await this.save(r); }
    });
  }
  delay(response, attempts) {
    const value = response?.headers?.get('Retry-After');
    const specified = value && (/^\d+$/.test(value) ? this.now() + Number(value) * 1000 : Date.parse(value));
    return Math.max(this.now() + Math.min(300000, 1000 * 2 ** attempts), Number.isFinite(specified) ? specified : 0);
  }
  receipt(record, value) {
    const payload = JSON.parse(record.body);
    if (!value || value.capture_id !== record.id) throw new Error('Unrecognized capture receipt.');
    if (payload.extension_assessment && (value.extension_assessment?.assessment_id !== payload.extension_assessment.assessment_id || !['applied', 'stored_only'].includes(value.extension_assessment.disposition))) throw new Error('Unrecognized extension assessment receipt.');
    return value;
  }
  async send(id) {
    return oneAtATime('job-hunt-delivery', async () => {
      const r = await this.store.get('capture-delivery:' + id), c = await this.connection();
      if (!r) throw new Error('Frozen delivery not found.');
      if (terminal.has(r.state)) return r;
      if (!c?.verified || this.now() >= c.expires_at || c.account.id !== r.account_id || c.origin !== r.origin) {
        r.state = 'paused'; r.error = 'Reconnect the original account and origin with a current credential.'; return this.save(r);
      }
      if (r.next_retry_at && this.now() < r.next_retry_at) return r;
      if (r.attempts >= 5) { r.state = 'paused'; r.error = 'Retry budget exhausted. Inspect the delivery; the frozen body is preserved.'; return this.save(r); }
      let valid = false;
      try { valid = await sha256(r.body) === r.body_hash && await this.guard(r); } catch { /* A deleted or invalid current capture pauses delivery. */ }
      if (!valid) { r.state = 'paused'; r.error = 'Current inputs changed or the frozen request was altered. No upload was made.'; return this.save(r); }
      try {
        const verified = await this.verify(c.origin, c.credential);
        if (verified.account.id !== r.account_id || (JSON.parse(r.body).extension_assessment && verified.capabilities.extension_assessments !== true)) {
          c.verified = false; await this.store.set('tracker-connection', c); r.state = 'paused'; r.error = 'Account or capabilities changed. Reconnect before delivery.'; return this.save(r);
        }
        if (new TextEncoder().encode(r.body).byteLength > verified.limits.max_capture_bytes) { r.state = 'too_large'; r.error = 'Tracker byte limit changed. The complete frozen capture remains local.'; return this.save(r); }
      } catch {
        c.verified = false; await this.store.set('tracker-connection', c); r.state = 'paused'; r.error = 'Connection verification failed. Reconnect or check access.'; return this.save(r);
      }
      if (r.state === 'uncertain' && r.lookups < 3) {
        r.lookups++; await this.save(r);
        try {
          const response = await this.request(r.origin, '/api/v1/captures?ids=' + encodeURIComponent(r.id), c.credential);
          if ([401, 403].includes(response.status)) { c.verified = false; await this.store.set('tracker-connection', c); r.state = 'paused'; r.error = 'Receipt lookup requires reconnect/access.'; return this.save(r); }
          if (response.status === 410) { r.state = 'stopped'; r.error = 'Tracker returned 410. Stopped; do not recreate the deleted opening.'; return this.save(r); }
          if (response.ok) {
            const data = await response.json(), receipt = data.captures?.find(v => v.capture_id === r.id);
            if (receipt) { r.receipt = this.receipt(r, receipt); r.state = 'delivered'; r.error = null; return this.save(r); }
          } else { r.error = 'Receipt lookup unavailable; retry the same frozen request later.'; r.next_retry_at = this.delay(response, r.attempts); return this.save(r); }
        } catch { r.error = 'Receipt lookup uncertain. Retry later; the body remains frozen.'; r.next_retry_at = this.delay(null, r.attempts); return this.save(r); }
      }
      r.state = 'sending'; r.attempts++; r.error = null; await this.save(r);
      let response;
      try {
        response = await this.request(r.origin, '/api/v1/captures', c.credential, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': r.id }, body: r.body });
        if (response.ok) { r.receipt = this.receipt(r, await response.json()); r.state = 'delivered'; r.error = null; return this.save(r); }
      } catch { r.state = 'uncertain'; r.error = 'Network/receipt uncertainty. A bounded receipt check precedes an identical retry.'; r.next_retry_at = this.delay(null, r.attempts); return this.save(r); }
      const status = response.status;
      if ([401, 403].includes(status)) { r.state = 'paused'; c.verified = false; await this.store.set('tracker-connection', c); }
      else if (status === 409) r.state = 'conflict';
      else if (status === 410) r.state = 'stopped';
      else if (status === 413) r.state = 'too_large';
      else if (status === 422 || status < 429) r.state = 'validation_error';
      else if ([429, 503].includes(status)) { r.state = 'retry_wait'; r.next_retry_at = this.delay(response, r.attempts); }
      else { r.state = 'uncertain'; r.next_retry_at = this.delay(response, r.attempts); }
      r.error = `Tracker returned ${status}. ${status === 410 ? 'Stopped; do not recreate the deleted opening.' : status === 409 ? 'Inspect the conflict; UUID and content were retained.' : 'The full frozen request remains local.'}`;
      if (status === 422) { try { const e = await response.json(); r.validation = e.error; } catch { /* Keep the status without raw HTML/error pages. */ } }
      return this.save(r);
    });
  }
}
