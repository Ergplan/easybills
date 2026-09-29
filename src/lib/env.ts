/**
 * Environment configuration, validated once at first use.
 *
 * Rules this file enforces:
 *  - No secret is ever read into a module that the browser bundle can import.
 *    Only `NEXT_PUBLIC_*` values are exposed client-side, and the Firebase Web
 *    config is public by design (it identifies the sign-in project; it grants
 *    nothing, because the browser never touches the database).
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

/**
 * The Postgres database that holds every business record.
 *
 * On the VM it is the `db` service of the compose stack; locally it is the
 * throwaway cluster `scripts/local-postgres.sh` starts. There is no default:
 * a server that does not know where its books are should not start guessing.
 */
export const databaseUrl = (): string => required('DATABASE_URL');

/**
 * True when sign-in talks to the local Firebase Auth emulator. Sign-in is the
 * only thing Firebase still does here; the records live in Postgres.
 */
export const usingAuthEmulator = Boolean(optional('FIREBASE_AUTH_EMULATOR_HOST'));

/**
 * The project this server talks to.
 *
 * On Google infrastructure -- App Hosting, Cloud Run, Cloud Functions -- the
 * platform already says which project it is running in, so a deployment there
 * does not have to repeat it and cannot get it wrong. Everywhere else it is
 * configured, and a missing value still fails loudly.
 */
export const firebaseProjectId = (): string =>
  optional('FIREBASE_PROJECT_ID') ??
  optional('NEXT_PUBLIC_FIREBASE_PROJECT_ID') ??
  optional('GOOGLE_CLOUD_PROJECT') ??
  optional('GCLOUD_PROJECT') ??
  required('FIREBASE_PROJECT_ID');

export interface PublicFirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
}

/**
 * Public Firebase Web config. Safe to ship to the browser -- it identifies the
 * sign-in project, it does not grant anything, and the browser never talks to
 * the database regardless.
 *
 * Read on the server at request time, where the whole environment is visible.
 * The browser is handed the result rather than reading it itself: Next inlines
 * `NEXT_PUBLIC_*` into the client bundle at BUILD time, so a host that supplies
 * these only at runtime -- which Firebase App Hosting may -- produces a bundle
 * with four empty strings and a sign-in page that cannot sign anyone in.
 */
export const publicFirebaseConfig = (): PublicFirebaseConfig => {
  const fromEnv: PublicFirebaseConfig = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? '',
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? '',
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? '',
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? '',
  };
  if (fromEnv.projectId) return fromEnv;

  // Firebase App Hosting creates a Web App for the backend and describes it
  // here. Nothing to copy, and nothing to get wrong.
  const injected = optional('FIREBASE_WEBAPP_CONFIG');
  if (injected) {
    try {
      const c = JSON.parse(injected) as Partial<PublicFirebaseConfig>;
      if (c.projectId) {
        return {
          apiKey: c.apiKey ?? '',
          authDomain: c.authDomain ?? `${c.projectId}.firebaseapp.com`,
          projectId: c.projectId,
          appId: c.appId ?? '',
        };
      }
    } catch {
      // Fall through to the empty config; the sign-in page says what is missing.
    }
  }
  return fromEnv;
};

export const authEmulatorHost = () => process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST ?? null;

/**
 * Open access: no sign-in, everybody is the same test user.
 *
 * For showing the app to somebody without first setting up Firebase Auth, and
 * for poking at it before there is anything real in it. It is not a
 * configuration so much as a decision, so it is deliberately awkward: it must
 * be the exact string 'true', it is off unless set, and when it is on the app
 * says so on every screen.
 *
 * What it means, stated plainly: there is no sign-in, so anyone who has the
 * address is the owner. They can read every bill, issue new ones and record
 * payments. Never leave it on with a real business's books behind it.
 */
export const openAccess = (): boolean => optional('AUTH_BYPASS') === 'true';

/** The one user everybody is in open-access mode. Stable, so the data persists. */
export const OPEN_ACCESS_UID = 'open-access-test-user';

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

// --- Voice: talk to the app ---------------------------------------------------
/**
 * Speech in, speech out, over OpenAI's Realtime API. The browser connects to
 * OpenAI directly (WebRTC), using a short-lived client secret this server
 * mints from the real key; the real key never leaves the server. Off unless a
 * key is configured, and the screen says so rather than failing on tap.
 */
export const voiceConfig = () => ({
  enabled: (optional('VOICE_ENABLED') ?? 'true') !== 'false' && optional('OPENAI_API_KEY') !== null,
  apiKey: optional('OPENAI_API_KEY'),
  model: optional('OPENAI_REALTIME_MODEL') ?? 'gpt-realtime',
  voice: optional('OPENAI_REALTIME_VOICE') ?? 'marin',
  baseUrl: optional('OPENAI_BASE_URL') ?? 'https://api.openai.com',
});

/**
 * Reading contract terms with a model, for "Mera bill thoda complex hai".
 * Same OpenAI key as voice; without it the app's own rules read the terms.
 * Either way the owner sees what was read and confirms it.
 */
export const contractReaderConfig = () => ({
  enabled: optional('OPENAI_API_KEY') !== null && (optional('CONTRACT_READER_ENABLED') ?? 'true') !== 'false',
  apiKey: optional('OPENAI_API_KEY'),
  model: optional('OPENAI_TEXT_MODEL') ?? 'gpt-4.1-mini',
  baseUrl: optional('OPENAI_BASE_URL') ?? 'https://api.openai.com',
  timeoutMs: Number(optional('CONTRACT_READER_TIMEOUT_MS') ?? 15_000),
});

// --- Docling: reading photos and scans of old bills --------------------------
/**
 * A docling-serve container that reads a scanned PDF or a phone photo of a
 * bill (layout, tables and OCR) and hands back its text. On the VM it is the
 * `docling` service of the compose stack and is never exposed outside it.
 * Unset, a typed PDF or a spreadsheet still works; a photo is refused with a
 * sentence rather than guessed at.
 */
export const doclingConfig = () => ({
  url: optional('DOCLING_URL'),
  apiKey: optional('DOCLING_API_KEY'),
  timeoutMs: Number(optional('DOCLING_TIMEOUT_MS') ?? 180_000),
  /** BCP-47 tags, in order of preference. Bills here are English with the odd Hindi line. */
  ocrLanguages: (optional('DOCLING_OCR_LANGS') ?? 'en,hi').split(',').map((l) => l.trim()).filter(Boolean),
});

export const pdfConfig = () => ({
  /** Playwright Chromium path. Set in containers where the browser is preinstalled. */
  chromiumExecutablePath: optional('PLAYWRIGHT_CHROMIUM_PATH'),
});

/*
 * There is deliberately no APP_BASE_URL here.
 *
 * Every link this app produces is relative -- the share link on a bill, the
 * PDF a customer opens -- so it is correct on localhost, on a preview URL and
 * on a custom domain without being told which it is. A configured base URL
 * would be one more value that can be set wrongly, and whose being wrong shows
 * up as a customer opening a link to somebody's laptop.
 */
