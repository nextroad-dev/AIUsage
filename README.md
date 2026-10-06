# Usage — AI subscription usage for iOS

React Native (Expo) app that shows usage, remaining quota and reset time across AI subscriptions.

Connections support **OAuth and API keys only**. Manual recording and Cookie sign-in have been removed; existing manual/session accounts retain read-only history and are not automatically deleted.

## Provider connections

12 implemented providers: Codex, GitHub Copilot, Kimi Code, Kimi platform balance, OpenRouter, MiniMax, GLM Coding Plan, Runway (API organization), Poe, **DeepSeek, Command Code GOAT, OpenCode Go**.

- **Codex and OpenRouter sign in through the system browser and return to the app by themselves** — no device code and no copied authorization code. This uses a one-shot `127.0.0.1` callback listener (`modules/usage-oauth-loopback`), so it needs a native build. In Expo Go and older builds, Codex falls back to device-code sign-in and OpenRouter to an API key, with a note explaining why.
- OpenRouter creates a user-controlled API key that stays in Keychain, and account-wide balance requires a management key; ordinary keys show their own usage. Codex keeps working with existing device-code accounts.
- Command GOAT uses an experimental personal-account endpoint from the official CLI; there is no guessed monthly limit.
- OpenCode Go displays subscription quota, not Zen wallet balance. **OpenCode Zen is not available to connect** until a reliable API-key/OAuth balance interface is verified.
- Provider code and fixtures are not proof of live-account/iOS verification; `tools/probe` checks endpoints against real accounts.

## Develop (Windows is fine)

```bash
npm install
npm run check         # typecheck + lint + tests
npx expo start        # needs a native development build, not Expo Go
```

Expo Go runs the app without its native extras: browser sign-in (`modules/usage-oauth-loopback`), the Home Screen widget and background refresh need a native build.

`tools/probe` verifies provider endpoints against real accounts (see `node tools/probe/probe.mjs list`).

## Unsigned .ipa (no Apple Developer account)

The **iOS unsigned IPA** workflow (`.github/workflows/ios-unsigned.yml`) builds a release `.ipa` without code signing on a GitHub macOS runner. Start it from the Actions tab (*Run workflow*) or by pushing a `v*` tag, then download the `Usage-unsigned-ipa` artifact.

The file must be signed when it is installed, for example with Sideloadly or AltStore and a free Apple ID. Free signing expires after 7 days, and personal teams cannot use App Groups, so the Home Screen widget shows no data in a sideloaded build.
