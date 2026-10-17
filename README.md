# Job Hunt · Fill 🌸

A small, very pink Chrome / Edge extension for getting through job applications faster. Built independently for your internal workflow, with the blush palette and gateway defaults from [Job Hunt](https://github.com/jijishub/job-hunt). The original Aullevo files in `dist/` are preserved and are not used by this app.

## Start using it

1. Open `chrome://extensions` (or `edge://extensions`).
2. Enable **Developer mode**, choose **Load unpacked**, and select this project's **`build`** folder. If using the ZIP, extract it first and select the extracted folder containing `manifest.json`.
3. Pin **Job Hunt · Fill**, then click its pink flower icon. The side panel opens beside your application. Shortcut: **Alt+Shift+J**.
4. In **Settings**, paste your private gateway API key and test the connection. Defaults: `https://api.jizellecasia.site/v1`, model `luna`, matching your Job Hunt repo. The test uses the saved settings.
5. In **Resumes**, upload up to three PDF, DOCX, or TXT resumes, each under 5 MB. Replacing a file keeps the same slot. Choose the version for the role. Optional: **Build profile with AI**, then check the extracted contacts.
6. Save your recurring details in **Profile**. Current salary is optional and stored separately from expected salary; include currency and pay period (for example, PHP 30,000 / month), or leave it blank. Add any work authorization, availability or other facts you want AI to use; unknown facts stay blank.
7. Open the real job application form. **Scan current page** finds profile matches and resume uploads. **Draft missing answers with AI** supplies more suggestions. Edit or untick suggestions, then **Fill reviewed answers**.
8. Review the result on the site. Click Next or Submit yourself. Scan each new page. **Undo last fill** restores fields changed during the last fill in each frame. Undo cannot retract a file already uploaded to a remote server by the job site. Some custom single-select dropdowns do not offer a clear action: Undo can restore a previous choice, but cannot return those controls to blank. It reports any fields it cannot restore.

To fix an incomplete or skipped answer, use **Something missing?** under the review list. Select a scanned field, add a prompt such as “Include my customer support experience and keep it under 80 words,” and click **Update this answer with AI**. Review the revised answer above, then click **Fill this field** to replace only that field, even if it already has a value. Other page values and the global replacement setting stay unchanged. You can also edit the revised answer manually before filling. This request sends the selected field with nearby employer/title context and format constraints, application URL/title, its current draft (or scanned value), your prompt, profile and active resume; it is capped at 1,200 output tokens and is not saved to the reusable AI cache. New facts in the prompt apply to this revision; save recurring facts in Profile. Failed revisions keep your previous draft.

For changes across several fields, use **General instructions** under the review list. For example: “Add descriptions for CloudJi and IT Specialist in their respective boxes, using the exact bullets from my resume.” Click **Prepare updates with AI**, review the separate answers, then **Fill these changes**. Employer and job title context helps distinguish repeated description fields. This request sends all eligible scanned fields, their scanned values and current drafts, nearby field context, profile and the full active resume text, with up to 6,000 output tokens. It bypasses the reusable cache. Filling replaces only the proposed, checked fields, including existing values; Undo restores the last fill. Add missing role sections on the site and scan again before requesting updates. This supports field updates on the current page; it does not add sections or navigate the site.

The tool fills one open application page at a time. Instant, Quick and Gentle typing are available. Existing answers are preserved unless you turn on replacement or explicitly fill targeted changes. It never clicks Next or Submit, solves CAPTCHAs, or chooses consent/checkbox/radio answers.

## AI and token use

- One OpenAI-compatible `/chat/completions` gateway configuration. Change the model ID to any Gemini, Luna, or Antigravity model your gateway actually exposes; website subscriptions are not API credentials.
- Profile matches are local and require no AI request.
- Missing-answer drafts receive application URL/title, unanswered field labels/options, nearby role context and scanned values, format constraints, your saved profile and active resume text capped at 16,000 characters. General instructions also receive scanned values, drafts and nearby field context, plus the full active resume for exact bullet copying. AI never receives full page HTML, other resume versions, or file binary.
- Draft output is capped at 2,500 tokens; contact extraction at 700; connection checks at 100. No automatic retries or background requests.
- Successful draft answers are cached by application URL, frame title/URL, field identity and role context, options, profile, resume, gateway and model. Repeated role fields and different applications have separate entries. Older label-only entries are ignored. Up to 250 cached answers are kept. Clear these in Settings.
- All suggestions remain editable. AI can still make mistakes; review the application before submitting.

## Storage and page support

Data is stored in `chrome.storage.local` in this browser profile, with content-script storage access disabled. There is no app backend, account system, telemetry, or cloud sync. The gateway key is stored locally without application-level encryption. AI requests send the stated context to your configured gateway. Files are attached only when you approve filling a recognized resume/CV upload field.

The extension has HTTP/HTTPS host access so it can reach your gateway and scan/fill job forms including cross-origin iframes. Scripts run when you use the tool, not on every page load. Standard inputs, textareas, native selects, file fields, open shadow roots and accessible iframes are supported. Shopee careers custom dropdowns are also supported, including searchable virtual lists, phone country codes, education, schools, courses, skills, and source channels. Form labels outside the actual inputs are recognized. Closed shadow roots, other unsupported custom widgets, date pickers, consent, radio buttons and checkboxes require manual handling. Browser settings, Chrome Web Store and other restricted pages cannot be filled.

For a Shopee multi-select, put each option label on its own line in the answer box (for example, Python then SQL on the next line). Existing choices are preserved unless replacement is enabled or you explicitly choose **Fill this field**. Searchable lists expose only some options during scanning; AI can propose a factual label from your profile/resume, and the extension searches and verifies it against the actual site menu before selecting. Unknown or ambiguous choices report an error instead of treating search text as a completed answer. A unique university name can match the same name followed by an acronym such as `(NUS)`. No application is submitted automatically.

PDF text is extracted locally, as is DOCX text. Scanned/image-only PDFs need OCR first; use DOCX or paste text instead. Text-only resumes provide AI context but have no file to attach. Editing extracted text does not rewrite the original uploaded file.

**Job Hunt integration:** visual styling, matching gateway defaults, and a link back to your tracker. This version does not write or sync application records to Job Hunt; its authenticated APIs have not been changed.

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
```

The Vite web preview lets you work on resumes, profile, and settings. Its local data is separate from the extension's data. Page filling requires the installed extension. Never enter your real gateway key on a publicly hosted preview you do not control.

`npm run test:browser` loads the actual built extension in Chromium against a local application fixture. It checks imports, persistence, AI drafting with a mocked gateway, caching, iframe/shadow fields, preserving existing answers, attaching files, stop/undo, and narrow-panel layout. It does not contact the live gateway or submit an application. After rebuilding, click **Reload** on the extension's card and reopen its panel.

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
- `public/content.js`: scan, native field fill, file attachment, stop and undo
- `public/manifest.json`: browser extension configuration
- `tests/`: unit and installed-extension browser checks

No code or assets are imported from the original Aullevo build.
