import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createCapture, correctCapture, selectCandidate, captureWarnings, captureFields } from '../src/captures.js';
import { serializeCapture } from '../src/capture-transport.js';
import { normalizeSalaryPeriod, composeRequirements, MAX_CAPTURE_BYTES } from '../src/capture-rules.js';

function fixture({ both = false, warnings = [] } = {}) {
  const description = 'Requirements\n\n- JavaScript experience and customer support skills.\n- SQL knowledge and clear written communication are required.';
  const posting = { role_title: 'Support Engineer', company_name: 'Example', description, qualifications: [], location: null,
    work_model: 'REMOTE', job_type: 'FULL_TIME', salary_min: null, salary_max: null, salary_currency: null, salary_period: null,
    job_url: 'https://jobs.lever.co/example/123?source=pilot#posting', seniority_level: null, first_response_at: null, job_platform: 'LEVER' };
  return createCapture({ captured_at: '2026-10-18T00:00:00Z', extractor_version: 'posting-pilot-v2', page_url: posting.job_url, warnings,
    candidates: [{ posting, adapter: 'lever-dom', adapter_version: '1', provenance: { description: { method: 'dom', locator: '.description' }, job_url: { method: 'browser', locator: 'location.href' } },
      source: { rendered_text: description, structured_text: both ? description + '\n\nStructured-only requirement.' : '', structured_data: null, employer_key: 'jobs.lever.co/example', requisition_id: '123' },
      warnings: both ? [{ code: 'conflicting_sources', message: 'Different original descriptions.', field: 'description', variant_ids: ['rendered', 'structured'] }] : [] }] });
}
const valuesFor = capture => Object.fromEntries(captureFields.map(([key]) => [key, Array.isArray(capture.posting[key]) ? capture.posting[key].join('\n') : capture.posting[key] ?? '']));
const reviewResolution = capture => ({ warning_id: captureWarnings(capture).find(w => w.code === 'requirements_unverified').id, action: 'verified_irrelevant', note: 'Compared the full posting and all requirements.' });
const fails = async (capture, code) => assert.rejects(() => serializeCapture(capture), error => error.code === code);

test('new adapters require an explicit current layout review even when a warning was omitted', async () => {
  for (const adapter of ['linkedin-dom', 'cgi-njoyn-dom']) {
    const capture = fixture(); capture.snapshot.candidates[0].adapter = adapter;
    const reviewed = await correctCapture(capture, valuesFor(capture), true, [reviewResolution(capture)]);
    assert.ok((await serializeCapture(reviewed)).assessment.reasons.includes('unverified_layout'));
    const original = fixture(); original.snapshot.candidates[0].adapter = adapter;
    original.snapshot.candidates[0].warnings.push({ code: 'unverified_layout', message: 'Compare this new layout with the intended job.' });
    const warning = captureWarnings(original).find(w => w.code === 'unverified_layout');
    const confirmed = await correctCapture(original, valuesFor(original), true, [reviewResolution(original), { warning_id: warning.id, action: 'verified_irrelevant', note: 'Checked job identity and all source sections against the intended posting.' }]);
    const request = await serializeCapture(confirmed);
    assert.equal(request.assessment.eligible, true);
    assert.ok(request.payload.source.warnings.some(w => w.code === 'unverified_layout'));
    assert.equal(confirmed.snapshot.candidates[0].source.rendered_text, original.snapshot.candidates[0].source.rendered_text);
  }
});

