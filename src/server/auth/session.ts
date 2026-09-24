import 'server-only';

import { cookies } from 'next/headers';

import { sessionMaxAgeMs, runtime } from '@/lib/env';
import { adminAuth } from '@/server/firebase/admin';

export const SESSION_COOKIE = 'eb_session';

export interface SessionUser {
  uid: string;
  email: string | null;
  name: string | null;
  emailVerified: boolean;
}

/**
 * Exchange a freshly-minted Firebase ID token for a session cookie.
 *
 * `createSessionCookie` verifies the ID token's signature, audience and expiry
 * server-side before minting the cookie, so a forged token cannot create a
 * session. We additionally refuse tokens older than five minutes, which limits
 * the window in which a leaked ID token is useful.
 */
export async function createSession(idToken: string): Promise<SessionUser> {
  const auth = adminAuth();
  const decoded = await auth.verifyIdToken(idToken, true);
  const ageMs = Date.now() - decoded.auth_time * 1000;
  if (ageMs > 5 * 60 * 1000) {
    throw new Error('Please sign in again.');
  }
  // Firebase caps session cookies at 14 days.
  const expiresIn = Math.min(sessionMaxAgeMs, 14 * 24 * 60 * 60 * 1000);
  const cookie = await auth.createSessionCookie(idToken, { expiresIn });
  const store = await cookies();
  store.set(SESSION_COOKIE, cookie, {
    httpOnly: true,
    secure: runtime === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: Math.floor(expiresIn / 1000),
  });
  return {
    uid: decoded.uid,
    email: decoded.email ?? null,
    name: (decoded.name as string | undefined) ?? null,
    emailVerified: Boolean(decoded.email_verified),
  };
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const existing = store.get(SESSION_COOKIE)?.value;
  store.delete(SESSION_COOKIE);
  if (existing) {
    // Revoke refresh tokens so the session cannot be resurrected elsewhere.
    try {
      const decoded = await adminAuth().verifySessionCookie(existing, false);
      await adminAuth().revokeRefreshTokens(decoded.uid);
    } catch {
      // An already-invalid cookie needs no revocation.
    }
  }
}

/** The signed-in user, or null. Checks revocation on every request. */
export async function currentUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const cookie = store.get(SESSION_COOKIE)?.value;
  if (!cookie) return null;
  try {
    const decoded = await adminAuth().verifySessionCookie(cookie, true);
    return {
      uid: decoded.uid,
      email: decoded.email ?? null,
      name: (decoded.name as string | undefined) ?? null,
      emailVerified: Boolean(decoded.email_verified),
    };
  } catch {
    return null;
  }
}

export class NotAuthenticatedError extends Error {
  constructor() {
    super('Please sign in.');
    this.name = 'NotAuthenticatedError';
  }
}

export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) throw new NotAuthenticatedError();
  return user;
}
