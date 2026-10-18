import { workStore } from './local-work-store.js';
import { trackerOrigin } from './capture-delivery.js';
import { canonicalJSON, sha256, validateFitPreferences } from './role-fit.js';

const KEY = 'tracker-preferences';
const same = (a,b) => a && b && a.origin === b.origin && a.account.id === b.account.id && a.credential === b.credential;
const scope = c => ({ origin:c.origin, account_id:c.account.id });
export function effectivePreferences(snapshot, local) {
  if (!snapshot) return local || null;
  return { ...snapshot.assessment_preferences, ...(local?.notes?.trim() ? { additional_notes:local.notes } : {}) };
}
export class TrackerPreferences {
  active = false; controller = null; connection = null; status = 'off'; error = ''; retryTimer = null; applyQueue = Promise.resolve();
  constructor({ delivery, onStatus = () => {} }) { this.delivery = delivery; this.onStatus = onStatus; }
  state(status, error = '') { this.status = status; this.error = error; this.onStatus(); }
  async authorized(c) {
    const current = await this.delivery.connection();
    if (!same(c,current) || !current.verified || Date.now() >= current.expires_at || current.capabilities.preferences !== true) throw new Error('Reconnect Job Hunt with preference sharing enabled.');
  }
  async cached(c) {
    const snapshot = await workStore.get(KEY);
    return c?.verified && c.capabilities.preferences === true && Date.now() < c.expires_at && snapshot?.origin === c.origin && snapshot?.account_id === c.account.id ? snapshot : null;
  }
  async accept(raw,c) {
    const work = async () => {
      await this.authorized(c);
      if (!raw || raw.schema_version !== 1 || raw.account?.id !== c.account.id || !/^[a-f0-9]{64}$/.test(raw.revision) || !/^[a-f0-9]{64}$/.test(raw.preferences_hash)) throw new Error('Invalid Job Hunt preference snapshot.');
      validateFitPreferences(raw.assessment_preferences, true);
      if (await sha256(canonicalJSON(raw.assessment_preferences)) !== raw.preferences_hash) throw new Error('Job Hunt preference hash does not match its snapshot.');
      const previous = await this.cached(c);
      await this.authorized(c);
      if (previous?.revision === raw.revision && previous.preferences_hash === raw.preferences_hash) return previous;
      const snapshot = { ...scope(c), revision:raw.revision, preferences_hash:raw.preferences_hash, assessment_preferences:raw.assessment_preferences, received_at:new Date().toISOString() };
      await workStore.set(KEY,snapshot);
      if (previous?.preferences_hash !== snapshot.preferences_hash) {
        const local = await workStore.get('fit-preferences'), hash = await sha256(canonicalJSON(effectivePreferences(snapshot,local)));
        const matches = i => i?.preference_source?.origin === c.origin && i.preference_source.account_id === c.account.id;
        for (const j of await workStore.list('fit-job:')) if ((!j.inputs.preference_source || matches(j.inputs)) && ['queued','running','succeeded'].includes(j.state) && (j.inputs.preferences_hash !== hash || !matches(j.inputs))) {
          j.state='stale';j.error='Job Hunt preferences changed. Assess again when ready.';await workStore.set('fit-job:'+j.id,j);
        }
        for (const r of await this.delivery.records()) if (r.origin === c.origin && r.account_id === c.account.id && !['delivered','stopped','conflict','too_large','validation_error'].includes(r.state) && r.guard.inputs && (r.guard.inputs.preferences_hash !== hash || !matches(r.guard.inputs))) {
          r.receipt_check_required ||= ['sending','uncertain'].includes(r.state);
          r.state='paused';r.error='Job Hunt preferences changed. This request stays frozen. Recapture and reassess before preparing a new delivery.';await this.delivery.save(r);
        }
      }
      return snapshot;
    };
    const result = this.applyQueue.catch(()=>{}).then(work);this.applyQueue = result;return result;
  }
  async fresh(c) {
    await this.authorized(c);
    const response = await this.delivery.request(c.origin,'/api/v1/preferences',c.credential);
    if (!response.ok) throw new Error([401,403].includes(response.status) ? 'Create a new Job Hunt credential with Share saved preferences and live updates checked.' : `Job Hunt preferences unavailable (${response.status}). Try again before assessing.`);
    if(!response.headers.get('Content-Type')?.includes('application/json'))throw new Error('Job Hunt did not return the preference snapshot API. Reconnect after the tracker deployment is available.');
    const text = await response.text();
    if (text.length > 1048576) throw new Error('Job Hunt preference snapshot is too large.');
    return this.accept(JSON.parse(text),c);
  }
  stop() { this.active=false;this.controller?.abort();this.controller=null;clearTimeout(this.retryTimer);this.retryTimer=null;this.connection=null;this.state('off'); }
  setActive(active,c) {
    if (!active || !c?.verified || Date.now() >= c.expires_at || c.capabilities.preference_events !== true || c.capabilities.preferences !== true) { if(this.active)this.stop();return; }
    if (this.active && same(this.connection,c)) return;
    this.stop();this.active=true;this.connection=c;const controller=new AbortController();this.controller=controller;
    const run = async lock => {
      if (!lock || !this.active || controller.signal.aborted) {
        if(this.active && !controller.signal.aborted){this.state('shared');this.retryTimer=setTimeout(()=>{if(this.controller===controller){this.active=false;this.setActive(true,c)}},5000)}return;
      }
      await this.listen(c,controller.signal);
    };
    // One active stream for all extension panels; other panels receive storage updates.
    const work = globalThis.navigator?.locks ? navigator.locks.request('job-hunt-preference-stream',{ifAvailable:true},run) : run(true);
    work.catch(e=>{if(!controller.signal.aborted)this.state('error',e.message)});
  }
  async listen(c,signal) {
    let failures=0;
    while(!signal.aborted) {
      if(Date.now() >= c.expires_at){this.state('reconnect','The Job Hunt credential expired. Create a new credential.');return;}
      let retry=2000, idleTimer, reader;
      const operation=new AbortController(), abort=()=>operation.abort();signal.addEventListener('abort',abort,{once:true});
      const idle=()=>{clearTimeout(idleTimer);idleTimer=setTimeout(()=>operation.abort(),65000)};
      try {
        await this.authorized(c);this.state(failures?'reconnecting':'connecting');idle();
        const response=await fetch(trackerOrigin(c.origin)+'/api/v1/preferences/events',{headers:{Authorization:'Bearer '+c.credential,Accept:'text/event-stream'},credentials:'omit',redirect:'error',cache:'no-store',signal:operation.signal});
        if([401,403].includes(response.status)){this.state('reconnect','Create a new credential with preference sharing enabled.');return;}
        if(!response.ok || !response.headers.get('Content-Type')?.includes('text/event-stream') || !response.body)throw new Error('Live preference updates are unavailable.');
        reader=response.body.getReader();const decoder=new TextDecoder();let buffer='';let received=false;
        while(!signal.aborted) {
          const {value,done}=await reader.read();if(done)break;idle();buffer+=decoder.decode(value,{stream:true});
          if(buffer.length>1048576)throw new Error('Preference event exceeded its size limit.');
          let separator;
          while((separator=/\r\n\r\n|\n\n|\r\r/.exec(buffer))) {
            const frame=buffer.slice(0,separator.index);buffer=buffer.slice(separator.index+separator[0].length);
            let event='message';const data=[];
            for(const line of frame.split(/\r\n|\n|\r/)) {
              if(line.startsWith('event:'))event=line.slice(6).trim();
              else if(line.startsWith('data:'))data.push(line.slice(5).replace(/^ /,''));
              else if(/^retry: \d+$/.test(line))retry=Math.max(1000,Math.min(60000,Number(line.slice(6))));
            }
            if(!data.length)continue;
            const payload=JSON.parse(data.join('\n'));
            if(['preferences.snapshot','preferences.changed'].includes(event)){await this.accept(payload,c);received=true;failures=0;this.state('live');}
            else if(event==='stream.error'){if(payload.retryable===false){this.state('reconnect','Preference access expired or was revoked. Reconnect Job Hunt.');return;}throw new Error('Preference stream interrupted.');}
            else if(event==='reconnect' && Number.isFinite(payload.retry_ms))retry=Math.max(1000,Math.min(60000,payload.retry_ms));
          }
        }
        if(!received)throw new Error('The preference stream ended before a snapshot arrived.');
      } catch(e) {
        if(signal.aborted)return;
        failures++;retry=Math.min(60000,2000*2**Math.min(failures,5));this.state('reconnecting',e.message);
      } finally {clearTimeout(idleTimer);signal.removeEventListener('abort',abort);await reader?.cancel().catch(()=>{});operation.abort();}
      if(!signal.aborted)await new Promise(resolve=>{const done=()=>{clearTimeout(timer);signal.removeEventListener('abort',done);resolve()},timer=setTimeout(done,retry+Math.random()*500);signal.addEventListener('abort',done,{once:true});if(signal.aborted)done()});
    }
  }
}