test('offline projection allowlists data, preserves both originals, and uses exact request bytes', async () => {
  const capture = fixture({ both: true });
  capture.owner = 'private'; capture.posting.owner = 'private'; capture.posting.status = 'APPLIED';
  capture.snapshot.candidates[0].source.structured_data = JSON.stringify({ title: 'Original title', company: 'Original company', description: 'Original requirements', employmentType: ['Permanent'], salary_period: 'YEAR' });
  const original = JSON.stringify(capture);
  const request = await serializeCapture(capture);
  assert.equal(JSON.stringify(capture), original);
  assert.equal(request.payload.source.variants.length, 2);
  assert.equal(request.payload.source.variants[0].text, capture.snapshot.candidates[0].source.rendered_text);
  assert.equal(request.payload.source.field_provenance.description.variant_id, 'rendered');
  assert.equal(request.payload.source.method, 'jsonld+dom');
  assert.equal(request.payload.source.structured_facts.title, 'Original title');
  assert.deepEqual(request.payload.source.structured_facts.employmentType, ['Permanent']);
  assert.doesNotMatch(request.json, /private|local_schema_version|review_basis_hash|structured_data/);
  assert.equal(request.payload.request_assessment, false);
  assert.equal(request.headers['Idempotency-Key'], capture.id);
  assert.equal(request.bytes, Buffer.byteLength(request.json, 'utf8'));
  assert.deepEqual(JSON.parse(request.json), request.payload);
  assert.ok(request.assessment.reasons.includes('conflicting_sources'));
});

test('zero/unresolved selections stay local, selection changes fork UUID and preserve prior capture', async () => {
  const original = fixture();
  const snapshot = structuredClone(original.snapshot);
  snapshot.candidates.push(structuredClone(snapshot.candidates[0]));
  snapshot.candidates[1].posting.role_title = 'Other opening';
  const unresolved = createCapture(snapshot);
  await fails(unresolved, 'SELECTION_REQUIRED');
  await fails(createCapture({ ...snapshot, candidates: [] }), 'SELECTION_REQUIRED');
  const selected = selectCandidate(unresolved, 0);
  assert.equal(selected.id, unresolved.id);
  const other = selectCandidate(selected, 1);
  assert.notEqual(other.id, selected.id);
  assert.equal(selected.posting.role_title, 'Support Engineer');
  assert.equal(other.posting.role_title, 'Other opening');
  const request = await serializeCapture(other);
  assert.equal(request.payload.source.candidate_index, 1);
  assert.equal(request.payload.capture_id, other.id);
  assert.equal(request.payload.source.candidates, undefined);
  other.posting.role_title = null; other.posting.company_name = null;
  const draft = await serializeCapture(other);
  assert.equal(draft.payload.posting.role_title, null);
  assert.ok(draft.assessment.reasons.includes('missing_company_name'));
});

test('empty original variants and invalid references fail explicitly instead of inventing source', async () => {
  const capture = fixture(); capture.snapshot.candidates[0].source.rendered_text = '';
  await fails(capture, 'SOURCE_VARIANTS_REQUIRED');
  capture.snapshot.candidates[0].source.rendered_text = 'Original text';
  capture.snapshot.candidates[0].provenance.description.variant_id = 'not-a-variant';
  await fails(capture, 'INVALID_VARIANT_REFERENCE');
});

test('whitespace-only original variants cannot be replaced by correction text', async () => {
  const capture = fixture();
  capture.snapshot.candidates[0].source.rendered_text = ' \r\n\t';
  capture.snapshot.candidates[0].source.structured_text = '\n  ';
  const before = structuredClone(capture.snapshot);
  const corrected = await correctCapture(capture, { ...valuesFor(capture), description: 'Actual corrected requirements: SQL experience and customer support.' }, false);
  await fails(corrected, 'SOURCE_VARIANTS_REQUIRED');
  assert.deepEqual(corrected.snapshot, before);
  capture.snapshot.candidates[0].source.structured_text = 'Actual original requirements';
  const result = await serializeCapture(capture);
  assert.equal(result.payload.source.variants.length, 2, 'an existing whitespace variant is preserved alongside meaningful original text');
  assert.equal(result.payload.source.variants[0].text, ' \r\n\t');
});

test('structured facts preserve the exact final v1 keys and reject unknown names', async () => {
  const capture = fixture();
  const facts = { title: 'Original title', company: null, location: 'London', salary_period: 'FORTNIGHT', description: null,
    qualifications: ['Degree or equivalent experience'], employmentType: ['Permanent', 'Unrecognized original label'],
    salary_min: 90000, salary_max: 50000, salary_currency: 'usd' };
  capture.snapshot.candidates[0].source.structured_data = JSON.stringify(facts);
  assert.deepEqual((await serializeCapture(capture)).payload.source.structured_facts, facts, 'original reversed amounts remain evidence');
  for (const key of ['owner', 'profile', 'role_title', 'company_name', 'job_type', 'job_platform', 'salary_pay_period', 'first_response_at']) {
    capture.snapshot.candidates[0].source.structured_data = { ...facts, [key]: null };
    const before = JSON.stringify(capture);
    await fails(capture, 'UNKNOWN_STRUCTURED_FACT');
    assert.equal(JSON.stringify(capture), before);
  }
});

