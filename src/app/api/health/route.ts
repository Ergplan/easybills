import { NextResponse } from 'next/server';

import {
  backgroundWorkConfigured,
  firebaseProjectId,
  firestoreDatabaseId,
  openAccess,
  publicFirebaseConfig,
  usingEmulators,
} from '@/lib/env';
import { db } from '@/server/firebase/admin';
import { pdfCapability } from '@/server/pdf/render';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * What this installation can actually do, and what it cannot.
 *
 * A deployment that cannot reach its database returns a blank 500 with a
 * request id, and finding out why means going to Cloud Logging. This says it
 * directly, in one request, so the first thing to try after a bad rollout is
 * opening /api/health rather than digging.
 *
 * It reports state, never secrets: which project, whether Firestore answered
 * and with what error code if it did not, whether a browser is available for
 * PDFs. There is no key, token or credential anywhere in the response, and the
 * error text is the provider's own code and message -- "NOT_FOUND",
 * "PERMISSION_DENIED" -- not a stack trace.
 */
export async function GET() {
  const checks: Record<string, unknown> = {
    projectId: firebaseProjectId(),
    database: firestoreDatabaseId() ?? '(default)',
    usingEmulators,
    signIn: openAccess() ? 'switched off — open access' : 'required',
    webConfig: publicFirebaseConfig().projectId ? 'present' : 'MISSING',
    backgroundWork: backgroundWorkConfigured() ? 'configured' : 'not configured',
  };

  // The one that matters. Every page reads Firestore before it renders
  // anything, so if this fails, nothing in the app works.
  //
  // Under a timeout, because an unreachable Firestore does not fail -- it
  // retries, and the request hangs until the platform gives up and returns a
  // blank 500 with a request id. That is the very failure this endpoint exists
  // to explain, so it must not fail the same way itself.
  try {
    // A read of a document that need not exist. Cheap, and it still proves the
    // database is reachable and this service is allowed to read it.
    await withTimeout(db().collection('_health').doc('probe').get(), 8000);
    checks.firestore = 'ok';
  } catch (error) {
    const e = error as { code?: string | number; message?: string };
    checks.firestore = 'FAILED';
    checks.firestoreError = {
      code: String(e.code ?? 'unknown'),
      message: (e.message ?? String(error)).slice(0, 300),
      hint: hintFor(e),
    };
  }

  try {
    const pdf = await pdfCapability();
    checks.pdfs = pdf.ok ? 'ok' : `FAILED — ${pdf.detail}`;
  } catch {
    checks.pdfs = 'FAILED — could not be checked';
  }

  const ok = checks.firestore === 'ok';
  return NextResponse.json({ ok, ...checks }, { status: ok ? 200 : 503 });
}

class TimeoutError extends Error {
  readonly code = 'TIMEOUT';
  constructor(ms: number) {
    super(`No response from Firestore within ${ms}ms.`);
  }
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    work,
    new Promise<never>((_, reject) => setTimeout(() => reject(new TimeoutError(ms)), ms)),
  ]);
}

/** The things that actually go wrong on a first deployment. */
function hintFor(e: { code?: string | number; message?: string }): string {
  const text = `${e.code ?? ''} ${e.message ?? ''}`;
  if (/NOT_FOUND|5 NOT_FOUND|database.*does not exist/i.test(text)) {
    return 'No Firestore database exists in this project yet. Create one in ' +
      'Firebase Console > Firestore Database > Create database, in Native mode.';
  }
  if (/PERMISSION_DENIED|7 PERMISSION_DENIED|IAM/i.test(text)) {
    return 'This service cannot read Firestore. Grant its service account ' +
      '(firebase-app-hosting-compute@…) the Cloud Datastore User role in IAM.';
  }
  if (/database.*not found|NOT_FOUND.*database|does not exist/i.test(text)) {
    return 'The project has no database by that name. Check FIRESTORE_DATABASE_ID ' +
      'against Firebase Console > Firestore Database: a database named something ' +
      'other than (default) must be named here exactly.';
  }
  if (/INVALID_ARGUMENT|not supported|unimplemented|UNIMPLEMENTED/i.test(text)) {
    return 'The database rejected a normal Firestore call. Check its EDITION in ' +
      'Firebase Console: this app speaks the Firestore API and uses Firestore ' +
      'security rules, which is Standard edition. Enterprise edition is the ' +
      'MongoDB-compatible offering and is a different query surface.';
  }
  if (/TIMEOUT/i.test(text)) {
    return 'Firestore did not answer at all. That is usually no database in ' +
      'this project yet: create one in Firebase Console > Firestore Database > ' +
      'Create database, in Native mode. An unreachable Firestore does not ' +
      'error, it retries, which is why the app returns a blank server error ' +
      'rather than a message.';
  }
  if (/UNAUTHENTICATED|credential/i.test(text)) {
    return 'No usable credentials. On Google infrastructure this should come ' +
      'from the service account automatically; check the backend is running as one.';
  }
  return 'See docs/deployment.md.';
}
