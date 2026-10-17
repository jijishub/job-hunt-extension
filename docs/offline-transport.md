# Offline capture transport pilot

This records the completed offline phase. The subsequent [extension role-fit phase](extension-role-fit.md) adds explicit gateway assessments and loopback-only authenticated delivery testing. Production uploads remain disabled. The source, correction and serializer rules below still apply; statements about missing authentication/delivery or untested server interoperability describe the earlier phase.

Implemented against the tracker proposal's **Pilot reconciliation — tracker-side decisions**, read on 2026-10-18, plus the user's final tracker v1 decisions. The supplied attachment and local `../job-hunt/EXTENSION-CAPTURE-CONTRACT.md` matched after newline normalization at the initial review; the final decisions below resolve the questions raised then. No tracker files, network uploads, authentication, outbox delivery or automatic assessments were added.

## Using it

Capture and correct a posting in **Capture**. Resolve review warnings with a decision and explanation, check the review box, and save. For a description conflict, **Use original rendered description** or **Use original structured description** copies that exact original text into the corrected description. Both original variants remain unchanged. **Corrected** requires an actual saved correction to the affected field/content; **Verified irrelevant** requires an explanation and cannot waive missing or oversized requirements.

Click **Prepare offline request** to build and validate a separate proposed API body. It shows the compact serialized UTF-8 byte count and advisory assessment blockers. **Download offline request JSON** downloads those exact measured bytes. The UI always sets `request_assessment: false`; the pure serializer also accepts an explicit boolean option for offline contract tests, without executing anything.

Existing **Export local pilot JSON** remains available independently. It includes the complete local snapshot, all candidates, corrections, resolutions and local review bindings. Transport omits unrelated candidates, internal bindings and local schema metadata. A transport failure never shortens, deletes, migrates or overwrites the local capture. Save pending edits before either export/preparation action.

## Implemented decisions

- `serializeCapture` in `src/capture-transport.js` projects an allowlisted version 1 request and returns its payload, compact JSON, byte count, non-secret create headers and advisory diagnostics. It has no fetch or storage dependency. The server must independently validate the payload and determine review/evidence/assessment eligibility.
- Zero-candidate, unresolved selection and `posting: null` captures cannot be serialized. Missing title/company are allowed for a selected draft but remain current application/assessment blockers.
- Initial selection of an unresolved capture retains its UUID. Changing an already selected candidate creates a new UUID and local capture; the old capture is retained. No PATCH serializer is implemented.
- Rendered and structured text map to distinct immutable `source.variants`. At least one original variant must contain non-whitespace text; corrected text cannot manufacture a missing original source. An existing whitespace-only second variant is preserved alongside a meaningful one. Extracted provenance and user corrections remain separate. Provenance variant references must exist. Original snapshots are not migrated or rewritten.
- Salary raw text maps directly to `salary_period`. `salary_pay_period` derives only from the exact, trimmed, case-insensitive aliases listed in the tracker proposal. Unsupported units remain raw with normalized null; conflicting supplied values are rejected. There is no salary conversion or currency inference.
- Saved Referral/Walk-in corrections become `user_context` with their correction timestamp. The transport platform comes from the captured page URL or null. Page-supplied channels and unsaved channel changes are rejected. The local corrected platform value is preserved in local export.
- New extraction warnings have stable codes assigned at detection sites. The capture projection assigns distinct stable IDs using immutable page/candidate scope and position, plus fixed quality-check IDs. Original warnings remain after review. Legacy strings are never interpreted by matching their prose: they remain `unclassified_warning` and block advisory eligibility until specifically resolved and reviewed.
- Resolutions reference warning IDs and require notes. Only description conflicts offer source-variant choice; other warnings use correction or explained irrelevance as appropriate. Selecting a source requires the corrected description to equal its original variant exactly.
- Review and resolution integrity use local SHA-256 bindings to the selected posting, capture identity, source bundle, provenance and correction metadata. The review binding also covers resolution decisions. Edits invalidate these assertions; stale/tampered assertions are rejected by serialization. This does not replace the server's authenticated review binding.
- Editing facts in the UI clears all resolution decisions and the review checkbox; editing a resolution clears review. Prepared requests are removed on edits. Legacy reviewed captures require a fresh review because they have no integrity binding.
- Invalid current salaries reject transport. A historical `invalid_salary_range` requires valid corrected amounts, user correction metadata for `salary_min` or `salary_max`, a `corrected` resolution and fresh content-bound review before transport preparation. Explicitly clearing one or both amounts to unknown is allowed. Original amounts and warnings remain preserved.

## Limits and composition