test('structured facts enforce nullable strings, ASCII currencies and bounded string arrays', async () => {
  const capture = fixture();
  const set = facts => { capture.snapshot.candidates[0].source.structured_data = facts; };
  for (const facts of [{ title: 7 }, { company: false }, { location: [] }, { salary_period: {} }, { description: 3 },
    { salary_min: -1 }, { salary_max: Infinity }, { salary_min: NaN }, { salary_currency: '' }, { salary_currency: '$' }, { salary_currency: 'ＰＨＰ' },
    { employmentType: 'Permanent' }, { employmentType: null }, { employmentType: ['Permanent', 2] }, { qualifications: null }, { qualifications: [null] }]) {
    set(facts); await assert.rejects(() => serializeCapture(capture));
  }
  set({ title: null, company: null, location: null, salary_period: null, description: null, salary_min: null, salary_max: null, salary_currency: null, qualifications: [], employmentType: [] });
  await serializeCapture(capture);
  for (const key of ['qualifications', 'employmentType']) {
    set({ [key]: Array(200).fill('Original') }); await serializeCapture(capture);
    set({ [key]: Array(201).fill('Original') }); await fails(capture, 'INVALID_QUALIFICATIONS');
    set({ [key]: ['a'.repeat(4000)] }); await serializeCapture(capture);
    set({ [key]: ['a'.repeat(4001)] }); await fails(capture, 'FIELD_TOO_LARGE');
    set({ [key]: Array(1) }); await assert.rejects(() => serializeCapture(capture), /must be text/);
  }
  set({ description: 'a'.repeat(120000) }); await serializeCapture(capture);
  set({ description: 'a'.repeat(120001) }); await fails(capture, 'FIELD_TOO_LARGE');
});

test('raw salary periods survive; only exact aliases normalize and supplied conflicts fail', async () => {
  for (const [raw, normalized] of [['HOUR', 'HOURLY'], ['hourly', 'HOURLY'], ['Day', 'DAILY'], ['DAILY', 'DAILY'], ['WEEK', 'WEEKLY'], ['weekly', 'WEEKLY'], ['MONTH', 'MONTHLY'], ['monthly', 'MONTHLY'], [' YEAR ', 'ANNUAL'], ['yearly', 'ANNUAL'], ['ANNUAL', 'ANNUAL'], ['per year', null], ['FORTNIGHT', null], [null, null]]) {
    const capture = fixture(); capture.posting.salary_period = raw;
    const { payload } = await serializeCapture(capture);
    assert.equal(payload.posting.salary_period, raw);
    assert.equal(payload.posting.salary_pay_period, normalized);
    assert.equal(normalizeSalaryPeriod(raw), normalized);
  }
  const capture = fixture(); capture.posting.salary_period = 'YEAR'; capture.posting.salary_pay_period = 'MONTHLY';
  await fails(capture, 'SALARY_PERIOD_CONFLICT');
  capture.posting.salary_period = 'FORTNIGHT'; capture.posting.salary_pay_period = 'ANNUAL';
  await fails(capture, 'SALARY_PERIOD_CONFLICT');
});

