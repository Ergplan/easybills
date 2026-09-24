'use client';

import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  connectAuthEmulator,
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  type Auth,
} from 'firebase/auth';

import { authEmulatorHost, publicFirebaseConfig } from '@/lib/env';

/**
 * Firebase Auth is the managed authentication provider. We do not implement
 * password hashing, token minting, reset flows or session rotation ourselves.
 *
 * The browser's job ends at obtaining a Firebase ID token. That token is POSTed
 * once to our own server, which verifies it with the Admin SDK and exchanges it
 * for an httpOnly session cookie. The ID token is never stored by us, and the
 * browser never talks to Firestore.
 */

let authInstance: Auth | null = null;

export function firebaseAuth(): Auth {
  const config = publicFirebaseConfig();
  if (!config.projectId) {
    throw new Error(
      'Firebase Web config is missing. Set NEXT_PUBLIC_FIREBASE_* in .env.local (see docs/setup.md).',
    );
  }
  const app = getApps().length ? getApp() : initializeApp(config);
  if (!authInstance) {
    authInstance = getAuth(app);
    const emulator = authEmulatorHost();
    if (emulator) {
      // Local development only. Never reached when the env var is absent.
      connectAuthEmulator(authInstance, `http://${emulator}`, { disableWarnings: true });
    }
  }
  return authInstance;
}

export async function signInWithGoogle(): Promise<string> {
  const provider = new GoogleAuthProvider();
  const result = await signInWithPopup(firebaseAuth(), provider);
  return result.user.getIdToken();
}

export async function signInWithPassword(email: string, password: string): Promise<string> {
  const result = await signInWithEmailAndPassword(firebaseAuth(), email, password);
  return result.user.getIdToken();
}

export async function registerWithPassword(email: string, password: string): Promise<string> {
  const result = await createUserWithEmailAndPassword(firebaseAuth(), email, password);
  return result.user.getIdToken();
}

export async function sendReset(email: string): Promise<void> {
  await sendPasswordResetEmail(firebaseAuth(), email);
}

/** Hand the ID token to our server, which sets the httpOnly session cookie. */
export async function establishServerSession(idToken: string): Promise<void> {
  const res = await fetch('/api/auth/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ idToken }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? 'Could not sign in. Please try again.');
  }
}

export async function endServerSession(): Promise<void> {
  await fetch('/api/auth/session', { method: 'DELETE' });
  await firebaseAuth().signOut().catch(() => undefined);
}
