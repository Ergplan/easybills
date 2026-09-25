import 'server-only';

import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

import { firebaseProjectId, usingEmulators } from '@/lib/env';

/**
 * The Firebase Admin SDK is the ONLY path to Firestore in this application.
 *
 * Browsers never read or write Firestore directly: `firestore.rules` denies all
 * client access, and every business record is reached through a server route
 * that has already resolved the caller's session and checked membership of the
 * business being touched. That makes tenant isolation a server-side invariant
 * rather than a rules-file guess.
 */

let appInstance: App | null = null;

function credentials() {
  // Emulators need no credentials -- and must not be given real ones.
  if (usingEmulators) return undefined;
  const inline = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (inline && inline.trim()) {
    const parsed = JSON.parse(inline) as { project_id: string; client_email: string; private_key: string };
    return cert({
      projectId: parsed.project_id,
      clientEmail: parsed.client_email,
      // Secrets stored in env vars commonly arrive with escaped newlines.
      privateKey: parsed.private_key.replace(/\\n/g, '\n'),
    });
  }
  // Otherwise fall back to Application Default Credentials
  // (GOOGLE_APPLICATION_CREDENTIALS, or the metadata server on Google infra).
  return undefined;
}

export function adminApp(): App {
  if (appInstance) return appInstance;
  const existing = getApps();
  if (existing.length) {
    appInstance = existing[0]!;
    return appInstance;
  }
  const cred = credentials();
  appInstance = initializeApp({
    projectId: firebaseProjectId(),
    ...(cred ? { credential: cred } : {}),
  });
  return appInstance;
}

let dbInstance: Firestore | null = null;

export function db(): Firestore {
  if (!dbInstance) {
    const instance = getFirestore(adminApp());
    try {
      instance.settings({ ignoreUndefinedProperties: true });
    } catch {
      // `settings()` may only be called once per Firestore instance. In dev the
      // module is re-evaluated by hot reload while the instance survives, so a
      // second call throws -- and the settings from the first call still apply.
    }
    dbInstance = instance;
  }
  return dbInstance;
}

export function adminAuth(): Auth {
  return getAuth(adminApp());
}

export { FieldValue, Timestamp } from 'firebase-admin/firestore';