test('review checkbox alone cannot resolve conflicts; explicit variant choice must match current description', async () => {
  const capture = fixture({ both: true });
  const reviewedOnly = await correctCapture(capture, valuesFor(capture), true, [reviewResolution(capture)]);
  assert.ok((await serializeCapture(reviewedOnly)).assessment.reasons.includes('conflicting_sources'));
  const conflict = captureWarnings(capture).find(w => w.code === 'conflicting_sources');
  const resolution = { warning_id: conflict.id, action: 'use_structured', note: 'The structured version includes the extra requirement shown by the employer.' };
  await assert.rejects(() => correctCapture(capture, valuesFor(capture), true, [resolution]), /must match/);
  const resolved = await correctCapture(capture, { ...valuesFor(capture), description: capture.snapshot.candidates[0].source.structured_text }, true, [resolution, reviewResolution(capture)]);
  const result = await serializeCapture(resolved, { requestAssessment: true });
  assert.equal(result.assessment.eligible, true);
  assert.equal(result.payload.request_assessment, true, 'offline intent does not execute an assessment');
  assert.equal(result.payload.source.warnings.find(w => w.id === conflict.id).code, 'conflicting_sources');
  assert.deepEqual(resolved.snapshot, capture.snapshot);
  const mismatch = structuredClone(resolved); mismatch.posting.description += ' later edit';
  await fails(mismatch, 'INVALID_RESOLUTION');
});

test('posting, source and resolution edits invalidate previously saved review', async () => {
  const capture = fixture();
  const reviewed = await correctCapture(capture, valuesFor(capture), true, [reviewResolution(capture)]);
  assert.equal((await serializeCapture(reviewed)).assessment.eligible, true);
  for (const mutate of [c => { c.posting.location = 'London'; }, c => { c.snapshot.candidates[0].source.rendered_text += ' changed'; }, c => { c.resolutions[0].note += ' changed'; }]) {
    const changed = structuredClone(reviewed); mutate(changed); await fails(changed, 'STALE_REVIEW');
  }
  const corrected = await correctCapture(reviewed, { ...valuesFor(reviewed), location: 'London' }, false);
  assert.equal(corrected.reviewed_at, null); assert.deepEqual(corrected.resolutions, []);
  assert.ok((await serializeCapture(corrected)).assessment.reasons.includes('pilot_review_required'));
});

test('source selection preserves exact whitespace and unchanged multiline qualification items', async () => {
  const capture = fixture({ both: true });
  capture.snapshot.candidates[0].source.structured_text = '  Original requirements\n\nSQL skills and support experience are required.\n';
  capture.posting.qualifications = ['A degree\nor equivalent experience'];
  capture.snapshot.candidates[0].posting.qualifications = [...capture.posting.qualifications];
  const conflict = captureWarnings(capture).find(w => w.code === 'conflicting_sources');
  const resolved = await correctCapture(capture, { ...valuesFor(capture), description: capture.snapshot.candidates[0].source.structured_text }, true,
    [{ warning_id: conflict.id, action: 'use_structured', note: 'Selected the original structured text.' }, reviewResolution(capture)]);
  const result = await serializeCapture(resolved);
  assert.equal(result.payload.posting.description, capture.snapshot.candidates[0].source.structured_text);
  assert.deepEqual(result.payload.posting.qualifications, ['A degree\nor equivalent experience']);
});

test('legacy prose stays unclassified with stable distinct IDs and cannot silently qualify', async () => {
  const capture = fixture({ warnings: ['Work model is unknown', 'Work model is unknown'] });
  const warnings = captureWarnings(capture).filter(w => w.code === 'unclassified_warning');
  assert.equal(warnings.length, 2); assert.notEqual(warnings[0].id, warnings[1].id);
  const reviewed = await correctCapture(capture, valuesFor(capture), true, [reviewResolution(capture)]);
  const result = await serializeCapture(reviewed);
  assert.equal(result.assessment.eligible, false);
  assert.ok(result.assessment.reasons.includes('unclassified_warning'));
  assert.deepEqual(captureWarnings(reviewed).filter(w => w.code === 'unclassified_warning'), warnings);
});

