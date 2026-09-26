'use client';

import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  connectAuthEmulator,
  getAuth,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  type Auth,
  type ConfirmationResult,
} from 'firebase/auth';

import { authEmulatorHost, publicFirebaseConfig, type PublicFirebaseConfig } from '@/lib/env';

/**
 * Firebase Auth is the managed authentication provider, and the phone is the
 * identity: the owner types their number, Firebase sends an OTP by SMS, the
 * owner types it back. No password to choose, forget or reset.
 *
 * The browser's job ends at obtaining a Firebase ID token. That token is POSTed
 * once to our own server, which verifies it with the Admin SDK and exchanges it
 * for an httpOnly session cookie. The ID token is never stored by us, and the
 * browser never talks to Firestore.
 */

let authInstance: Auth | null = null;

/**
 * The config the server handed us for this request.
 *
 * Next inlines `NEXT_PUBLIC_*` into the browser bundle at build time, so a
 * host that supplies them only at runtime ships a bundle with four empty
 * strings. Rather than depend on when the values happen to arrive, the root
 * layout reads them on the server -- where the whole environment is always
 * visible -- and passes them down. The build-time values remain as the
 * fallback, which is what local development uses.
 */
let supplied: PublicFirebaseConfig | null = null;

export function setFirebaseConfig(config: PublicFirebaseConfig): void {
  if (config?.projectId) supplied = config;
}

export function firebaseAuth(): Auth {
  const config = supplied ?? publicFirebaseConfig();
  if (!config.projectId) {
    throw new Error(
      'Firebase Web config is missing. Locally, set NEXT_PUBLIC_FIREBASE_* in .env.local ' +
        '(see docs/setup.md). On a deployed instance, see docs/deployment.md.',
    );
  }
  const app = getApps().length ? getApp() : initializeApp(config);
  if (!authInstance) {
    authInstance = getAuth(app);
    const emulator = authEmulatorHost();
    if (emulator) {
      // Local development only. Never reached when the env var is absent.
      // Connecting to the emulator also switches the reCAPTCHA below to a
      // mock, so no Google script is loaded and any number gets an OTP that
      // the emulator prints and exposes on its REST API.
      connectAuthEmulator(authInstance, `http://${emulator}`, { disableWarnings: true });
    }
  }
  return authInstance;
}

/**
 * Firebase requires proof that a browser, not a script, is asking for an SMS.
 * The invisible reCAPTCHA does that without the owner seeing anything unless
 * Google is unsure about them. One verifier per page; it is torn down and
 * rebuilt on a retry because a used one cannot be reused.
 */
let verifier: RecaptchaVerifier | null = null;

function freshVerifier(containerId: string): RecaptchaVerifier {
  verifier?.clear();
  verifier = new RecaptchaVerifier(firebaseAuth(), containerId, { size: 'invisible' });
  return verifier;
}

/**
 * Send an OTP to a phone number in E.164 form ("+919876543210").
 *
 * Returns the confirmation to hand to `finishPhoneSignIn` along with what the
 * owner types. `containerId` names an empty element the reCAPTCHA can attach
 * itself to; it stays invisible in the normal case.
 */
export async function startPhoneSignIn(phoneE164: string, containerId: string): Promise<ConfirmationResult> {
  try {
    return await signInWithPhoneNumber(firebaseAuth(), phoneE164, freshVerifier(containerId));
  } catch (error) {
    // A failed attempt leaves the widget in a state Firebase will not reuse.
    verifier?.clear();
    verifier = null;
    throw error;
  }
}

/** Confirm the OTP. Resolves to the ID token our server exchanges for a session. */
export async function finishPhoneSignIn(confirmation: ConfirmationResult, code: string): Promise<string> {
  const result = await confirmation.confirm(code);
  return result.user.getIdToken();
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
