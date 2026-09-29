import { NextResponse } from 'next/server';

import { openAccess, publicFirebaseConfig, usingAuthEmulator, voiceConfig } from '@/lib/env';
import { pool } from '@/server/db/pool';
import { doclingHealth } from '@/server/import/docling';
import { pdfCapability } from '@/server/pdf/render';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * What this installation can actually do, and what it cannot.
 *
 * The first thing to open after a rollout. It reports state, never secrets:
 * whether Postgres answered and which schema version it is on, whether a
 * browser is available for PDFs, which optional services are wired. There is
 * no key, password or connection string anywhere in the response, and an
 * error is the driver's code and a short message, not a stack trace.
 */
export async function GET() {
  const checks: Record<string, unknown> = {
    builtAt: process.env.NEXT_PUBLIC_BUILD_STAMP ?? 'unknown',
    // Plain ASCII: this is read in terminals that do not all agree an
    // unlabelled JSON body is UTF-8.
    signIn: openAccess() ? 'switched off - OPEN ACCESS, anyone can read and write' : 'required',
    authEmulator: usingAuthEmulator,
    webConfig: publicFirebaseConfig().projectId ? 'present' : 'MISSING',
    voice: voiceConfig().enabled ? `configured (${voiceConfig().model})` : 'off - no OPENAI_API_KEY',
  };

  // The one that matters: every page reads Postgres before it renders.
  // Under a timeout, so an unreachable database is reported rather than
  // turning this request into the same hang it exists to explain.
  try {
    const { rows } = await withTimeout(
      pool().query<{ version: string | null }>('select max(version) as version from schema_migrations'),
      8000,
    );
    checks.database = 'ok';
    checks.schema = rows[0]?.version ?? 'none';
  } catch (error) {
    const e = error as { code?: string; message?: string };
    checks.database = 'FAILED';
    checks.databaseError = {
      code: String(e.code ?? 'unknown'),
      message: (e.message ?? String(error)).slice(0, 300),
      hint: hintFor(e),
    };
  }

  try {
    const pdf = await pdfCapability();
    checks.pdfs = pdf.ok ? 'ok' : `FAILED - ${pdf.detail}`;
  } catch {
    checks.pdfs = 'FAILED - could not be checked';
  }

  // Optional: without it, photos of bills are refused with a sentence.
  checks.docling = await doclingHealth();

  const ok = checks.database === 'ok';
  return NextResponse.json(
    { ok, ...checks },
    { status: ok ? 200 : 503, headers: { 'content-type': 'application/json; charset=utf-8' } },
  );
}

class TimeoutError extends Error {
  readonly code = 'TIMEOUT';
  constructor(ms: number) {
    super(`No response from Postgres within ${ms}ms.`);
  }
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    work,
    new Promise<never>((_, reject) => setTimeout(() => reject(new TimeoutError(ms)), ms)),
  ]);
}

/** The things that actually go wrong on a first deployment. */
function hintFor(e: { code?: string; message?: string }): string {
  const text = `${e.code ?? ''} ${e.message ?? ''}`;
  if (/42P01|schema_migrations.*does not exist/i.test(text)) {
    return 'The database is reachable but empty. Run the migrations: node db/migrate.mjs (the app container does this on start).';
  }
  if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|TIMEOUT/i.test(text)) {
    return 'Postgres is not answering at DATABASE_URL. On the VM: docker compose -p ekbill ps, and check the db service is healthy.';
  }
  if (/28P01|28000|password authentication/i.test(text)) {
    return 'Postgres refused the credentials in DATABASE_URL. The password must match the ekbill-db-password secret.';
  }
  if (/3D000/i.test(text)) {
    return 'The database named in DATABASE_URL does not exist.';
  }
  if (/DATABASE_URL/i.test(text)) {
    return 'DATABASE_URL is not set on this server.';
  }
  return 'See docs/deployment.md.';
}