test('supplying draft identity removes current blockers while retaining original warnings', async () => {
  const capture = fixture();
  for (const p of [capture.snapshot.candidates[0].posting, capture.posting]) { p.company_name = null; p.role_title = null; }
  const draft = await serializeCapture(capture);
  assert.ok(draft.assessment.reasons.includes('missing_role_title'));
  assert.ok(draft.assessment.reasons.includes('missing_company_name'));
  const corrected = await correctCapture(capture, { ...valuesFor(capture), company_name: 'Verified employer', role_title: 'Verified role' }, true, [reviewResolution(capture)]);
  const result = await serializeCapture(corrected);
  assert.equal(result.assessment.eligible, true);
  assert.ok(result.payload.source.warnings.some(w => w.code === 'missing_company_name'));
  assert.ok(result.payload.source.warnings.some(w => w.code === 'missing_role_title'));
});

test('current invalid salaries reject transport regardless of review intent', async () => {
  for (const patch of [{ salary_min: 20, salary_max: 10 }, { salary_min: -1 }, { salary_max: Infinity }, { salary_min: '100' }, { salary_currency: '' }, { salary_currency: 'US$' }]) {
    const capture = fixture(); Object.assign(capture.posting, patch);
    await assert.rejects(() => serializeCapture(capture), e => ['INVALID_SALARY', 'INVALID_CURRENCY'].includes(e.code));
  }
});

test('historical invalid ranges require salary correction metadata, corrected resolution and fresh review', async () => {
  const capture = fixture();
  for (const p of [capture.snapshot.candidates[0].posting, capture.posting]) Object.assign(p, { salary_min: 90000, salary_max: 50000 });
  capture.snapshot.candidates[0].source.structured_data = JSON.stringify({ salary_min: 90000, salary_max: 50000, salary_currency: 'USD' });
  const original = structuredClone(capture.snapshot);
  const warning = captureWarnings(capture).find(w => w.code === 'invalid_salary_range');
  const resolution = { warning_id: warning.id, action: 'corrected', note: 'Checked the employer range and corrected the maximum.' };
  const values = { ...valuesFor(capture), salary_max: '100000' };
  const withoutResolution = await correctCapture(capture, values, true, [reviewResolution(capture)]);
  await fails(withoutResolution, 'HISTORICAL_SALARY_REVIEW_REQUIRED');
  const withoutReview = await correctCapture(capture, values, false, [resolution, reviewResolution(capture)]);
  await fails(withoutReview, 'HISTORICAL_SALARY_REVIEW_REQUIRED');
  const withoutMetadata = await correctCapture(capture, values, true, [resolution, reviewResolution(capture)]);
  delete withoutMetadata.corrections.salary_max;
  await fails(withoutMetadata, 'INVALID_RESOLUTION');
  await assert.rejects(() => correctCapture(capture, values, true, [{ ...resolution, action: 'verified_irrelevant' }]), /Unsupported/);
  const corrected = await correctCapture(capture, values, true, [resolution, reviewResolution(capture)]);
  const result = await serializeCapture(corrected);
  assert.equal(result.assessment.eligible, true);
  assert.equal(result.payload.posting.salary_max, 100000);
  assert.equal(result.payload.source.structured_facts.salary_max, 50000);
  assert.ok(result.payload.source.warnings.some(w => w.code === 'invalid_salary_range'));
  assert.deepEqual(corrected.snapshot, original);
  const stale = structuredClone(corrected); stale.posting.location = 'Changed after review'; await fails(stale, 'STALE_REVIEW');
  for (const patch of [{ salary_min: '', salary_max: '' }, { salary_max: '' }, { salary_min: '' }]) {
    const cleared = await correctCapture(capture, { ...valuesFor(capture), ...patch }, true, [{ ...resolution, note: 'The amounts could not be verified; explicitly cleared to unknown.' }, reviewResolution(capture)]);
    const prepared = await serializeCapture(cleared);
    assert.equal(prepared.assessment.eligible, true);
    assert.equal(prepared.payload.posting[Object.keys(patch)[0]], null);
    assert.deepEqual(cleared.snapshot, original);
  }
});

test('CRLF fixture recognizes all bullet markers and preserves original line endings exactly', async () => {
  const crlf = JSON.parse(await readFile(new URL('./fixtures/postings/requirements-crlf.json', import.meta.url), 'utf8'));
  const composed = composeRequirements(crlf);
  assert.equal(composed, crlf.description + crlf.appended_text);
  assert.ok(composed.startsWith(crlf.description));
  const capture = fixture(); capture.posting.description = crlf.description; capture.posting.qualifications = crlf.qualifications;
  const request = await serializeCapture(capture);
  assert.equal(request.payload.posting.description, crlf.description);
  assert.equal(request.assessment.requirements_units, composed.length);
});

