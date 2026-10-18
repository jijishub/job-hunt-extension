# Live Job Hunt preferences

The extension consumes the supplied v1 preference contract: `GET /api/v1/preferences` and authenticated streaming `GET /api/v1/preferences/events`. The tracker deployment was reported as `2df6efa`; authenticated production delivery has not been observed by the extension agent because no scoped credential is available in this session.

## What the user does

In Job Hunt, open **My preferences → Job Hunt extension**, check **Share saved preferences and live updates**, then create a new credential. In the extension, open Capture → step 3 → **Manage connection**, paste that credential and reconnect. Existing capture-only credentials cannot gain the new scope. Secret tokens stay in the extension, not in URLs, AI context or exports. Save preference edits in Job Hunt to publish them; draft keystrokes do not produce updates.

The extension shows a short live/reconnecting/not-shared status under the selected resume. Capture-only credentials keep the previous optional local-notes behavior. With sharing enabled, failed freshness/authentication checks block assessment or assessed delivery instead of silently substituting stale cached preferences.

## Data and lifecycle

`TrackerPreferences` uses streaming fetch with a Bearer header, redirects rejected and cookies omitted. It parses snapshot/change/error/reconnect frames, comments, chunked UTF-8 and multi-line data, validates the account/schema/field bounds and the canonical SHA-256 of `assessment_preferences`, and bounds pending event size. The persisted cache contains only the account/origin, revision, assessment preference object/hash and received time. It does not store the complete analytics/display preference object or server resume.

The stream is active only while Capture is visible and the connection advertises preference and event access. A browser Web Lock allows one stream across panels; other panels consume storage updates and can take over after the owner closes. Hiding Capture, closing/suspending the panel, disconnecting or changing the connected credential/account stops the stream. Expired/revoked access requests re-pairing. Transient failures reconnect with bounded exponential backoff/jitter; reconnect snapshots recover current state without treating Last-Event-ID as durable history.

The current server checks persisted preferences every 10 seconds and rotates bounded streams after about 50 seconds. This consumes authentication/preferences reads while active; it does not eliminate Neon traffic. Multiple saves may coalesce. There is no background stream while the UI is closed and no automatic AI request on an event.

## Fit and upload integrity

Without local notes the gateway receives the exact nine-field `assessment_preferences` object; its canonical digest equals the server preference hash. Explicit extension notes are added as `additional_notes`, and the digest is recomputed for that effective context. Account/origin provenance is also bound locally. The upload envelope remains v1: only the final preference digest and result are attached, without preference text, resume text or tokens.

Snapshot reads occur before assessment and in the queue/delivery input guards. Changed assessment preference hashes make affected queued/running/cached results stale while retaining their inputs/results for history. Analytics-only revision changes keep the fit valid. Pending assessed deliveries pause with their original bytes, UUID and hash intact; no replacement capture or AI run is manufactured. Recapture and reassess explicitly to prepare a different request. For uncertain previous delivery, receipt lookup remains allowed even when preferences changed; a new POST still requires valid current inputs. Delivered captures and their Job Hunt ratings remain unchanged.

Disconnect/reset clears the remote cache. Text editing is not interrupted by event-driven rerenders; unsaved drafts stay local. Original posting warnings, review rules, selected local resumes, capture exports, Gemini import and form-filling workflows remain available.

No test suites or production credential/upload calls were run for this change, as requested. Production build compilation is separate from authenticated event-delivery verification.

The production build completed successfully. Authenticated snapshot/event delivery still needs the user's sharing-enabled credential; no token was requested in chat or used by the agent.
