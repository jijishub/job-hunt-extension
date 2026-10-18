import { workStore, oneAtATime } from './local-work-store.js';
import { callRoleFit } from './role-fit.js';
export class RoleFitQueue {
  constructor({ store = workStore, resolveInputs, getSettings, call = callRoleFit } = {}) { Object.assign(this, { store, resolveInputs, getSettings, call }); }
  async jobs() { return (await this.store.list('fit-job:')).sort((a, b) => b.created_at.localeCompare(a.created_at)); }
  async enqueue(inputs) {
    const job = { id: crypto.randomUUID(), state: 'queued', created_at: new Date().toISOString(), inputs: structuredClone(inputs), result: null, error: null };
    await this.store.set('fit-job:' + job.id, job); return job;
  }
  async recover() {
    return oneAtATime('job-hunt-role-fit', async () => {
      for (const job of await this.jobs()) if (job.state === 'running') {
        job.state = 'interrupted'; job.error = 'Interrupted. Resume explicitly while the panel is open; the previous request may have reached the provider.';
        await this.store.set('fit-job:' + job.id, job);
      }
    });
  }
  async run(jobIds = null) {
    return oneAtATime('job-hunt-role-fit', async () => {
      const jobs = (await this.jobs()).reverse().filter(j => ['queued', 'interrupted'].includes(j.state) && (!jobIds || jobIds.includes(j.id)));
      for (const job of jobs) {
        if (!await this.store.get('fit-job:' + job.id)) continue;
        try {
          const current = await this.resolveInputs(job.inputs);
          if (current.binding_hash !== job.inputs.binding_hash) throw new Error('Assessment inputs changed. Request a fresh assessment.');
        } catch { job.state = 'stale'; job.error = 'Inputs or review changed. Request a fresh assessment.'; await this.store.set('fit-job:' + job.id, job); continue; }
        job.state = 'running'; job.error = null; await this.store.set('fit-job:' + job.id, job);
        try {
          const result = await this.call(job.inputs, await this.getSettings());
          let current; try { current = await this.resolveInputs(job.inputs); } catch { current = null; }
          job.result = result; job.analyzed_at = new Date().toISOString();
          job.state = current?.binding_hash === job.inputs.binding_hash ? 'succeeded' : 'stale';
          if (job.state === 'stale') job.error = 'Inputs changed during assessment. This result cannot be attached.';
        } catch (error) { job.state = 'failed'; job.error = error.name === 'AbortError' || error.name === 'TimeoutError' ? 'The provider timed out. Retry explicitly or save Unassessed.' : error.message; }
        if (await this.store.get('fit-job:' + job.id)) await this.store.set('fit-job:' + job.id, job);
      }
    });
  }
}