test('missing or oversized requirements cannot be waived by acknowledgement', async () => {
  const missing = fixture(); missing.posting.description = ''; missing.snapshot.candidates[0].posting.description = '';
  const warning = captureWarnings(missing).find(w => w.code === 'missing_requirements');
  await assert.rejects(() => correctCapture(missing, valuesFor(missing), true, [{ warning_id: warning.id, action: 'verified_irrelevant', note: 'Ignore it' }]), /Unsupported|must be supplied/);
  const oversized = fixture(); oversized.posting.description = 'Experience '.repeat(3001);
  const tooLong = captureWarnings(oversized).find(w => w.code === 'oversized_requirements');
  await assert.rejects(() => correctCapture(oversized, valuesFor(oversized), true, [{ warning_id: tooLong.id, action: 'verified_irrelevant', note: 'Ignore it' }]), /Oversized|Unsupported/);
  const supplied = await correctCapture(missing, { ...valuesFor(missing), description: fixture().posting.description }, true,
    [{ warning_id: warning.id, action: 'corrected', note: 'Copied the full requirements from the posting.' }, reviewResolution(missing)]);
  assert.equal((await serializeCapture(supplied)).assessment.eligible, true);
  const blankQualifications = fixture(); blankQualifications.posting.description = ''; blankQualifications.posting.qualifications = ['   '];
  assert.ok((await serializeCapture(blankQualifications)).assessment.reasons.includes('missing_requirements'));
});

test('user channels require saved user provenance and never become posting-derived platform facts', async () => {
  for (const [channel, expected] of [['Referral', 'Referral'], ['Walk-in', 'Walk-in']]) {
    const capture = fixture();
    const corrected = await correctCapture(capture, { ...valuesFor(capture), job_platform: channel }, false);
    const result = await serializeCapture(corrected);
    assert.equal(result.payload.posting.job_platform, 'LEVER');
    assert.equal(result.payload.user_context.application_channel, expected);
    assert.equal(result.payload.user_context.supplied_at, corrected.corrections.job_platform.updated_at);
    assert.equal(corrected.posting.job_platform, channel);
  }
  const unsaved = fixture(); unsaved.posting.job_platform = 'Referral'; await fails(unsaved, 'UNSAVED_USER_CHANNEL');
  const pageSupplied = fixture(); pageSupplied.snapshot.candidates[0].posting.job_platform = 'Walk-in'; await fails(pageSupplied, 'PAGE_SUPPLIED_CHANNEL');
  const unknown = fixture(); unknown.snapshot.page_url = 'https://unknown.example/jobs/1';
  const corrected = await correctCapture(unknown, { ...valuesFor(unknown), job_platform: 'Referral' }, false);
  assert.equal((await serializeCapture(corrected)).payload.posting.job_platform, null);
});

test('requirements composition deduplicates only whole normalized paragraphs/list items', async () => {
  const posting = { description: 'Requirements\n\nJavaScript experience\n\n- SQL\n- Advanced SQL required', qualifications: [' JavaScript   experience ', 'SQL', 'Advanced SQL', 'New requirement'] };
  assert.equal(composeRequirements(posting), posting.description + '\n\nQualifications:\n- Advanced SQL\n- New requirement');
  assert.equal(composeRequirements({ description: '- Long requirement\n  continued on another line\n- SQL', qualifications: ['Long requirement continued on another line'] }), '- Long requirement\n  continued on another line\n- SQL');
  const capture = fixture(); capture.posting.description = '😀'.repeat(15000);
  assert.equal((await serializeCapture(capture)).assessment.requirements_units, 30000);
  capture.posting.qualifications = ['extra'];
  const result = await serializeCapture(capture);
  assert.ok(result.assessment.requirements_units > 30000);
  assert.ok(result.assessment.reasons.includes('oversized_requirements'));
});

