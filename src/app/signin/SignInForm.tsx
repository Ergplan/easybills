'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import {
  establishServerSession,
  registerWithPassword,
  sendReset,
  signInWithGoogle,
  signInWithPassword,
} from '@/lib/firebase/client';

type Mode = 'sign-in' | 'create';

/**
 * Sign-in is deliberately plain: an email and a password, or Google.
 *
 * Firebase Auth does the work. We do not implement password storage, reset
 * flows or token refresh ourselves.
 *
 * Both methods are always offered, because whether a provider is switched on
 * lives in the Firebase project and not in anything this page can see. What
 * matters is that being switched off says so in words an owner can act on --
 * see `friendlyAuthError` -- rather than showing them the raw
 * `auth/configuration-not-found` that Firebase raises.
 */
export function SignInForm() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function run(fn: () => Promise<string>, method: 'password' | 'google' = 'password') {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const idToken = await fn();
      await establishServerSession(idToken);
      router.replace('/home');
      router.refresh();
    } catch (e) {
      setError(friendlyAuthError(e, method));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card stack">
      <div className="segmented" role="group" aria-label="Sign in or create an account">
        <button
          type="button"
          className="segmented__option"
          aria-pressed={mode === 'sign-in'}
          onClick={() => { setMode('sign-in'); setError(null); }}
        >
          Sign in
        </button>
        <button
          type="button"
          className="segmented__option"
          aria-pressed={mode === 'create'}
          onClick={() => { setMode('create'); setError(null); }}
        >
          Create account
        </button>
      </div>

      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() =>
            mode === 'sign-in' ? signInWithPassword(email.trim(), password) : registerWithPassword(email.trim(), password),
          );
        }}
      >
        <div className="field">
          <label className="field__label" htmlFor="email">Email</label>
          <input
            id="email"
            className="input"
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div className="field">
          <label className="field__label" htmlFor="password">Password</label>
          <input
            id="password"
            className="input"
            type="password"
            autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {mode === 'create' && <span className="field__hint">At least 8 characters.</span>}
        </div>

        {error && (
          <div className="notice notice--danger" role="alert">
            <span className="notice__icon" aria-hidden="true">!</span>
            <span>{error}</span>
          </div>
        )}
        {info && (
          <div className="notice notice--ok" role="status">
            <span className="notice__icon" aria-hidden="true">✓</span>
            <span>{info}</span>
          </div>
        )}

        <button type="submit" className="btn btn--primary btn--block btn--large" disabled={busy}>
          {busy ? <span className="spinner" aria-hidden="true" /> : null}
          {mode === 'sign-in' ? 'Sign in' : 'Create account'}
        </button>
      </form>

      <div className="row" style={{ gap: 10 }}>
        <hr className="divider grow" />
        <span className="faint">or</span>
        <hr className="divider grow" />
      </div>

      <button type="button" className="btn btn--secondary btn--block" disabled={busy} onClick={() => void run(signInWithGoogle, 'google')}>
        Continue with Google
      </button>

      {mode === 'sign-in' && (
        <button
          type="button"
          className="btn btn--ghost"
          disabled={busy || !email.trim()}
          onClick={async () => {
            setError(null);
            try {
              await sendReset(email.trim());
              setInfo('If that email has an account, a reset link is on its way.');
            } catch (e) {
              setError(friendlyAuthError(e));
            }
          }}
        >
          Forgot password?
        </button>
      )}
    </div>
  );
}

function friendlyAuthError(e: unknown, method: 'password' | 'google' = 'password'): string {
  const code = (e as { code?: string })?.code ?? '';
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'That email and password do not match.';
    case 'auth/email-already-in-use':
      return 'That email already has an account. Try signing in.';
    case 'auth/weak-password':
      return 'Please choose a longer password — at least 8 characters.';
    // Raised when the sign-in method is not switched on in the Firebase
    // project, and when Authentication has never been set up there at all.
    // An owner cannot fix either, so it says who can rather than showing them
    // a code, and names the method so the person who can knows which to enable.
    case 'auth/configuration-not-found':
    case 'auth/operation-not-allowed':
      return method === 'google'
        ? 'Signing in with Google is not switched on for this app yet. Use your email and password, ' +
          'or ask whoever looks after this app to enable it.'
        : 'Signing in with an email and password is not switched on for this app yet. Please ask ' +
          'whoever looks after this app to enable it.';
    case 'auth/popup-closed-by-user':
      return 'Sign-in was cancelled.';
    case 'auth/network-request-failed':
      return 'No internet connection. Please try again.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a minute and try again.';
    default:
      return e instanceof Error ? e.message : 'Could not sign in. Please try again.';
  }
}
