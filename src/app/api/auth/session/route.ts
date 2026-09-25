import { NextResponse } from 'next/server';

import { createSession, destroySession } from '@/server/auth/session';
import { ensureUserRecord } from '@/server/repos/business';

export const runtime = 'nodejs';

/**
 * Exchange a Firebase ID token for an httpOnly session cookie.
 *
 * The browser never stores a long-lived credential itself, and the ID token is
 * not retained by us. Verification happens with the Admin SDK, so a forged or
 * expired token cannot open a session.
 */
export async function POST(request: Request) {
  let idToken: unknown;
  try {
    const body = (await request.json()) as { idToken?: unknown };
    idToken = body.idToken;
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  if (typeof idToken !== 'string' || idToken.length < 20 || idToken.length > 8192) {
    return NextResponse.json({ error: 'Invalid sign-in token.' }, { status: 400 });
  }

  try {
    const user = await createSession(idToken);
    await ensureUserRecord({ uid: user.uid, email: user.email, displayName: user.name });
    return NextResponse.json({ ok: true, uid: user.uid });
  } catch (error) {
    // Deliberately generic: token verification failures should not describe
    // exactly which check failed.
    const message = error instanceof Error && error.message === 'Please sign in again.'
      ? error.message
      : 'Could not sign in. Please try again.';
    return NextResponse.json({ error: message }, { status: 401 });
  }
}

export async function DELETE() {
  await destroySession();
  return NextResponse.json({ ok: true });
}
