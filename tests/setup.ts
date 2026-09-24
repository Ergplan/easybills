/**
 * Test environment.
 *
 * Integration tests run against the local Firebase emulator suite, never against
 * a real project. The guard below refuses to run if the emulator host is absent,
 * so a misconfigured CI job cannot write test data into production.
 */
process.env.FIREBASE_PROJECT_ID ??= 'easybills-dev';
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ??= 'easybills-dev';
process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';
process.env.JOB_RUNNER_SECRET ??= 'test-secret';
process.env.AI_LLM_PROVIDER ??= 'mock';
process.env.AI_TRANSCRIPTION_PROVIDER ??= 'mock';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('Refusing to run tests without FIRESTORE_EMULATOR_HOST set.');
}
