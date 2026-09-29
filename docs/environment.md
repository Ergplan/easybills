# Environment configuration

Every variable, what it does, and — importantly — **what happens if you leave it
out**. Nothing here silently substitutes a default that would mislead someone.

Copy `.env.example` to `.env.local` and edit. Never commit a filled-in copy.

## Database

| Variable | Required | Without it |
|---|---|---|
| `DATABASE_URL` | yes | Every page fails; `/api/health` says so. On the VM the compose stack sets it |
| `DATABASE_POOL_MAX` | no | 10 connections |

## Firebase (phone sign-in only)

| Variable | Required | Without it |
|---|---|---|
| `FIREBASE_PROJECT_ID` | yes | Sign-in cannot verify tokens |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | yes | Sign-in fails with a clear message |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | yes | Sign-in fails |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | yes | Sign-in fails |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | yes | Sign-in fails |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | no | Application Default Credentials. Don't create a key file; see deployment.md |
| `FIREBASE_AUTH_EMULATOR_HOST`, `NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST` | local only | Sign-in talks to the real project |

The `NEXT_PUBLIC_*` values are shipped to the browser. That is correct and safe: they identify the
sign-in project and grant nothing. The browser never reaches the database.

## Application

| Variable | Default | Notes |
|---|---|---|
| `AUTH_BYPASS` | off | Exactly `true` switches sign-in off: everyone is one test owner. Never with real books |
| `SESSION_MAX_AGE_MS` | 5 days | Capped at 14 days by Firebase |
| `PLAYWRIGHT_CHROMIUM_PATH` | — | Chromium for PDFs. The image sets `/usr/bin/chromium` |

## Docling (photos and scans of old bills)

| Variable | Default | Notes |
|---|---|---|
| `DOCLING_URL` | — | e.g. `http://docling:5001`. Unset: typed PDFs and spreadsheets still work; photos are refused with a sentence |
| `DOCLING_API_KEY` | — | Only if docling-serve was started with `DOCLING_SERVE_API_KEY` |
| `DOCLING_TIMEOUT_MS` | `180000` | A photo on a small CPU takes a while |
| `DOCLING_OCR_LANGS` | `en,hi` | BCP-47 tags, in order |

## OpenAI (voice, Poocho, contract reading)

One key, `OPENAI_API_KEY`, from Secret Manager (`ekbill-openai-api-key`) on the VM. Without it:
voice is off, Poocho shows matching records instead of a written answer, and contracts are read
by the app's own rules. Each feature says so on screen.

| Variable | Default | Notes |
|---|---|---|
| `OPENAI_API_KEY` | — | **Server-side only.** The browser gets a short-lived voice secret, never this |
| `OPENAI_REALTIME_MODEL` | `gpt-realtime` | Voice |
| `OPENAI_REALTIME_VOICE` | `marin` | |
| `OPENAI_TEXT_MODEL` | `gpt-4.1-mini` | Poocho answers and contract reading |
| `OPENAI_EMBEDDING_MODEL` | `text-embedding-3-small` | 1536 dimensions, fixed by the schema |
| `ASK_ENABLED` | `true` | `false` turns off the model part of Poocho; word search stays |
| `ASK_TIMEOUT_MS` | `20000` | |

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
| `AI_MAX_REQUESTS_PER_HOUR` | `60` | Per business, enforced in Postgres; Poocho answers count too |
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

## Secrets

- No secret is readable by the browser. Only `NEXT_PUBLIC_*` reaches the client.
- Service-account keys must never enter the repository; `.gitignore` covers the
  usual filenames.
- Rotate secrets in Secret Manager (`ekbill-*`) and run `deploy/vm/up.sh`; never
  by editing a file on the server.
- Changing bank or UPI details in the app requires a recent re-authentication,
  separately from having a valid session.
