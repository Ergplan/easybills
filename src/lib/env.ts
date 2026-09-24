/**
 * Environment configuration, validated once at first use.
 *
 * Rules this file enforces:
 *  - No secret is ever read into a module that the browser bundle can import.
 *    Only `NEXT_PUBLIC_*` values are exposed client-side, and the Firebase Web
 *    config is public by design (it identifies the project; it does not grant
 *    access, because Firestore rules deny all direct client access).
 *  - A missing required value fails loudly at startup, not silently at runtime.
 *  - Optional integrations report "not configured" rather than pretending.
 */

export type Runtime = 'development' | 'test' | 'production';

function optional(name: string): string | null {
  const v = process.env[name];
  return v && v.trim() !== '' ? v.trim() : null;
}

function required(name: string): string {
  const v = optional(name);
  if (!v) {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.example to .env.local and fill it in ` +
        '(see docs/setup.md).',
    );
  }
  return v;
}

export const runtime: Runtime =
  process.env.NODE_ENV === 'production' ? 'production' : process.env.NODE_ENV === 'test' ? 'test' : 'development';

/** True when talking to the local Firebase emulator suite rather than a real project. */
export const usingEmulators = Boolean(optional('FIRESTORE_EMULATOR_HOST'));

export const firebaseProjectId = (): string =>
  optional('FIREBASE_PROJECT_ID') ?? optional('NEXT_PUBLIC_FIREBASE_PROJECT_ID') ?? required('FIREBASE_PROJECT_ID');

/** Public Firebase Web config. Safe to ship to the browser. */
export const publicFirebaseConfig = () => ({
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? '',
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? '',
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? '',
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? '',
});

export const authEmulatorHost = () => process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST ?? null;

/** Shared secret the job runner must present. Prevents anyone poking the worker endpoint. */
export const jobRunnerSecret = (): string => required('JOB_RUNNER_SECRET');

/** Session cookie lifetime. Firebase caps session cookies at 14 days. */
export const sessionMaxAgeMs = Number(optional('SESSION_MAX_AGE_MS') ?? 5 * 24 * 60 * 60 * 1000);

// --- AI adapters ------------------------------------------------------------
// "mock" is a real, deterministic adapter used for development and tests. It is
// never silently substituted for a configured provider: if a provider IS
// configured and fails, the UI reports the failure and falls back to the form.
export type LlmProviderName = 'mock' | 'anthropic' | 'openai' | 'google';
export type TranscriptionProviderName = 'mock' | 'openai' | 'google' | 'browser';

export const aiConfig = () => ({
  enabled: (optional('AI_ENABLED') ?? 'true') !== 'false',
  llmProvider: (optional('AI_LLM_PROVIDER') ?? 'mock') as LlmProviderName,
  llmModel: optional('AI_LLM_MODEL'),
  llmApiKey: optional('AI_LLM_API_KEY'),
  llmBaseUrl: optional('AI_LLM_BASE_URL'),
  transcriptionProvider: (optional('AI_TRANSCRIPTION_PROVIDER') ?? 'mock') as TranscriptionProviderName,
  transcriptionModel: optional('AI_TRANSCRIPTION_MODEL'),
  transcriptionApiKey: optional('AI_TRANSCRIPTION_API_KEY'),
  timeoutMs: Number(optional('AI_TIMEOUT_MS') ?? 20_000),
  maxInputChars: Number(optional('AI_MAX_INPUT_CHARS') ?? 1200),
  maxAudioBytes: Number(optional('AI_MAX_AUDIO_BYTES') ?? 8 * 1024 * 1024),
  /** Per-business request budget, enforced server-side. */
  maxRequestsPerHour: Number(optional('AI_MAX_REQUESTS_PER_HOUR') ?? 60),
  maxRequestsPerDay: Number(optional('AI_MAX_REQUESTS_PER_DAY') ?? 300),
});

// --- GST filing provider (GSP) ---------------------------------------------
export type GspMode = 'unconfigured' | 'sandbox' | 'production';

export const gspConfig = () => {
  const mode = (optional('GSP_MODE') ?? 'unconfigured') as GspMode;
  return {
    mode,
    baseUrl: optional('GSP_BASE_URL'),
    clientId: optional('GSP_CLIENT_ID'),
    clientSecret: optional('GSP_CLIENT_SECRET'),
    providerName: optional('GSP_PROVIDER_NAME'),
    /** Production filing stays off unless BOTH the mode and this flag say so. */
    productionEnabled: optional('GSP_PRODUCTION_ENABLED') === 'true' && mode === 'production',
  };
};

export const pdfConfig = () => ({
  /** Playwright Chromium path. Set in containers where the browser is preinstalled. */
  chromiumExecutablePath: optional('PLAYWRIGHT_CHROMIUM_PATH'),
});

export const appBaseUrl = (): string => optional('APP_BASE_URL') ?? 'http://localhost:3000';
