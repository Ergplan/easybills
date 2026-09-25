import 'server-only';

import { DraftConflictError, IssuanceBlockedError, InvoiceStateError } from '@/server/repos/invoices';
import { NotAuthorisedError, NotFoundError } from '@/server/auth/guard';
import { NotAuthenticatedError } from '@/server/auth/session';
import { PaymentError } from '@/server/repos/payments';
import { MoneyError } from '@/lib/money';
import { DateError } from '@/lib/dates';
import { TaxEngineError } from '@/lib/gst/tax-engine';

/** What every server action returns, so the UI has one shape to handle. */
export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string; blockers?: Array<{ code: string; message: string; whatYouCanDo: string }>; currentRevision?: number };

/**
 * Turn a thrown error into something an owner can act on.
 *
 * Unexpected errors are logged server-side and reported generically -- the owner
 * gets "something went wrong", not a stack trace or a database path.
 */
export function toActionError(error: unknown): ActionResult<never> {
  if (error instanceof IssuanceBlockedError) {
    return { ok: false, error: error.message, code: 'blocked', blockers: error.blockers };
  }
  if (error instanceof DraftConflictError) {
    return { ok: false, error: error.message, code: 'conflict', currentRevision: error.currentRevision };
  }
  if (
    error instanceof InvoiceStateError ||
    error instanceof PaymentError ||
    error instanceof MoneyError ||
    error instanceof DateError ||
    error instanceof TaxEngineError
  ) {
    return { ok: false, error: error.message, code: error.name };
  }
  if (error instanceof NotAuthenticatedError) return { ok: false, error: 'Please sign in again.', code: 'auth' };
  if (error instanceof NotAuthorisedError) return { ok: false, error: error.message, code: 'forbidden' };
  if (error instanceof NotFoundError) return { ok: false, error: error.message, code: 'not-found' };

  if (error && typeof error === 'object' && 'issues' in error) {
    // Zod: surface the first field message, which is written for owners.
    const issues = (error as { issues: Array<{ message: string }> }).issues;
    return { ok: false, error: issues[0]?.message ?? 'Please check what you entered.', code: 'validation' };
  }

  console.error('[easybills] unexpected error', error);
  return { ok: false, error: 'Something went wrong. Please try again.', code: 'unknown' };
}

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}
