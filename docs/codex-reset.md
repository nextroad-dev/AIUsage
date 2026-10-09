# Codex Reset public data integration

This is auxiliary information on the existing ChatGPT / Codex account details screen. Personal
meters, reset times, provider registration, authentication and `UsageSnapshot` stay unchanged.
No backend, new native module, dependency or database migration is required.

## Contract verified on 2026-10-08

Read [developers](https://codex-reset.com/developers) and [terms](https://codex-reset.com/terms).
Only the reset odds are used: one endpoint, two numbers. A reduced, genuine response sample lives
in `src/data/codex-reset/__tests__/fixtures/forecast.json`; it is a test input, never a runtime
fallback.

| Endpoint | Fields used | Interpretation |
| --- | --- | --- |
| `/api/forecast` | `probabilities.rounded_24h`, `rounded_48h`, `updated_at` | Rounded probabilities are percentages from 0 to 100, not fractions. A forecast is not a promise. Missing/malformed values display as unknown. Every other field is dropped at parse time. |

Timeline (`/api/timeline`) and service status (`/api/status-history`) are not requested.
Confidence, last reset time and official signals are not read or stored.

## Requests, cache and isolation

- Public data is **off by default**. The Codex detail screen asks for explicit consent to
  `codex-reset.com` before enabling an app-wide switch for the reset odds.
  The bilingual dialog identifies this independent service, explains predictions, and states
  that API keys, ChatGPT tokens, account IDs and personal usage are never sent. Canceling leaves
  the switch off. Every re-enable asks again; no personal provider configuration is changed.
- Versioned consent (`codex-reset:consent:v1`) is saved in existing local settings, with source
  and acceptance time. Missing, invalid or unreadable consent fails closed. Foreground query,
  manual refresh and background service all check it before public HTTP. Disabling hides all
  public sections, cancels their queries and aborts in-flight fetches; late responses are
  discarded. Already sent requests cannot be recalled. Persistent response cache and rate-limit
  gates remain on-device so re-enabling cannot bypass request limits. Failed settings writes are
  reported to the user; failed opt-in never enables requests.
- `CodexResetService` reuses `requestJson` and native React Native fetch. Requests contain only
  `Accept: application/json` and `User-Agent: AIUsage/1.0 (+https://github.com/nextroad-dev/AIUsage)`.
  It never receives credentials or account identifiers. User-Agent is explicitly set for native
  iOS/Android readers; the actual header on devices must be checked on a development build.
- The source allows at most one poll per minute and publishes copies with `Cache-Control:
  max-age=60`. AIUsage is more conservative: successful requests and retries are at least five
  minutes apart. Language/account changes share the same requests.
- TanStack Query shares foreground data. The app-wide service deduplicates in-flight requests
  and shares the network gate with manual refresh and headless background refresh. Query retries
  are disabled; periodic loads retry through the service's persistent exponential backoff (using
  the existing helper, up to 30 minutes). Non-rate-limit HTTP 4xx back off for an hour.
- HTTP 429 respects both forms of `Retry-After` (seconds and HTTP date), with an origin-wide
  persistent gate. Manual refresh does not bypass that gate. Concurrent requests already in
  flight when a 429 arrives can finish; new loads wait.
- Fetch aborts after eight seconds. A failure preserves the last valid response. Attempt gates are reserved before network I/O so interrupted tasks do not
  immediately retry after a restart. Persistence failure still leaves the in-process cache usable.
- Versioned cache envelopes are stored in existing SQLite settings keys (`codex-reset:v1:*`;
  only `forecast` and the origin retry gate are written).
  Both stored envelopes and external JSON are checked with Zod. No personal snapshot/health rows
  are written. Old copies are marked when the last request failed, the source/fetch timestamp is
  missing or at least 15 minutes old, or the published expiry has passed.
  Expiry can therefore be flagged before the next five-minute poll; old odds are never silently
  presented as fresh. Successful fetch time never substitutes for an old source update time.
- Polling runs only while the details route is focused and the native AppState is active. Global
  personal refresh starts auxiliary work without awaiting it; public failures or a slow source
  cannot delay personal snapshots or alerts. The background task joins that public work after
  the personal cycle. Background execution is controlled by iOS/Android and can be interrupted.
- Public 401/403 is a data-source failure, never a rejected ChatGPT credential. Public data
  failure is never evidence of an OpenAI outage. Old odds are explicitly labelled as old data.

The card displays **Data: codex-reset.com** once, linked to <https://codex-reset.com/>, next to
the source update time. README and this document carry the credit too. Do not replace the
on-screen credit with an About-page link. No data is republished via an API.

## UI and alerts

One "Reset chance" section on the Codex details screen, built from `Section`, `Button` and
theme colors, shows only the two odds side by side: "Next 24 hours" and "Next 48 hours", each a
large accent percentage with a word band (`chanceBand`: under 15% low, 15-39% possible, 40% and up
high). Below them sits one footnote: fetch error, stale warning, source time and credit, and a
"Turn off" link. The section footer states that this is an independent prediction and does not
guarantee personal quota recovery. Off, the section is a short explanation and a "Turn on" button
that opens the consent dialog.

The odds appear only on the Codex details screen; overview cards carry no reset chip.

All interface copy is English and Chinese; `Intl.DateTimeFormat` follows the app language and
device timezone for the source time.

Global reset notifications are intentionally deferred. Existing alerts are account/meter-cycle
based. A global subscription needs a persistent first-enable baseline, event-ID deduplication
across accounts and restarts, dedicated notification routing, and source credit in the notification
surface. Keeping that work separate avoids interfering with personal reset notification scheduling.
Forecasts trigger no notifications in this version.

## Verification

Unit tests cover real response parsing, malformed/missing fields, dropping unused fields,
probability bands, deduplication to the single endpoint, native request headers, both 429 forms, timeout, persistent offline cache,
freshness flags, errors isolated from personal Codex/other provider refresh, bilingual UI,
explicit consent, default-off/manual/background gating, persistence, multi-screen revocation,
in-flight abort and discarded late results.

Run the project's typecheck, lint, Jest and probe tests. Device checks still required:

1. Open a Codex account in iOS/Android development builds. Confirm there are no public requests
   before agreeing, cancellation leaves the switch off, and disabling stops foreground/background
   reads after restart. Enable and inspect actual outgoing User-Agent
   and confirm no auth or account headers appear on the public request.
2. Verify local event times in a non-UTC zone and change English/Chinese plus theme/accent.
3. Check small-screen wrapping, large accessibility font sizes, the source link,
   VoiceOver/TalkBack and reduced motion.
4. Go offline/restart after a successful fetch; verify old public data stays visible with warnings
   while personal refresh remains independent. Test 429 using a controlled mock, not by hammering
   the public service.
5. Background/foreground repeatedly within five minutes; inspect request counts. Background work
   is best effort, never a guarantee of timely reset detection.
