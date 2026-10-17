import { serializeCapture } from './capture-transport.js';
import { assessmentFromJob, canonicalJSON, sha256 } from './role-fit.js';
export async function serializeAssessedCapture(capture, currentInputs, job) {
  const base = await serializeCapture(capture);
  if (!base.assessment.eligible || job.inputs.binding_hash !== currentInputs.binding_hash || currentInputs.review_hash !== capture.review_basis_hash ||
    currentInputs.posting_hash !== await sha256(canonicalJSON(base.payload.posting))) throw new Error('The selected assessment is stale. Review/assess the current posting and selected resume again.');
  return serializeCapture(capture, { requestAssessment: false, extensionAssessment: assessmentFromJob(job) });
}
