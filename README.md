# Job Hunt · Fill 🌸

A small, very pink Chrome / Edge extension for getting through job applications faster and reviewing saved postings locally. Built independently for your internal workflow, with the blush palette and gateway defaults from [Job Hunt](https://github.com/jijishub/job-hunt). The original Aullevo files in `dist/` are preserved and are not used by this app.

## Start using it

1. Open `chrome://extensions` (or `edge://extensions`).
2. Enable **Developer mode**, choose **Load unpacked**, and select this project's **`build`** folder. For a source checkout, build it using the commands below first. If using the ZIP, extract it first and select the extracted folder containing `manifest.json`.
3. Pin **Job Hunt · Fill**, then click its pink flower icon. The side panel opens beside your application. Shortcut: **Alt+Shift+J**.
4. For AI answers, paste your private gateway API key in **Settings** and test the connection. Defaults: `https://api.jizellecasia.site/v1`, model `luna`, matching your Job Hunt repo. The test uses the saved settings. Local posting capture needs no gateway key or resume.
5. In **Resumes**, upload up to three PDF, DOCX, or TXT resumes, each under 5 MB. Replacing a file keeps the same slot. Choose the version for the role. Optional: **Build profile with AI**, then check the extracted contacts.
6. Save your recurring details in **Profile**. Current salary is optional and stored separately from expected salary; include currency and pay period (for example, PHP 30,000 / month), or leave it blank. Add any work authorization, availability or other facts you want AI to use; unknown facts stay blank.
7. Open the real job application form. **Scan current page** finds profile matches and resume uploads. **Draft missing answers with AI** supplies more suggestions. Edit or untick suggestions, then **Fill reviewed answers**.
8. Review the result on the site. Click Next or Submit yourself. Scan each new page. **Undo last fill** restores fields changed during the last fill in each frame. Undo cannot retract a file already uploaded to a remote server by the job site. Some custom single-select dropdowns do not offer a clear action: Undo can restore a previous choice, but cannot return those controls to blank. It reports any fields it cannot restore.

To fix an incomplete or skipped answer, use **Something missing?** under the review list. Select a scanned field, add a prompt such as “Include my customer support experience and keep it under 80 words,” and click **Update this answer with AI**. Review the revised answer above, then click **Fill this field** to replace only that field, even if it already has a value. Other page values and the global replacement setting stay unchanged. You can also edit the revised answer manually before filling. This request sends the selected field with nearby employer/title context and format constraints, application URL/title, its current draft (or scanned value), your prompt, profile and active resume; it is capped at 1,200 output tokens and is not saved to the reusable AI cache. New facts in the prompt apply to this revision; save recurring facts in Profile. Failed revisions keep your previous draft.

For changes across several fields, use **General instructions** under the review list. For example: “Add descriptions for CloudJi and IT Specialist in their respective boxes, using the exact bullets from my resume.” Click **Prepare updates with AI**, review the separate answers, then **Fill these changes**. Employer and job title context helps distinguish repeated description fields. This request sends all eligible scanned fields, their scanned values and current drafts, nearby field context, profile and the full active resume text, with up to 6,000 output tokens. It bypasses the reusable cache. Filling replaces only the proposed, checked fields, including existing values; Undo restores the last fill. Add missing role sections on the site and scan again before requesting updates. This supports field updates on the current page; it does not add sections or navigate the site.

The tool fills one open application page at a time. Instant, Quick and Gentle typing are available. Existing answers are preserved unless you turn on replacement or explicitly fill targeted changes. It never clicks Next or Submit, solves CAPTCHAs, or chooses consent/checkbox/radio answers.

## Local posting capture pilot

Capture now has three steps: **1. Capture → 2. Review posting → 3. Save to Job Hunt**. Click **Capture current job**, check the title/company/full description, then check the review box and click **Confirm review**. Choose your resume and click **Assess & save to Job Hunt**. If a matching fit already exists, the button says **Save to Job Hunt** and reuses it. Your account connection is managed in step 3; credentials are hidden after connecting.

If the original description may be clipped, expand it on the job site and explicitly confirm that all text is included. That records the clipping resolution; it never silently removes the warning. Other source conflicts show their decision controls beside the issue. Unknown optional facts remain allowed. **Confirm review** saves corrections and the current review together; there is no separate advanced-review section. The completed **Role fit** answer appears directly in step 3 with its explanation, strengths, gaps and preference alignment. Editing posting facts, the resume or preferences invalidates the current result.

**Sources & review history** keeps original excerpts, field provenance and every warning/resolution separate from corrections. Location, work type and salary edits, connection settings, optional preferences, comparisons and delivery history are collapsed by default. There is no saved-capture history picker: capturing another posting replaces the current working posting and removes its old local fit results and completed deliveries. Outstanding frozen deliveries retain their original evidence for recovery under delivery history until explicitly cleared. The current posting remains local across panel restarts for review and delivery; exports are under **Export & advanced tools**. **Clear capture data** in step 1 removes all existing local postings, fit jobs and frozen deliveries, including pending ones. It preserves resumes, profile, AI settings, Job Hunt credentials/preferences and records already saved to Job Hunt; downloaded exports remain on disk. Clearing/replacing waits for active assessment/delivery work to finish before it can be retried. Unsaved corrections survive switching panel tabs but must be saved before closing. **Delete all local data** also deletes captures.

The preview uses one **Description** box for the full posting, including qualifications. Existing separate qualifications are included without repeating matching paragraphs/bullets; saving places the reviewed content in the description and clears the editable qualifications array. Original extracted arrays and text remain preserved in source evidence and local exports.

Adapters cover sampled Greenhouse, Lever, LinkedIn detail/selected search pane, and CGI Njoyn posting layouts, with a generic JobPosting JSON-LD reader and a cautious description-region fallback. This is not a claim of platform-wide compatibility. LinkedIn capture waits briefly for the selected pane and may click its description expansion button; it never clicks Apply or opens an employer page. CGI capture preserves the full visible duties/qualifications alongside the shorter structured excerpt. See [verified evidence, fixtures and remaining limitations](docs/linkedin-cgi-capture.md). Application-only pages and unrelated pages are rejected when no posting content is found. Frames and closed shadow roots are not read; incomplete or conflicting text remains flagged. No AI structuring is used in extraction.

**What still blocks assessment?** lists current blockers and their next actions. Informational unknowns, including missing work model, stay null/Unknown and need no correction. Original warnings remain visible with their saved resolution status. Completeness confirmation resolves the requirements review and the explicitly confirmed description choice; other conflicting fields still need their own decision and explanation. Editing facts invalidates the saved review, current fit and prepared request.

LinkedIn pages that already show **About the job** can use the heading/card fallback when older job classes are absent. Unsupported layouts are reported separately from loading descriptions. If recognition fails on a loaded page, use **Copy capture diagnostics** or **Download diagnostics** in Capture. These contain recognition flags, job IDs and character counts, without posting text, resumes or credentials. Signed-in layout coverage is simulated and still needs verification against the actual page.

If the selected description is recognized but its title is not, capture preserves that description locally and shows `missing_role_title`. Enter the title in the preview and save corrections before assessment. Competing title candidates are left unknown. Job-ID, loading and stale-description checks still apply.

Titles rendered as prominent paragraphs/spans can be read inside the selected posting header. Source labels under fields stay concise; expand **source details** to inspect the technical selector. Completeness/layout warnings still require an explicit review decision; they are not automatically dismissed by successful extraction.

LinkedIn work model and job type come from explicit labels in the selected posting header, including plain text pills and check-mark labels such as **Remote** and **✓ Full-time**. Header recognition can work even when the title element is unsupported. Mentioning remote work in the title or description alone does not establish the work model. Premium cards and other postings do not supply these facts.

**Capturing a page stays local.** It stores no pipeline status or candidate profile. Assessment and saving to Job Hunt require an explicit action. Keep using the existing tracker/Gemini import workflow when extraction is incomplete. The exported local schema is not the tracker API contract. See [extraction evidence and limitations](docs/extraction-pilot.md).

Unresolved differences and their explained decisions appear in step 2; editing facts clears review. **Sources & review history** opens to a short source/review summary. Original text, warning history and extraction details remain available in separate collapsed entries; text viewers have bounded height. **Export & advanced tools → Prepare offline request** validates and exports exact JSON without uploading or calling AI. Oversized requests leave full local sources intact. See [source and review rules](docs/offline-transport.md).

Choose the resume you intend to apply with. For saved Job Hunt preferences, create a new credential with **Share saved preferences and live updates** checked and reconnect the extension. The selected resume remains local; the gateway receives it with the reviewed posting and the exact shared assessment preferences. Additional notes under **Other options** are combined with those preferences. **Compare resumes** explicitly queues one request per saved variant; only the selected variant's matching result can be saved.

**Live preference updates** run only while Capture is visible, with one stream across extension panels. The tracker checks saved changes every 10 seconds; it is not a zero-query push service or a history of every edit. The extension also fetches current preferences before assessment and checks again before accepting/sending a fit. Changed assessment preferences invalidate affected local results and pause pending assessed deliveries without calling AI, rewriting frozen requests or changing saved Job Hunt ratings. Analytics/display changes do not invalidate fits. Streams reconnect with backoff, stop on disconnect/hiding/expiry and resume from the latest snapshot. See [live preferences](docs/live-preferences.md).

**Save to Job Hunt:** in Job Hunt's **My preferences → Job Hunt extension**, create a scoped credential, then paste it into **Save to Job Hunt** in the extension and click **Connect Job Hunt**. The default server is `https://jobhunt.jizellecasia.site`; only this HTTPS origin and loopback development servers are allowed. The deployed tracker must supply the v1 API, current schema and authoritative credential expiry. A missing or incompatible deployment cannot connect.

Click **Assess & save to Job Hunt** after resolving review blockers and selecting your resume. The extension reuses a current fit or obtains one from your configured gateway, then sends the posting, original evidence and completed result together. **Save without assessment** is under **Other options**; it makes no AI request and preserves unresolved warnings. A capture first saved without fit cannot have a fit attached later through the current API. **Retry save** reuses frozen bytes and never reruns AI. Only a receipt produces the green **Saved to Job Hunt** confirmation and link. Existing roles keep their ratings/edits; new roles become Not started. Existing server role fitting and Gemini import stay available. See [production handoff](docs/job-hunt-production-handoff.md).

Model inference still runs at your provider; database storage and transfer remain. Returning to Neon's free tier requires measured usage. See [role-fit workflow and historical interoperability evidence](docs/extension-role-fit.md).

## AI and token use

- One OpenAI-compatible `/chat/completions` gateway configuration. Change the model ID to any Gemini, Luna, or Antigravity model your gateway actually exposes; website subscriptions are not API credentials.
- Profile matches are local and require no AI request.
- Missing-answer drafts receive application URL/title, unanswered field labels/options, nearby role context and scanned values, format constraints, your saved profile and active resume text capped at 16,000 characters. General instructions also receive scanned values, drafts and nearby field context, plus the full active resume for exact bullet copying. AI never receives full page HTML, other resume versions, or file binary.
- Draft output is capped at 2,500 tokens; contact extraction at 700; connection checks at 100. No automatic retries or background requests.
- Successful draft answers are cached by application URL, frame title/URL, field identity and role context, options, profile, resume, gateway and model. Repeated role fields and different applications have separate entries. Older label-only entries are ignored. Up to 250 cached answers are kept. Clear these in Settings.
- All suggestions remain editable. AI can still make mistakes; review the application before submitting.

## Storage and page support

Data is stored in `chrome.storage.local` in this browser profile, with content-script storage access disabled. There is no extension backend, telemetry or cloud sync. Gateway and tracker keys are stored separately, without application-level encryption. Assessment jobs retain their input snapshots, including resume text, locally. Explicit AI requests send the stated context to your configured gateway. Local tracker delivery sends the posting, source evidence and selected result with resume digests; it excludes full resumes, profile, other variants, gateway credentials and prompts. Files are attached to job sites only when you approve filling a recognized resume/CV upload field. **Delete all local data** removes assessments, preferences, connection credentials and frozen deliveries too.

The extension has HTTP/HTTPS host access so it can reach your gateway and scan/fill job forms including cross-origin iframes. Scripts run when you use the tool, not on every page load. Standard inputs, textareas, native selects, file fields, open shadow roots and accessible iframes are supported. Shopee careers custom dropdowns are also supported, including searchable virtual lists, phone country codes, education, schools, courses, skills, and source channels. Form labels outside the actual inputs are recognized. Closed shadow roots, other unsupported custom widgets, date pickers, consent, radio buttons and checkboxes require manual handling. Browser settings, Chrome Web Store and other restricted pages cannot be filled.

For a Shopee multi-select, put each option label on its own line in the answer box (for example, Python then SQL on the next line). Existing choices are preserved unless replacement is enabled or you explicitly choose **Fill this field**. Searchable lists expose only some options during scanning; AI can propose a factual label from your profile/resume, and the extension searches and verifies it against the actual site menu before selecting. Unknown or ambiguous choices report an error instead of treating search text as a completed answer. A unique university name can match the same name followed by an acronym such as `(NUS)`. No application is submitted automatically.

PDF text is extracted locally, as is DOCX text. Scanned/image-only PDFs need OCR first; use DOCX or paste text instead. Text-only resumes provide AI context but have no file to attach. Editing extracted text does not rewrite the original uploaded file.

**Job Hunt integration:** matching gateway defaults, offline v1 exports, direct gateway role fitting and authenticated saving to the canonical production origin or loopback. Production deployment/schema readiness and an account-issued credential are required before real saves can succeed. Imported fits are saved without fetching the tracker resume or running AI again. No production receipt has been obtained by the extension agent.

## Develop and verify

Node.js 22.13+ is required.

```sh
npm install
npm run dev
npm run build
npm test
npx playwright install chromium
npm run test:browser
npm run test:dropdowns
npm run test:fill
npm run test:capture
npm run test:tracker
npm run test:role-fit
npm run test:postings
```

The Vite web preview lets you work on resumes, profile, and settings. Its local data is separate from the extension's data. Page filling requires the installed extension. Never enter your real gateway key on a publicly hosted preview you do not control.

`npm run test:browser` loads the actual built extension in Chromium against a local application fixture. It checks imports, persistence, AI drafting with a mocked gateway, caching, iframe/shadow fields, preserving existing answers, attaching files, stop/undo, and narrow-panel layout. It does not contact the live gateway or submit an application. After rebuilding, click **Reload** on the extension's card and reopen its panel.

`npm test` includes offline serializer checks for source facts, review decisions, salary rules, CRLF requirement composition and UTF-8 payload limits. `npm run test:capture` checks capture, corrections, exports and offline preparation in the built extension, using saved posting fixtures with external requests blocked. Optional `npm run test:capture:live` reads the public samples listed in the [extraction report](docs/extraction-pilot.md); it is separate from offline checks and depends on those pages remaining available.

`npm run test:tracker` uses actual routes from the sibling `../job-hunt` checkout with temporary isolated storage and loopback HTTP. `npm run test:role-fit` combines the built extension, mocked AI and the same local tracker harness. Both require the tracker checkout and its installed dependencies; neither uses its configured database or production credentials. Unit tests cover fit validation, queues, input bindings and delivery recovery/error cases.

`npm run test:postings` checks LinkedIn detail pages, delayed split-pane changes, collapsed/hidden descriptions, unavailable/loading text and CGI completeness review in the installed extension. It also validates the resulting CGI fit request against the isolated sibling tracker, so it requires that checkout and its dependencies. Optional `npm run test:postings:live` checks the supplied public LinkedIn page and fetches/replays CGI's current public response; no signed-in LinkedIn session is used. Live pages can redirect, change or present access challenges.

The posting suite also requires the screenshot-based non-heading Automation Support Engineer title to reach reviewed assessment and local tracker acceptance. Optional `npm run test:linkedin:live` tests job `4475427660` with the built extension in an isolated public browser. It records a failed check when access is blocked (the current run received HTTP 429); this does not verify a signed-in layout.

All AI answer flows include nearby employer/title context. Profile matching excludes fields identified as employer, school, reference or emergency-contact details. Each reviewed answer can reveal its original scanned value. Native fields are checked against length, type, pattern and range constraints before writing; after a fill, values are read back after a short settling period. Rejected answers are reported instead of counted as filled. This verifies browser field state, not server acceptance or changes that happen later. `npm run test:fill` checks asynchronous rejection, constraints, accepted values, Undo and per-field result statuses.

`npm run test:dropdowns` checks Shopee-style custom controls offline, including component state, external labels, searchable virtual options, multiple choices, existing-value protection, failed-choice preservation and Undo limitations. Optional `npm run test:shopee` repeats a small dropdown compatibility check against the public Shopee form with synthetic selections, no identity or files, and POST/PUT/PATCH/DELETE requests blocked after initial page loading. Neither check submits an application. Live compatibility checks depend on the job page remaining available.

## Hosting

**The extension needs no Vercel or Google Cloud deployment.** Load the build locally and it calls your existing gateway directly, so no new server is required.

If you want a hosted UI preview, deploy this repository as a Vite static site: build command `npm run build`, output directory `build`. No environment variables or API keys belong in that deployment. The hosted page cannot fill other browser tabs; use the extension for that. Hosting does not install or update an unpacked extension automatically.

## Source map

- `src/main.js`: side-panel UI and review workflow
- `src/core.js`: profile matching, gateway requests and response validation
- `src/resume.js`: local PDF/DOCX/TXT extraction
- `src/browser.js`: on-demand page execution
- `src/posting-extractor.js`: posting text and structured-data extraction
- `src/captures.js`, `src/capture-storage.js`, `src/capture-ui.js`: local capture review, validation and persistence
- `src/capture-transport.js`, `src/capture-rules.js`: offline v1 request validation, source variants, salary units, composition and review bindings
- `src/role-fit.js`, `src/role-fit-queue.js`, `src/capture-fit-ui.js`: full-input assessment, persisted queue and capture fit controls
- `src/assessed-capture.js`, `src/capture-delivery.js`, `src/local-work-store.js`: selected-result attachment, frozen local test delivery and separate stores
- `public/content.js`: scan, native field fill, file attachment, stop and undo
- `public/manifest.json`: browser extension configuration
- `tests/`: unit and installed-extension browser checks

No code or assets are imported from the original Aullevo build.
