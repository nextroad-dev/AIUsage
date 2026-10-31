# Antigravity experimental mobile integration

This implements desktop OAuth through the existing phone loopback receiver. It is not a verified mobile Google integration. No personal credentials are imported from a PC, and no desktop bridge or backend is used.

## Build configuration

Supply a matching desktop client pair as `EXPO_PUBLIC_ANTIGRAVITY_CLIENT_ID` and `EXPO_PUBLIC_ANTIGRAVITY_CLIENT_SECRET` in the build environment. No real values are included in the repository. These are desktop application client configuration, **not personal access/refresh tokens**. Both values are bundled into the application and must not be treated as confidential server secrets. A missing pair produces a specific configuration error before opening the browser.

The experiment requests `openid email profile` and `https://www.googleapis.com/auth/cloud-platform`, offline access, consent, and PKCE S256. It tries loopback ports 51121–51123 with `/auth/callback`, then forwards to `usage://oauth/antigravity`. Google's acceptance of this callback and client combination on Android/iOS remains unverified. Client configuration must match the client that issued a saved refresh token; changing it requires signing in again.

Rebuild the native application: the Android and iOS provider allowlists changed. Expo Go and old native builds are not acceptance targets. Do not distribute an OTA-only update as a verified integration.

## Quota behavior

`loadCodeAssist` supplies the existing project and plan. No project onboarding is performed: first sign in to official Antigravity if the account has no project. The plugin tries the daily `retrieveUserQuotaSummary` endpoint, then `fetchAvailableModels`; missing or all-full model data falls back to measured `retrieveUserQuota` buckets. Only explicit finite fractions in [0,1] are accepted. Disabled windows and internal/unnamed models are omitted. Missing quota returns `unsupported`, preserving existing snapshots during refresh. Authentication errors and rate limits propagate through the existing refresh manager; quota permission errors are not treated as expired Google login.

Sources (protocol reference, not a mobile compatibility guarantee):
- https://github.com/steipete/CodexBar/blob/main/docs/antigravity.md
- https://github.com/steipete/CodexBar/blob/main/Sources/CodexBarCore/Providers/Antigravity/AntigravityQuotaSummaryParser.swift
- https://github.com/steipete/CodexBar/blob/main/Sources/CodexBarCore/Providers/Antigravity/AntigravityRemoteUsageFetcher.swift
- https://developers.google.com/identity/protocols/oauth2/resources/loopback-migration

## Acceptance checklist

Automated tests use synthetic tokens and payloads. No live Google requests are made by tests.

On Android, then iOS, use a native development build with the matching client configuration. Complete Google sign-in yourself in the system browser. Verify callback return, initial quota against the official app, expiration-driven refresh, cancellation, reauthorization, and account isolation. Record each stage separately without URLs, codes, tokens, or raw response bodies. A browser login success alone does not verify quota access.

Current live status: OAuth client pair not supplied by this change; Android and iOS login, token exchange, remote quota and refresh are **not verified**. If Google rejects the client or redirect, retain the error and do not automatically fall back to importing credentials or deploying a desktop bridge.
