/**
 * Test environment.
 *
 * Integration tests run against a local Postgres database named `ekbill_test`
 * (scripts/local-postgres.sh starts one), never against a deployed one. The
 * guard below refuses any DATABASE_URL whose database is not a test database,
 * so a misconfigured run cannot write fixtures into real books.
 */
process.env.DATABASE_URL ??= 'postgres://postgres@127.0.0.1:5440/ekbill_test';
process.env.FIREBASE_PROJECT_ID ??= 'easybills-dev';
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ??= 'easybills-dev';
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';
process.env.AI_LLM_PROVIDER ??= 'mock';
process.env.AI_TRANSCRIPTION_PROVIDER ??= 'mock';

if (!/\/[a-z0-9_]*test[a-z0-9_]*(\?|$)/.test(process.env.DATABASE_URL)) {
  throw new Error(`Refusing to run tests against ${process.env.DATABASE_URL}: the database name must contain "test".`);
}
