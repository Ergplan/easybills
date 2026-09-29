import 'server-only';

import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';

import { firebaseProjectId, usingAuthEmulator } from '@/lib/env';

/**
 * Firebase is used for one thing: phone sign-in. It verifies the OTP and hands
 * the server a token, which the server exchanges for its own session cookie.
 * Every business record lives in Postgres (src/server/db).
 */

let appInstance: App | null = null;

function credentials() {
  // The emulator needs no credentials -- and must not be given real ones.
  if (usingAuthEmulator) return undefined;
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
  // Otherwise Application Default Credentials (the VM's service account).
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

export function adminAuth(): Auth {
  return getAuth(adminApp());
}
