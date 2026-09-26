# Environment configuration

Every variable, what it does, and — importantly — **what happens if you leave it
out**. Nothing here silently substitutes a default that would mislead someone.

Copy `.env.example` to `.env.local` and edit. Never commit a filled-in copy.

## Firebase

| Variable | Required | Without it |
|---|---|---|
| `FIREBASE_PROJECT_ID` | yes | The server refuses to start |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | yes | Sign-in fails with a clear message |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | yes | Sign-in fails |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | yes | Google sign-in fails |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | yes | Sign-in fails |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | no | Falls back to Application Default Credentials |

The `NEXT_PUBLIC_*` values are shipped to the browser. That is correct and safe:
the Firebase Web config identifies the project, it does not grant access.
Firestore rules deny all direct client access, and every business record is
reached through this app's own server after a membership check.

## Emulators — local development only

| Variable | Effect |
|---|---|
| `FIRESTORE_EMULATOR_HOST` | Routes all Firestore access to the emulator |
| `FIREBASE_AUTH_EMULATOR_HOST` | Routes server-side auth to the emulator |
| `NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST` | Routes browser auth to the emulator |

**While `FIRESTORE_EMULATOR_HOST` is set, real credentials are ignored
entirely.** Unset all three for anything other than local development. The test
suite refuses to run without them, so tests cannot touch a real project.

## Application

| Variable | Default | Notes |
|---|---|---|
| `SESSION_MAX_AGE_MS` | 5 days | Capped at 14 days by Firebase |
| `JOB_RUNNER_SECRET` | — | **Required.** Bearer token for `/api/jobs/run`, compared in constant time. Generate with `openssl rand -hex 32` |
| `PLAYWRIGHT_CHROMIUM_PATH` | — | Path to Chromium for PDFs. Without it, Playwright's own download is used |

## AI assistance

The app is **fully usable with AI switched off**, and the manual form is always
the fallback. `mock` is a real deterministic adapter used in development and
tests — it is never silently substituted for a configured provider that fails.

| Variable | Default | Notes |
|---|---|---|
| `AI_ENABLED` | `true` | `false` removes the feature from the editor entirely |
| `AI_LLM_PROVIDER` | `mock` | `mock` \| `anthropic` \| `openai` \| `google` |
| `AI_LLM_MODEL` | provider default | |
| `AI_LLM_API_KEY` | — | Required for any real provider. **Server-side only** |
| `AI_LLM_BASE_URL` | provider default | For proxies or compatible endpoints |
| `AI_TRANSCRIPTION_PROVIDER` | `mock` | `mock` \| `openai` \| `google` \| `browser` |
| `AI_TRANSCRIPTION_MODEL` | provider default | |
| `AI_TRANSCRIPTION_API_KEY` | — | Required for real transcription |
| `AI_TIMEOUT_MS` | `20000` | On timeout the form is untouched and the owner is told |
| `AI_MAX_INPUT_CHARS` | `1200` | Longer instructions are refused |
| `AI_MAX_AUDIO_BYTES` | `8388608` | Larger recordings are refused |
| `AI_MAX_REQUESTS_PER_HOUR` | `60` | Per business, enforced in Firestore |
| `AI_MAX_REQUESTS_PER_DAY` | `300` | Per business |

If a provider is configured and the key is missing, the request fails with a
message saying exactly that — it does not fall back to the mock and report
success.

### What is and is not sent to a model

Sent: the owner's instruction, today's date, and up to 40 customer **names** for
matching.

Never sent: PAN, bank details, UPI IDs, phone numbers, addresses, GSTINs, the
full customer list, any invoice, or any return payload. There is no field in the
model's output schema capable of carrying a record identifier, a query or a
command, so an instruction injected into the text has nowhere to land.

Audit entries record that an interpretation happened and how many lines came
back. They do not record the instruction text.

## GST filing provider

| Variable | Default | Notes |
|---|---|---|
| `GSP_MODE` | `unconfigured` | `unconfigured` \| `sandbox` \| `production` |
| `GSP_PROVIDER_NAME` | — | For display and audit |
| `GSP_BASE_URL` | — | Provider API base |
| `GSP_CLIENT_ID` | — | |
| `GSP_CLIENT_SECRET` | — | **Server-side only** |
| `GSP_PRODUCTION_ENABLED` | `false` | Must be `true` **and** `GSP_MODE=production` |

Production filing requires the mode, the flag **and** full credentials. Anything
less refuses rather than falling back to the sandbox, because a mocked success
reported as a filing is the worst outcome this module could produce.

See [provider-configuration.md](provider-configuration.md).

## Secrets

- No secret is readable by the browser. Only `NEXT_PUBLIC_*` reaches the client.
- Service-account keys must never enter the repository; `.gitignore` covers the
  usual filenames.
- Rotate `JOB_RUNNER_SECRET` and provider secrets through your host's secret
  manager, not by editing a file on a server.
- Changing bank or UPI details in the app requires a recent re-authentication,
  separately from having a valid session.