The serializer checks the actual compact request using `TextEncoder`. Exactly **262,144 UTF-8 bytes** is allowed; anything larger throws `CAPTURE_TOO_LARGE`, including `actual_bytes` and `max_bytes`. No text or source variant is dropped to fit. Repeating preparation is a manual action; no retry process exists.

The following are separate UTF-16 limits: each variant and corrected description 120,000 units; qualifications 200 items of 4,000 units; warnings/resolutions 100 each; locators/messages/notes 2,000 units; IDs/codes 100 units. Violations fail explicitly. Two variants are the maximum because only the defined `rendered` and `structured` local sources are projected.

Assessment composition preserves the description. It appends qualifications unless whitespace-normalized text equals an original paragraph or list item. It never deduplicates by substring or meaning. Paragraph boundaries are blank lines; list markers are `-`, `*`, `•`, or a numeric marker ending in `.`/`)`; following nonblank unmarked lines continue that item. Marker detection removes a trailing `\r` only for matching, so CRLF bullets are recognized without changing the original description or its line endings. Empty qualification items contribute no assessment text, but remain in transport storage. Duplicate qualification items that do not match the original description are preserved. Appended text uses `\n`; the original description stays byte-for-byte the same string. Final composed length is measured in UTF-16 units and is flagged above 30,000; it is never sliced.

Empty requirements remain a hard blocker. Short nonempty requirements retain a `requirements_unverified` review warning; the client does not demand invented filler to reach an arbitrary minimum. Supplying previously missing company/title removes that current blocker while retaining original missing-field warnings as evidence.

## Tests

`npm test` covers selection identity, selected drafts, strict original-fact keys/types/limits, source immutability, whitespace-only source rejection, one/two variants, invalid references, raw/normalized salary aliases, historical salary correction/clearing/review, current invalid salaries, explicit conflict decisions, stale review after posting/source/resolution edits, legacy prose, user-channel provenance, CRLF qualification composition, UTF-16 assessment length and UTF-8 request boundaries. The exact byte boundary and a three-byte overflow are tested independently of character limits, as are message/code/locator/note and warning/resolution/qualification limits. The CRLF regression input is `tests/fixtures/postings/requirements-crlf.json`.

`npm run test:capture` exercises built-extension capture, coded warning detection, explicit source decisions, checkbox-only blocking, review invalidation, proposed JSON download, source preservation, multibyte overflow with full local export, candidate identity forks, deletion/reset, narrow-panel JSON wrapping and zero external requests. It uses the existing saved Greenhouse/Lever samples and synthetic cases; it makes no claims about new live platform compatibility.

Build and regression commands:

```sh
npm run build
npm test
npm run test:capture
npm run test:browser
npm run test:fill
npm run test:dropdowns
```

## Final tracker v1 decisions

The five initial contract questions are resolved in the implemented offline scope:

| Initial question | Final decision |
| --- | --- |
| Original fact schema | Accept only the optional keys/types below. Preserve original names and unsupported employment labels. Reject unknown keys, including normalized aliases such as `role_title`/`company_name`; do not silently drop them. |
| Textless selected drafts | Keep them local with `SOURCE_VARIANTS_REQUIRED`. Require at least one non-whitespace original text variant; corrections are not source text. |
| Paragraph/list composition | Adopt the rules above with CRLF-safe marker matching and unchanged original line endings. The JSON fixture exercises all supported markers and a wrapped item. |
| Other field conflicts | Source-choice actions remain description-only. Other conflicting fields require a saved correction or explained irrelevance; no per-variant fact bundles are added in v1. |
| Historical warnings | Currently blank title/company block application creation and assessment. Once corrected, historical warnings need no acknowledgement solely for dismissal. Historical invalid salary ranges require correction metadata, a corrected resolution and fresh review; clearing amounts is allowed. |

`source.structured_facts` is optional. When present, it accepts exactly these optional original keys:

| Keys | Value |
| --- | --- |
| `title`, `company`, `location`, `salary_period` | String or null |
| `description` | String or null; at most 120,000 UTF-16 units |
| `qualifications`, `employmentType` | Arrays of at most 200 strings, each at most 4,000 UTF-16 units; scalar/null arrays are rejected |
| `salary_min`, `salary_max` | Finite nonnegative number or null; original reversed ranges may remain as evidence |
| `salary_currency` | Exactly three ASCII letters or null; original letter case is preserved |

No known contradictions remain in these final offline decisions. Server interoperability is still unverified because no capture endpoint is called. Legacy or otherwise invalid preserved facts fail preparation explicitly while the complete local capture/export remains intact.

The unchanged 256 KiB budget can reject a source bundle even when all individual character limits pass, especially with duplicated corrected description, original variants and structured facts. This is an intentional tracker decision, not a reason to trim local sources. Credential issuance, authoritative worker review checks, server validation and endpoint interoperability remain future work.
