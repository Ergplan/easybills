# Provider configuration

Two kinds of provider plug in: a language model (optional, for "speak or type
your bill") and a GST filing provider (optional, for connected filing).

---

## Language model

The app is fully usable without one. Everything AI does is a shortcut for typing
into a form that is always there.

### Development

```
AI_LLM_PROVIDER=mock
AI_TRANSCRIPTION_PROVIDER=mock
```

`mock` is a real deterministic adapter — a rule-based parser that handles
English, Hindi in Latin script, and mixed input. Tests exercise the whole
pipeline through it. It is **never** substituted for a configured provider that
fails: if you configure Anthropic and the call errors, the owner is told the
assistant is unavailable and falls back to the form.

The mock transcription adapter cannot hear anything and says so in its output
rather than returning a plausible fabricated sentence.

### A real provider

```
AI_LLM_PROVIDER=anthropic          # or openai, google
AI_LLM_MODEL=claude-sonnet-5
AI_LLM_API_KEY=sk-...
```

All three use structured output — a tool schema, JSON schema mode, or a response
schema — so the model cannot return prose where a record was expected. If
`AI_LLM_API_KEY` is missing the request fails with exactly that message.

### Transcription

```
AI_TRANSCRIPTION_PROVIDER=openai   # or google
AI_TRANSCRIPTION_API_KEY=...
```

Audio is streamed to the provider and discarded; it is never written to storage.
The transcript goes back to the browser for the owner to read and edit before
anything is done with it.

`browser` is a placeholder for on-device recognition and currently reports that
voice is handled by the browser in this configuration.

**Provider retention is your decision to make deliberately.** Check your
provider's data-retention settings and choose them consciously; this app cannot
control what a provider keeps.

### Limits

```
AI_TIMEOUT_MS=20000
AI_MAX_INPUT_CHARS=1200
AI_MAX_AUDIO_BYTES=8388608
AI_MAX_REQUESTS_PER_HOUR=60
AI_MAX_REQUESTS_PER_DAY=300
```

Counted per business in Firestore, so the limit holds across server instances
and restarts. Both caps apply: a runaway loop and a slow grind cost the same
money by different routes.

### What the model can and cannot do

It returns one strict schema describing a *reading of a sentence*. That schema
has no field capable of holding a record id, a query, or a command — so an
instruction injected into the text has nowhere to land. Customer matching,
saved-price lookup and every amount happen server-side, inside the caller's own
business.

It can propose fields. It **cannot** issue, send, record a payment, change bank
details, or commit a schedule change.

---

## GST filing provider

Filing goes through an authorised GST Suvidha Provider's published API with the
taxpayer's recorded consent.

### This app will never

- Scrape the GST portal's login pages
- Handle, bypass or automate CAPTCHA or OTP
- Store a taxpayer's GST portal password
- Send an OTP, signing material or a session token to a language model
- File or pay anything without an explicit, per-submission approval
- File on a schedule, or let a model initiate a filing

### Modes

```
GSP_MODE=unconfigured    # default: filing is refused with a clear reason
GSP_MODE=sandbox         # the sandbox adapter
GSP_MODE=production      # requires everything below
```

Production filing requires **all** of:

```
GSP_MODE=production
GSP_PRODUCTION_ENABLED=true
GSP_BASE_URL=https://...
GSP_CLIENT_ID=...
GSP_CLIENT_SECRET=...
```

Anything less refuses. It does **not** fall back to the sandbox and report
success — a mocked success reported as a filing is the worst thing this module
could do.

### Current state

**Production filing is unavailable in this build, and is not claimed to be
available.** The adapter interface, the sandbox implementation, the consent
records, the approval binding, the single-flight lock, the idempotency keys, the
status-query-before-resubmit path and the acknowledgement validation are all
implemented and tested. What is missing is a provider contract and credentials.

`describeFilingCapability()` returns `productionVerified: false` and will keep
doing so until a real provider connection has actually been exercised. The GST
screen tells the owner plainly that filing from inside the app is not available
and points them at the accountant pack.

### Adding a real provider

1. Get empanelled access from a GSP. Check the current list at
   https://gstn.org.in/empanelled-gsps.
2. Implement `GstFilingProvider` in `src/server/gst/filing/provider.ts` against
   that provider's published API. The interface is two methods: `submit` and
   `queryStatus`.
3. Wire it into `selectFilingProvider()`.
4. Exercise the full sandbox path first: submission, schema rejection, timeout,
   status query, acknowledgement, already-filed.
5. Only then enable production, and only with a real contract in place.

Signing follows whatever the provider supports — EVC or DSC. This app does not
implement signing itself and does not hold signing material.

### Consent

Consent is recorded per GSTIN and per environment. Sandbox consent never
authorises a production submission. An expired or revoked consent stops filing
immediately. Both are covered by tests.
