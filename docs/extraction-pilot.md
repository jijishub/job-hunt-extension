# Extraction-only pilot

Historical phase report. Current explicit gateway assessment and local tracker testing are documented in [extension role fit](extension-role-fit.md). Production delivery remains disabled; the extraction evidence below does not establish additional platform compatibility.

This records the initial extraction phase. The subsequent [offline transport pilot](offline-transport.md) supersedes the historical contract proposals below, records the final tracker v1 decisions, adds coded warnings/resolutions and local schema version 2, and still makes no uploads or automatic assessments.

This phase adds local posting capture and review. It does not implement tracker authentication, uploads, assessment requests, queues, or a shared API contract. Form filling and the tracker/Gemini workflow remain available.

## Evidence and adapter choice

Inspected on 2026-10-18. The extension's existing fixtures cover form controls, uploads and Shopee dropdowns; they do not contain representative posting descriptions. Nearby tracker tests also focus on application workflows rather than posting extraction. Those tests did not justify claiming JobStreet or Bossjob extraction support.

Two public posting detail pages were inspected in Chromium before choosing adapters:

| Sample | Observed behavior | Implementation decision |
| --- | --- | --- |
| [Anthropic / Greenhouse, opening 4461450008](https://job-boards.greenhouse.io/anthropic/jobs/4461450008) | No JobPosting JSON-LD; `.job__description` contains the posting separately from the application form. Company is available in the document title. | Greenhouse DOM adapter; keep all description sections, including requirements and logistics. Do not capture the application form. |
| [Spotify / Lever, opening 2517cbbf-5640-4467-a3ae-08577e76bead](https://jobs.lever.co/spotify/2517cbbf-5640-4467-a3ae-08577e76bead) | Both JobPosting JSON-LD and rendered posting sections; the two text versions differ. Rendered categories state Hybrid and Permanent. | Lever DOM adapter supplemented by structured facts; preserve both text versions, flag disagreement, map Hybrid, leave job type unknown because Permanent does not establish hours. |
| [Shopee application J02192749](https://careers.shopee.sg/apply?id=J02192749&application_form_id=17&is_ats=true) | Application controls and title, without the actual job description; only breadcrumb structured data. | Return no posting and direct the user to the full posting. Existing form filling still works independently. |

The Lever company results list was also inspected: it lists many openings and is not treated as one posting.

With extractor `posting-pilot-v1`, the Greenhouse sample yielded 7,740 description characters; Lever yielded 4,953 rendered and 4,500 structured text characters. The offline suite verifies that every description list item remains present, including the language and office-attendance requirements. Shopee yielded zero posting candidates. Counts describe these snapshots, not a quality score or proof of completeness. Live iframe warnings can vary with when embedded resources load.

`tests/fixtures/postings/greenhouse.html` and `lever.html` preserve the relevant public posting DOM/structured data from those observations. The snapshots remove unrelated application sections, page scripts, tracking attributes and external resources. They are real layout samples, not a representative platform corpus. Do not update them silently to make tests pass after a site change; compare new behavior and record the reason.

## Behavior

- Capture starts only from the explicit side-panel action. It reads the top-level current document and does not click, expand content, navigate or call any API.
- A capture is persisted under its own `chrome.storage.local` key before the preview opens. Captures are separate from the existing profile/resume/settings state, avoiding whole-state overwrite collisions. Local persistence does not depend on a background worker.
- Original extraction and source text remain in an immutable snapshot. Saved corrections create a separate posting object with user provenance. Corrections do not rewrite the source. Unsaved form edits survive switching panel tabs, but not closing/reloading the panel.
- Sources include adapter/extractor versions, timestamp, exact page URL (including query and fragment), selected structured posting facts, rendered and structured text, per-field origin, requisition ID where available, stated salary period, and warnings.
- Multiple candidates require explicit selection; no record is silently chosen. Changing an already selected opening now forks a new capture UUID and retains the previous capture and sources.
- Unknown fields stay null. Seniority and first response stay null. There is no pipeline status, fit rating, ownership or candidate profile in the posting object. Arbitrary JSON-LD keys are not copied into preserved structured facts. Referral/Walk-in can only be supplied as a user correction, never inferred from page content.
- Review confirmation is a user assertion, not an automated completeness score. Original extraction warnings remain visible after confirmation. Edits clear the unsaved review checkbox until the user checks again.
- Local JSON export includes source and saved corrections; it is intentionally not an upload payload. Export requires saving pending edits first. Captures can be deleted individually, or with Settings → Delete all local data.

## Quality checks and limits

The offline browser suite checks both real layout snapshots, including every description list item, role/company, Greenhouse location, Lever language fluency and office attendance, and exclusion of application fields. Generic fixtures cover JSON-LD arrays/graphs, ambiguity, malformed data, collapsed content, large text, unrelated pages and application-only pages. Unit tests cover corrections, validation, immutable source, unknown values and persistent warnings.

Installed-extension checks exercise the built script injection, local save/reopen, source preservation after edits, escaped page content, export, multiple-candidate selection, tab-change draft retention, individual deletion, full reset, and narrow-panel layout. The offline capture test blocks external requests and asserts that capture/export makes none. Existing browser/form-fill/dropdown tests remain the regression checks for application workflows.

Run:

```sh
npm run build
npm test
npm run test:capture
npm run test:browser
npm run test:fill
npm run test:dropdowns
```

Optional `npm run test:capture:live` reads the three public URLs above in Chromium, blocks POST/PUT/PATCH/DELETE requests, and prints extraction counts/warnings. Live pages may expire, change or be unavailable; this command is deliberately separate from offline regression tests. It uses no personal profile, credentials, filling or AI.

Important limitations:

- Only one detail-page sample per dedicated adapter has been evaluated. Alternate themes, employer-specific layouts, older Greenhouse markup, embedded ATS pages and localized variants remain unverified.
- JSON-LD is not proof of completeness. Conflicting text is retained for human comparison; there is no semantic reconciliation or AI interpretation.
- Requirements stay in the full description. The extractor only fills a separate qualifications list when structured data explicitly supplies text qualifications. It does not guess section boundaries or paraphrase requirements.
- Generic DOM fallback requires an identifiable description region. It does not scrape an arbitrary entire body/main section, and may reject valid unsupported postings.
- Frames and shadow roots are not traversed. Image-only requirements, unloaded content, hidden content and linked requirement documents need manual checking. The extractor never auto-expands the page.
- Source text is capped at 120,000 UTF-16 code units per extracted text value, structured-data blocks at 250,000 units, scripts at 20, candidates at 20, and traversal at 2,000 nodes / depth 12. Limit conditions generate warnings. Text means a readable paragraph/bullet representation, not a byte-for-byte HTML archive.
- Salary is normalized only from explicit numeric structured facts. Ambiguous currencies, rendered salary ranges and employment types are not guessed. The original description remains available to correct these manually.
- The local history does not deduplicate separate captures of the same opening. Each click creates a distinct pilot capture; tracker-side idempotency/deduplication is outside this phase.
- Page restriction/injection failures and storage failures are shown in the existing error notice. A failed local save does not claim capture success.

## Initial tracker contract proposals (historical)

These were the initial proposals from extraction evidence. They are retained as history; use the [final v1 decisions and current behavior](offline-transport.md#final-tracker-v1-decisions) for transport work:

1. **Capture and application are different resources.** A page can yield several candidate postings, missing identity, or incomplete requirements. Local records have `candidate_index` and may have `posting: null`. A future API must either accept unresolved capture drafts or explicitly require selection before upload; it must not fabricate an application.
2. **Keep versions of the source separate.** The Lever sample produces different structured and rendered text. One `requirements_text` plus a single method string loses that evidence. Consider separate source variants, per-field provenance, extractor/adapter versions, and machine-readable warning codes with human-readable messages.
3. **Stated salary period needs a home.** The pilot posting object has `salary_period` as supplied text, and retains the extracted source value separately. The draft API and current importer lack this field. Agree on raw period preservation and optional normalized values; do not silently map or infer periods.
4. **Review is independent of extraction warnings and assessment eligibility.** `reviewed_at` records the local user's check. It does not mean ready for AI or erase warnings. Missing job type/work model is different from missing requirements. The server should own eligibility, and API warning/blocking semantics need agreement.
5. **Posting identity needs its tenant namespace.** Greenhouse and Lever expose requisition IDs in different URL shapes. Preserve the exact page URL and requisition ID; do not use the ID alone or strip all query parameters. Canonicalization and cross-platform duplicates remain tracker decisions.
6. **Text limits must be explicit.** Captures can exceed the tracker's current 30,000-character assessment input. The future contract must distinguish capture storage limits from assessment limits and report truncation; a successful upload cannot imply the full requirements were assessed.
7. **Qualify field semantics.** `description` preserves the full posting; `qualifications` may be empty even when requirements appear in the description. Agree on composition to avoid duplicating qualifications during import. `seniority_level` and `first_response_at` remain null on capture.

The initial local export used `local_schema_version: 1`; current captures use version 2 and still have no server/upload/assessment states. Local export is not `/api/v1/captures` input. The offline serializer produces a separate allowlisted request against the updated proposal.

The tracker-side `EXTENSION-CAPTURE-CONTRACT.md` draft became available during the initial work and was read without modifying it. The table records questions raised at that time, before the later reconciliation and final v1 decisions:

| Tracker draft | Local pilot evidence / proposed follow-up |
| --- | --- |
| `salary_pay_period` is a normalized enum | Local `salary_period` preserves raw text such as `YEAR`. Agree on raw plus normalized fields and mapping; do not upload the raw string into the enum. |
| One `source.requirements_text` | Retain both structured/rendered versions and field provenance, or explicitly define how an immutable source bundle is attached. |
| Warning codes and `reviewed_by_user` | Local warnings are human-readable strings and review is `reviewed_at`. Define stable codes, resolution metadata for conflicts, and a review mapping. A checkbox alone must not resolve a source conflict. |
| `adapter_id`, `adapter_version`, `employer_key` | Map local `adapter`/`adapter_version` and URL-derived `source.employer_key`. The employer key uses host + tenant path, not a company-title guess. |
| A single `posting` per create request | Decide whether multiple unresolved candidates stay local until selection or are accepted as server capture drafts. |
| 256 KiB UTF-8 JSON limit | A local source bundle can exceed that limit, especially with two text variants. Agree on explicit rejection/source attachment behavior before uploads; never silently trim it. |
| Posting capture cannot claim Referral/Walk-in | Local corrections allow an explicit user-supplied platform/channel. Future upload must reject those values or use an agreed explicit-context mechanism. |

A subsequent offline serializer implements the updated reconciliation proposal; authentication, uploads and server processing remain outside this repository. See the [current reconciliation report](offline-transport.md).

## Next pilot measurements

The two live samples establish initial layout behavior, not extraction accuracy across the 140+ opportunity backlog. Review 20–30 actual target postings across the user's dominant platforms. Record omitted requirements, incorrect facts, correction time, fallback rate and comparison time against Gemini. Require no material requirement omissions in any future automatically assessed capture. No hands-on time saving or AI fit quality has been measured in this phase.