test('UTF-8 payload limit accepts exactly 262144 bytes and rejects multibyte overflow without changing local capture', async () => {
  const capture = fixture(); capture.posting.description = 'x'.repeat(120000); capture.snapshot.candidates[0].source.rendered_text = 'x'.repeat(120000);
  const base = await serializeCapture(capture);
  capture.posting.role_title += 'a'.repeat(MAX_CAPTURE_BYTES - base.bytes);
  const exact = await serializeCapture(capture);
  assert.equal(exact.bytes, MAX_CAPTURE_BYTES);
  capture.posting.role_title += '界';
  const before = JSON.stringify(capture);
  await assert.rejects(() => serializeCapture(capture), e => e.code === 'CAPTURE_TOO_LARGE' && e.actual_bytes === MAX_CAPTURE_BYTES + 3 && e.max_bytes === MAX_CAPTURE_BYTES);
  assert.equal(JSON.stringify(capture), before);
  capture.posting.role_title = 'Engineer'; capture.posting.description = '界'.repeat(60000); capture.snapshot.candidates[0].source.rendered_text = '界'.repeat(60000);
  await fails(capture, 'CAPTURE_TOO_LARGE');
});

test('variant, description and qualification limits are independent of request byte limit', async () => {
  const capture = fixture(); capture.posting.description = 'a'.repeat(120000);
  await serializeCapture(capture);
  capture.posting.description += 'a'; await fails(capture, 'FIELD_TOO_LARGE');
  capture.posting.description = fixture().posting.description;
  capture.snapshot.candidates[0].source.rendered_text = 'a'.repeat(120001); await fails(capture, 'FIELD_TOO_LARGE');
  capture.snapshot.candidates[0].source.rendered_text = 'Original';
  capture.posting.qualifications = Array(200).fill('Requirement'); await serializeCapture(capture);
  capture.posting.qualifications.push('extra'); await fails(capture, 'INVALID_QUALIFICATIONS');
  capture.posting.qualifications = ['x'.repeat(4000)]; await serializeCapture(capture);
  capture.posting.qualifications[0] += 'x'; await fails(capture, 'FIELD_TOO_LARGE');
});

test('warning/resolution counts, code, locator, message and note limits reject explicitly', async () => {
  const capture = fixture({ warnings: Array.from({ length: 99 }, (_, i) => ({ code: 'unverified_layout', message: `Review ${i}` })) });
  const warnings = captureWarnings(capture);
  assert.equal(warnings.length, 100);
  const resolutions = warnings.map(w => ({ warning_id: w.id, action: 'verified_irrelevant', note: 'Compared with full source.' }));
  const reviewed = await correctCapture(capture, valuesFor(capture), true, resolutions);
  await serializeCapture(reviewed);
  const extra = structuredClone(capture); extra.snapshot.warnings.push({ code: 'unverified_layout', message: 'Extra' }); await fails(extra, 'TOO_MANY_ENTRIES');
  const manyResolutions = fixture(); manyResolutions.resolutions = Array(101).fill(resolutions[0]); await fails(manyResolutions, 'TOO_MANY_ENTRIES');
  for (const [field, limit] of [['message', 2000], ['code', 100]]) {
    const c = fixture({ warnings: [{ code: 'unverified_layout', message: 'Review', [field]: 'a'.repeat(limit) }] }); await serializeCapture(c);
    c.snapshot.warnings[0][field] += 'a'; await fails(c, 'FIELD_TOO_LARGE');
  }
  const c = fixture(); c.snapshot.candidates[0].provenance.description.locator = 'a'.repeat(2000); await serializeCapture(c);
  c.snapshot.candidates[0].provenance.description.locator += 'a'; await fails(c, 'FIELD_TOO_LARGE');
  const longNote = fixture(); const resolution = { ...reviewResolution(longNote), note: 'a'.repeat(2000) };
  await serializeCapture(await correctCapture(longNote, valuesFor(longNote), true, [resolution]));
  resolution.note += 'a'; await fails(await correctCapture(longNote, valuesFor(longNote), true, [resolution]), 'FIELD_TOO_LARGE');
});
