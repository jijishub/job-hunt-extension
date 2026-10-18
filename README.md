# Job Hunt · Fill 🌸

A Chrome / Edge side panel for filling applications, capturing postings and assessing role fit through your own AI gateway.

## Get started

1. Build the project using the commands below.
2. Open `chrome://extensions` or `edge://extensions`, enable **Developer mode**, then **Load unpacked** → select `build/`.
3. Add up to three PDF, DOCX or TXT resumes (under 5 MB each), check their extracted text and complete your profile.
4. Enter your gateway key in **Settings** for AI features. Capture alone needs no key or resume.
5. To save jobs, create a credential in **Job Hunt → My preferences → Job Hunt extension** and connect in the extension's **Settings**. Enable **Share saved preferences and live updates** if wanted.

Shortcut: **Alt+Shift+J**. Reload the extension after rebuilding; a hosted preview does not install or update it.

## Capture → review → assess → save

Click **Capture current job**, check the details, **Confirm review**, choose a resume, then **Assess fit only**. Read the result in the extension, then separately click **Save to Job Hunt**. Assessment uploads nothing to Job Hunt; saving reuses the completed fit without calling AI. Job Hunt stores it without rerunning AI. Existing server fitting and Gemini import remain available.

Each tab keeps its own temporary posting, review, resume choice and fit. Switching tabs restores its work; resumes, preferences and the connection are shared. Confirm unsaved edits before closing the panel. Navigation starts a fresh workspace, except fragment changes. Browser/extension restarts reset temporary tab bindings. In-flight actions finish for their original job before the panel switches.

Resolve missing/conflicting text beside the issue; optional unknowns can stay unknown. **Edit details** opens optional facts; one compact evidence panel and **Export capture** preserve sources. Editing facts reopens review and invalidates the current fit. Resume or preference changes also invalidate it. Connection settings and shared additional preference notes live in **Settings**. Interrupted assessments use the visible retry button; unfinished saves can be retried from Settings. Sampled LinkedIn, CGI Njoyn, Greenhouse and Lever layouts are supported; compatibility is not universal.

**Clear capture data** clears all tabs and pending deliveries, while keeping resumes and Job Hunt records. Ordinary closed-tab work is cleaned up when the panel next runs; pending deliveries retain recovery evidence. Retries reuse the frozen request without new AI. Only a receipt confirms saving. Existing roles keep their edits/ratings. A capture saved without assessment cannot gain a fit later under the same ID.

## Fill applications

**Scan current page → review matches or draft answers with AI → Fill reviewed answers.** Scan each new page. Use **Something missing?** for one answer or **General instructions** for several. Existing values are preserved unless replacement or a targeted fill is requested.

The extension never clicks Apply, Next or Submit, follows employer links, solves CAPTCHAs or chooses consent. Review before submitting. Undo cannot retract uploaded files or restore every custom control. Restricted pages, closed shadow roots and unsupported controls need manual handling; scanned PDFs need OCR. AI and browser checks cannot guarantee accuracy or server acceptance.

## Privacy

Credentials, resumes and profile data use local extension storage, without app-level encryption. Explicit AI requests send relevant context and selected resume text to your gateway. Job Hunt receives the posting, evidence, fit and resume digests—not full resumes, profile or gateway keys. Approved file uploads go to the job site. There is no extension telemetry or automatic AI retry.

Shared preferences refresh before assessment and through a stream while Capture is visible; the tracker checks every 10 seconds, so database reads remain. Settings can clear cached answers or **Delete all local data**, including credentials. Downloaded exports remain on disk.

Keep credentials, resumes, browser sessions and exports outside Git. Ignore rules do not remove previously committed files. Never enter real keys on a hosted preview you do not control.

## Development

Node.js 22.13+:

```sh
npm install
npm run dev
npm run build
```

The web preview has separate data and cannot read other tabs. The installed extension needs no separate hosting deployment. `npm run` lists available checks. The latest UI passed 49 unit checks and `npm run test:capture:flow`, using a temporary extension build/profile, mocked AI and an isolated tracker. Tab activation is exercised with controlled active-tab reads. Production authentication, live posting layouts and the native side-panel surface remain unverified; your installed build was left unchanged.

Details: [capture evidence](docs/extraction-pilot.md), [LinkedIn / CGI](docs/linkedin-cgi-capture.md), [role fit](docs/extension-role-fit.md), [preferences](docs/live-preferences.md), [offline contract](docs/offline-transport.md), [tracker handoff](docs/job-hunt-production-handoff.md).

Original Aullevo files in ignored `dist/` are preserved and are not used by this app.
