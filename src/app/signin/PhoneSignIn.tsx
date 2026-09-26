'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { ConfirmationResult } from 'firebase/auth';

import { t } from '@/lib/copy';
import { formatPhone, toE164 } from '@/lib/domain/profile';
import { establishServerSession, finishPhoneSignIn, startPhoneSignIn } from '@/lib/firebase/client';

type Stage = 'phone' | 'otp';

const RECAPTCHA_SLOT = 'recaptcha-slot';

/**
 * Two screens, one thing each. The number, then the OTP.
 *
 * No account to create, no password to invent. The number the owner types is
 * the one they will be reminded to use, and the one printed on their bills.
 *
 * The OTP screen submits itself the moment six digits are in, because the
 * owner is usually reading the code off a notification and typing it with
 * the other thumb; a Continue button after that is one tap too many.
 */
export function PhoneSignIn() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>('phone');
  const [digits, setDigits] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const confirmation = useRef<ConfirmationResult | null>(null);
  const codeInput = useRef<HTMLInputElement>(null);

  const phone = toE164(digits);

  async function sendOtp(announce: boolean) {
    if (!phone) {
      setError(t('error.phone'));
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      confirmation.current = await startPhoneSignIn(phone, RECAPTCHA_SLOT);
      setCode('');
      setStage('otp');
      if (announce) setNotice(t('auth.otp.sent'));
    } catch (e) {
      setError(friendlyAuthError(e));
    } finally {
      setBusy(false);
    }
  }

  async function verify(otp: string) {
    if (!confirmation.current) return;
    if (!/^\d{6}$/.test(otp)) {
      setError(t('auth.otp.short'));
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const idToken = await finishPhoneSignIn(confirmation.current, otp);
      await establishServerSession(idToken);
      router.replace('/home');
      router.refresh();
    } catch (e) {
      const codeName = (e as { code?: string })?.code ?? '';
      if (codeName === 'auth/code-expired') {
        // Nothing for the owner to do about an expired code except get a new
        // one, so get it for them and say so.
        setBusy(false);
        await sendOtp(false);
        setNotice(t('auth.otp.expired'));
        return;
      }
      setError(friendlyAuthError(e));
      setCode('');
      setBusy(false);
    }
  }

  useEffect(() => {
    if (stage === 'otp') codeInput.current?.focus();
  }, [stage]);

  return (
    <div className="card stack">
      {stage === 'phone' ? (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void sendOtp(true);
          }}
        >
          <div className="stack" style={{ gap: 4 }}>
            <h1 className="signin__title">{t('auth.phone.title')}</h1>
            <p className="muted">{t('auth.phone.sub')}</p>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="phone">{t('auth.phone.label')}</label>
            <div className="tel">
              <span className="tel__prefix" aria-hidden="true">+91</span>
              <input
                id="phone"
                className="input tel__input"
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                placeholder="98765 43210"
                maxLength={12}
                autoFocus
                value={digits}
                onChange={(e) => {
                  setDigits(e.target.value.replace(/[^\d\s]/g, ''));
                  setError(null);
                }}
              />
            </div>
          </div>
          <Messages error={error} notice={notice} />
          <button type="submit" className="btn btn--primary btn--block btn--large" disabled={busy || !phone}>
            {busy ? <span className="spinner" aria-hidden="true" /> : null}
            {t('auth.phone.send')}
          </button>
        </form>
      ) : (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void verify(code);
          }}
        >
          <div className="stack" style={{ gap: 4 }}>
            <h1 className="signin__title">{t('auth.otp.title')}</h1>
            <p className="muted">{t('auth.otp.sub', { phone: formatPhone(phone) })}</p>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="otp">{t('auth.otp.label')}</label>
            <input
              ref={codeInput}
              id="otp"
              className="input otp-input"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              value={code}
              disabled={busy}
              onChange={(e) => {
                const next = e.target.value.replace(/\D/g, '').slice(0, 6);
                setCode(next);
                setError(null);
                if (next.length === 6) void verify(next);
              }}
            />
          </div>
          <Messages error={error} notice={notice} />
          <button type="submit" className="btn btn--primary btn--block btn--large" disabled={busy || code.length < 6}>
            {busy ? <span className="spinner" aria-hidden="true" /> : null}
            {t('auth.otp.verify')}
          </button>
          <div className="row row--between">
            <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => void sendOtp(true)}>
              {t('auth.otp.resend')}
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={busy}
              onClick={() => {
                setStage('phone');
                setError(null);
                setNotice(null);
              }}
            >
              {t('auth.phone.change')}
            </button>
          </div>
        </form>
      )}
      {/* The invisible reCAPTCHA attaches here. Empty on purpose. */}
      <div id={RECAPTCHA_SLOT} />
    </div>
  );
}

function Messages({ error, notice }: { error: string | null; notice: string | null }) {
  return (
    <>
      {error && (
        <div className="notice notice--danger" role="alert">
          <span className="notice__icon" aria-hidden="true">!</span>
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div className="notice notice--ok" role="status">
          <span className="notice__icon" aria-hidden="true">✓</span>
          <span>{notice}</span>
        </div>
      )}
    </>
  );
}

/**
 * Firebase's error codes, in the owner's words. Anything not listed falls
 * back to the generic line: what went wrong is logged for us, not shown to
 * them as a code.
 */
function friendlyAuthError(e: unknown): string {
  const code = (e as { code?: string })?.code ?? '';
  switch (code) {
    case 'auth/invalid-phone-number':
    case 'auth/missing-phone-number':
      return t('error.phone');
    case 'auth/invalid-verification-code':
    case 'auth/missing-verification-code':
      return t('auth.otp.wrong');
    case 'auth/code-expired':
      return t('auth.otp.expired');
    case 'auth/too-many-requests':
    case 'auth/quota-exceeded':
      return t('auth.tooMany');
    case 'auth/network-request-failed':
      return t('auth.network');
    case 'auth/captcha-check-failed':
    case 'auth/missing-app-credential':
    case 'auth/invalid-app-credential':
      return t('auth.phone.captcha');
    // The Phone provider is not switched on in the Firebase project, or
    // Authentication has never been set up there. Nothing the owner can fix.
    case 'auth/configuration-not-found':
    case 'auth/operation-not-allowed':
      return t('auth.phone.notEnabled');
    default:
      console.error('[easybills] sign-in failed', e);
      return t('error.generic');
  }
}
