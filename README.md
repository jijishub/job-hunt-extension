# Job Hunt · Fill 🌸

A small, very pink Chrome / Edge extension for getting through job applications faster. Built independently for your internal workflow, with the blush palette and gateway defaults from [Job Hunt](https://github.com/jijishub/job-hunt). The original Aullevo files in `dist/` are preserved and are not used by this app.

## Start using it

1. Open `chrome://extensions` (or `edge://extensions`).
2. Enable **Developer mode**, choose **Load unpacked**, and select this project's **`build`** folder. If using the ZIP, extract it first and select the extracted folder containing `manifest.json`.
3. Pin **Job Hunt · Fill**, then click its pink flower icon. The side panel opens beside your application. Shortcut: **Alt+Shift+J**.
4. In **Settings**, paste your private gateway API key and test the connection. Defaults: `https://api.jizellecasia.site/v1`, model `luna`, matching your Job Hunt repo. The test uses the saved settings.
5. In **Resumes**, upload up to three PDF, DOCX, or TXT resumes, each under 5 MB. Replacing a file keeps the same slot. Choose the version for the role. Optional: **Build profile with AI**, then check the extracted contacts.
6. Save your recurring details in **Profile**. Add any work authorization, salary, availability or other facts you want AI to use; unknown facts stay blank.
7. Open the real job application form. **Scan current page** finds profile matches and resume uploads. **Draft missing answers with AI** supplies more suggestions. Edit or untick suggestions, then **Fill reviewed answers**.
8. Review the result on the site. Click Next or Submit yourself. Scan each new page. **Undo last fill** restores fields changed during the last fill in each frame. Undo cannot retract a file already uploaded to a remote server by the job site.

To fix an incomplete or skipped answer, use **Something missing?** under the review list. Select a scanned field, add a prompt such as “Include my customer support experience and keep it under 80 words,” and click **Update this answer with AI**. Review the revised answer above, then click **Fill this field** to replace only that field, even if it already has a value. Other page values and the global replacement setting stay unchanged. You can also edit the revised answer manually before filling. This request sends only the selected field, its current draft (or scanned value), your prompt, profile and active resume; it is capped at 1,200 output tokens and is not saved to the reusable AI cache. New facts in the prompt apply to this revision; save recurring facts in Profile. Failed revisions keep your previous draft.

The tool fills one open application page at a time. Instant, Quick and Gentle typing are available. Existing answers are preserved unless you turn on replacement. It never clicks Next or Submit, solves CAPTCHAs, or chooses consent/checkbox/radio answers.

## AI and token use

- One OpenAI-compatible `/chat/completions` gateway configuration. Change the model ID to any Gemini, Luna, or Antigravity model your gateway actually exposes; website subscriptions are not API credentials.
- Profile matches are local and require no AI request.
- AI receives only unanswered field labels/options, your saved profile and the active resume's text, capped at 16,000 characters. It never receives full page HTML, other resume versions, or file binary.
- Draft output is capped at 2,500 tokens; contact extraction at 700; connection checks at 100. No automatic retries or background requests.
- Successful answers are cached by field, options, profile, resume, gateway and model. Up to 250 cached answers are kept. Clear these in Settings.
- All suggestions remain editable. AI can still make mistakes; review the application before submitting.

## Storage and page support

Data is stored in `chrome.storage.local` in this browser profile, with content-script storage access disabled. There is no app backend, account system, telemetry, or cloud sync. The gateway key is stored locally without application-level encryption. AI requests send the stated context to your configured gateway. Files are attached only when you approve filling a recognized resume/CV upload field.

The extension has HTTP/HTTPS host access so it can reach your gateway and scan/fill job forms including cross-origin iframes. Scripts run when you use the tool, not on every page load. Standard inputs, textareas, native selects, file fields, open shadow roots and accessible iframes are supported. Custom dropdowns, closed shadow roots, consent, radio buttons and checkboxes require manual handling. Browser settings, Chrome Web Store and other restricted pages cannot be filled.

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
```

The Vite web preview lets you work on resumes, profile, and settings. Its local data is separate from the extension's data. Page filling requires the installed extension. Never enter your real gateway key on a publicly hosted preview you do not control.

`npm run test:browser` loads the actual built extension in Chromium against a local application fixture. It checks imports, persistence, AI drafting with a mocked gateway, caching, iframe/shadow fields, preserving existing answers, attaching files, stop/undo, and narrow-panel layout. It does not contact the live gateway or submit an application. After rebuilding, click **Reload** on the extension's card and reopen its panel.

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
