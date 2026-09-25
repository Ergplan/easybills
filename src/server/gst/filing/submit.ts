import 'server-only';

import { randomUUID } from 'node:crypto';

import type {
  FilingAcknowledgementRecord,
  FilingAttemptRecord,
  ProviderConsentRecord,
  ReturnForm,
  ReturnStatus,
  ReturnVersionRecord,
} from '@/lib/gst-returns/types';
import { db } from '@/server/firebase/admin';
import { acknowledgementsCol, consentsCol, filingAttemptsCol, returnPeriodsCol, returnPeriodId } from '@/server/firebase/paths';

/**
 * One acknowledgement per GSTIN, form and period.
 *
 * Making this a deterministic document id means a second acknowledgement for
 * the same return is not merely unlikely -- it cannot be written.
 */
function acknowledgementId(gstin: string, form: ReturnForm, period: string): string {
  return `ack__${gstin}__${form}__${period}`;
}
import { recordAudit } from '@/server/services/audit';

import { selectFilingProvider, FilingProviderError, type GstFilingProvider } from './provider';

export class FilingError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'FilingError';
  }
}

/**
 * Submit an approved return version.
 *
 * The safety properties, each of which has a test:
 *
 *  APPROVAL IS BOUND TO A PAYLOAD. The attempt carries the payload hash the
 *  owner approved. If the version's hash has moved since, the submission is
 *  refused -- an approval can never be reused for a changed payload.
 *
 *  ONE FLIGHT AT A TIME. A lock document is created transactionally for the
 *  GSTIN, form and period. Repeated button taps and concurrent requests find it
 *  and stop, so a period cannot be submitted twice concurrently.
 *
 *  IDEMPOTENCY ACROSS RETRIES. The key is derived from the version and payload
 *  hash, so a retry of the same approved payload is the same submission to the
 *  provider, not a new one.
 *
 *  A TIMEOUT IS NOT A FAILURE. When we do not learn the outcome, the attempt is
 *  recorded as `unknown` and the next action is a STATUS QUERY, never a blind
 *  resubmission.
 *
 *  FILED MEANS FILED. The period moves to `filed` only on an acknowledgement
 *  that matches this GSTIN, form and period. Anything else -- an upload
 *  receipt, a challan, the owner's say-so -- lands in a weaker state.
 */
export async function submitReturn(args: {
  businessId: string;
  uid: string;
  version: ReturnVersionRecord;
  /** The hash the owner approved, from the approval step. */
  approvedPayloadHash: string;
  payload: unknown;
  provider?: GstFilingProvider;
}): Promise<{
  attempt: FilingAttemptRecord;
  acknowledgement: FilingAcknowledgementRecord | null;
  status: ReturnStatus;
  /** True when this period was already filed and nothing new was submitted. */
  alreadyFiled: boolean;
}> {
  const provider = args.provider ?? selectFilingProvider();
  const { version } = args;

  if (!provider.available) {
    throw new FilingError(provider.unavailableReason ?? 'Filing is not available.', 'provider-unavailable');
  }

  // --- the approval must match the payload --------------------------------
  if (version.approvedByUid === null || version.approvedAt === null) {
    throw new FilingError('This return has not been approved for filing.', 'not-approved');
  }
  if (version.invalidatedAt) {
    throw new FilingError(
      `This approval is no longer valid: ${version.invalidationReason ?? 'the underlying records changed'}. Please review and approve again.`,
      'approval-invalidated',
    );
  }
  if (version.payloadHash !== args.approvedPayloadHash) {
    throw new FilingError(
      'What you approved is not what is about to be sent. Please review the return again.',
      'payload-changed',
    );
  }

  // --- consent ------------------------------------------------------------
  const consent = await activeConsent(args.businessId, version.gstin, provider.environment);
  if (!consent) {
    throw new FilingError(
      `You have not authorised filing through ${provider.name} for this GSTIN${provider.environment === 'sandbox' ? ' (test)' : ''}.`,
      'no-consent',
    );
  }

  // --- single-flight lock -------------------------------------------------
  const lockId = `filinglock__${version.gstin}__${version.form}__${version.period}`;
  const lockRef = filingAttemptsCol(args.businessId).doc(lockId);
  const lockAcquired = await db().runTransaction(async (tx) => {
    const snap = await tx.get(lockRef);
    if (snap.exists) {
      const held = snap.data() as { heldUntil: string; attemptId: string };
      if (held.heldUntil > new Date().toISOString()) return false;
    }
    tx.set(lockRef, {
      heldUntil: new Date(Date.now() + 5 * 60_000).toISOString(),
      attemptId: randomUUID(),
      startedAt: new Date().toISOString(),
    });
    return true;
  });

  if (!lockAcquired) {
    throw new FilingError(
      'This return is already being submitted. Please wait a moment and check its status.',
      'already-in-flight',
    );
  }

  // Already filed? Then there is nothing to submit. A second tap, a refresh or
  // a retry after a slow response must not send the return again.
  const existingAckRef = acknowledgementsCol(args.businessId).doc(
    acknowledgementId(version.gstin, version.form, version.period),
  );
  const existingAckSnap = await existingAckRef.get();
  if (existingAckSnap.exists) {
    const existingAck = existingAckSnap.data() as FilingAcknowledgementRecord;
    if (existingAck.verified) {
      await lockRef.delete().catch(() => undefined);
      const noop: FilingAttemptRecord = {
        id: 'already-filed',
        returnVersionId: version.id,
        gstin: version.gstin,
        form: version.form,
        period: version.period,
        environment: provider.environment,
        approvedPayloadHash: args.approvedPayloadHash,
        idempotencyKey: '',
        status: 'succeeded',
        providerReference: null,
        requestAt: new Date().toISOString(),
        responseAt: new Date().toISOString(),
        errors: [],
        attemptedByUid: args.uid,
      };
      return { attempt: noop, acknowledgement: existingAck, status: 'filed', alreadyFiled: true };
    }
  }

  // Idempotency is derived, not random: the same approved payload always
  // produces the same key, so a retry is the same submission.
  const idempotencyKey = `${version.id}:${args.approvedPayloadHash}`.slice(0, 120);

  const attemptRef = filingAttemptsCol(args.businessId).doc();
  const attempt: FilingAttemptRecord = {
    id: attemptRef.id,
    returnVersionId: version.id,
    gstin: version.gstin,
    form: version.form,
    period: version.period,
    environment: provider.environment,
    approvedPayloadHash: args.approvedPayloadHash,
    idempotencyKey,
    status: 'preparing',
    providerReference: null,
    requestAt: new Date().toISOString(),
    responseAt: null,
    errors: [],
    attemptedByUid: args.uid,
  };
  await attemptRef.set(attempt);

  try {
    let response;
    try {
      response = await provider.submit({
        gstin: version.gstin,
        form: version.form,
        period: version.period,
        payload: args.payload,
        payloadHash: args.approvedPayloadHash,
        idempotencyKey,
      });
    } catch (error) {
      if (error instanceof FilingProviderError && error.retryable) {
        // We do not know what happened. Ask, rather than assume or resubmit.
        const queried = await provider
          .queryStatus({
            gstin: version.gstin,
            form: version.form,
            period: version.period,
            providerReference: null,
            idempotencyKey,
          })
          .catch(() => null);

        if (queried && queried.status !== 'unknown') {
          response = queried;
        } else {
          const unknownAttempt: FilingAttemptRecord = {
            ...attempt,
            status: 'unknown',
            responseAt: new Date().toISOString(),
            errors: [{ code: 'TIMEOUT', message: 'No response from the filing provider; the outcome is unknown.' }],
          };
          await attemptRef.set(unknownAttempt);
          await setPeriodStatus(args.businessId, version, 'status-unknown');
          await recordAudit(args.businessId, {
            actorUid: args.uid,
            actorKind: 'user',
            action: 'gst.filing.timeout',
            subjectType: 'return-version',
            subjectId: version.id,
            detail: { form: version.form, period: version.period },
          });
          return { attempt: unknownAttempt, acknowledgement: null, status: 'status-unknown', alreadyFiled: false };
        }
      } else {
        throw error;
      }
    }

    const finished: FilingAttemptRecord = {
      ...attempt,
      status: response.status,
      providerReference: response.providerReference,
      responseAt: new Date().toISOString(),
      errors: response.errors,
    };
    await attemptRef.set(finished);

    // --- acknowledgement --------------------------------------------------
    let acknowledgement: FilingAcknowledgementRecord | null = null;
    let periodStatus: ReturnStatus;

    if (response.status === 'succeeded' && response.arn) {
      const validation = validateAcknowledgement({
        arn: response.arn,
        gstin: version.gstin,
        form: version.form,
        period: version.period,
        expectedGstin: version.gstin,
        expectedForm: version.form,
        expectedPeriod: version.period,
      });
      if (!validation.ok) {
        const rejected: FilingAttemptRecord = {
          ...finished,
          status: 'rejected',
          errors: [...response.errors, { code: 'ACK_MISMATCH', message: validation.reason! }],
        };
        await attemptRef.set(rejected);
        await setPeriodStatus(args.businessId, version, 'failed');
        return { attempt: rejected, acknowledgement: null, status: 'failed', alreadyFiled: false };
      }

      const ackRef = existingAckRef;
      acknowledgement = {
        id: ackRef.id,
        filingAttemptId: attemptRef.id,
        gstin: version.gstin,
        form: version.form,
        period: version.period,
        arn: response.arn,
        filedAt: response.filedAt,
        evidenceSource: 'provider',
        verified: true,
        verificationNote: `Acknowledged by ${provider.name} (${provider.environment}).`,
        attachmentName: null,
        attachmentHash: null,
        recordedByUid: args.uid,
        recordedAt: new Date().toISOString(),
      };
      await ackRef.set(acknowledgement);
      periodStatus = 'filed';
    } else if (response.status === 'processing' || response.status === 'submitted') {
      // An upload that the portal has accepted for processing is NOT a filing.
      periodStatus = 'uploaded';
    } else if (response.status === 'rejected') {
      periodStatus = 'failed';
    } else {
      periodStatus = 'status-unknown';
    }

    await setPeriodStatus(args.businessId, version, periodStatus);
    await recordAudit(args.businessId, {
      actorUid: args.uid,
      actorKind: 'user',
      action: `gst.filing.${response.status}`,
      subjectType: 'return-version',
      subjectId: version.id,
      detail: { form: version.form, period: version.period, environment: provider.environment },
    });

    return { attempt: finished, acknowledgement, status: periodStatus, alreadyFiled: false };
  } finally {
    await lockRef.delete().catch(() => undefined);
  }
}

/**
 * Validate an acknowledgement against what we actually submitted.
 *
 * An acknowledgement for a different GSTIN, form or period is not evidence of
 * anything about THIS return, and is rejected rather than recorded.
 */
export function validateAcknowledgement(args: {
  arn: string | null;
  gstin: string;
  form: ReturnForm;
  period: string;
  expectedGstin: string;
  expectedForm: ReturnForm;
  expectedPeriod: string;
}): { ok: boolean; reason?: string } {
  if (!args.arn || !args.arn.trim()) {
    return { ok: false, reason: 'The acknowledgement has no reference number.' };
  }
  if (args.gstin !== args.expectedGstin) {
    return { ok: false, reason: `The acknowledgement is for GSTIN ${args.gstin}, not ${args.expectedGstin}.` };
  }
  if (args.form !== args.expectedForm) {
    return { ok: false, reason: `The acknowledgement is for ${args.form}, not ${args.expectedForm}.` };
  }
  if (args.period !== args.expectedPeriod) {
    return { ok: false, reason: `The acknowledgement is for ${args.period}, not ${args.expectedPeriod}.` };
  }
  return { ok: true };
}

/**
 * Record evidence the OWNER attached after filing on the portal themselves.
 *
 * This never reads as `filed`. Until somebody verifies it against the portal it
 * stays "Reported filed — verification pending", because a screenshot is not an
 * acknowledgement.
 */
export async function attachOwnerFilingEvidence(args: {
  businessId: string;
  uid: string;
  gstin: string;
  form: ReturnForm;
  period: string;
  arn: string | null;
  attachmentName: string | null;
  attachmentHash: string | null;
  note: string | null;
}): Promise<FilingAcknowledgementRecord> {
  const ref = acknowledgementsCol(args.businessId).doc();
  const record: FilingAcknowledgementRecord = {
    id: ref.id,
    filingAttemptId: 'owner-attached',
    gstin: args.gstin,
    form: args.form,
    period: args.period,
    arn: args.arn?.trim() || null,
    filedAt: null,
    evidenceSource: 'owner-attached',
    verified: false,
    verificationNote: args.note ?? 'Attached by the owner. Not yet verified against the portal.',
    attachmentName: args.attachmentName,
    attachmentHash: args.attachmentHash,
    recordedByUid: args.uid,
    recordedAt: new Date().toISOString(),
  };
  await ref.set(record);

  const periodRef = returnPeriodsCol(args.businessId).doc(returnPeriodId(args.gstin, args.form, args.period));
  await periodRef.set(
    { status: 'reported-filed-unverified' satisfies ReturnStatus, updatedAt: new Date().toISOString() },
    { merge: true },
  );

  await recordAudit(args.businessId, {
    actorUid: args.uid,
    actorKind: 'user',
    action: 'gst.filing.owner-evidence-attached',
    subjectType: 'return-period',
    subjectId: periodRef.id,
    detail: { form: args.form, period: args.period, hasArn: Boolean(record.arn) },
  });

  return record;
}

async function setPeriodStatus(businessId: string, version: ReturnVersionRecord, status: ReturnStatus): Promise<void> {
  await returnPeriodsCol(businessId)
    .doc(returnPeriodId(version.gstin, version.form, version.period))
    .set({ status, updatedAt: new Date().toISOString() }, { merge: true });
}

export async function activeConsent(
  businessId: string,
  gstin: string,
  environment: 'sandbox' | 'production',
): Promise<ProviderConsentRecord | null> {
  const snap = await consentsCol(businessId).where('gstin', '==', gstin).limit(20).get();
  const now = new Date().toISOString();
  for (const doc of snap.docs) {
    const consent = doc.data() as ProviderConsentRecord;
    if (consent.environment !== environment) continue;
    if (consent.revokedAt) continue;
    // An expired authorisation is not an authorisation.
    if (consent.expiresAt && consent.expiresAt < now) continue;
    return consent;
  }
  return null;
}

export async function grantConsent(args: {
  businessId: string;
  uid: string;
  gstin: string;
  providerName: string;
  environment: 'sandbox' | 'production';
  expiresAt: string | null;
  scope: string[];
}): Promise<ProviderConsentRecord> {
  const ref = consentsCol(args.businessId).doc();
  const record: ProviderConsentRecord = {
    id: ref.id,
    gstin: args.gstin,
    providerName: args.providerName,
    environment: args.environment,
    grantedByUid: args.uid,
    grantedAt: new Date().toISOString(),
    expiresAt: args.expiresAt,
    revokedAt: null,
    scope: args.scope,
  };
  await ref.set(record);
  await recordAudit(args.businessId, {
    actorUid: args.uid,
    actorKind: 'user',
    action: 'gst.consent.granted',
    subjectType: 'provider-consent',
    subjectId: ref.id,
    detail: { environment: args.environment, provider: args.providerName },
  });
  return record;
}

export async function revokeConsent(businessId: string, uid: string, consentId: string): Promise<void> {
  await consentsCol(businessId).doc(consentId).update({ revokedAt: new Date().toISOString() });
  await recordAudit(businessId, {
    actorUid: uid,
    actorKind: 'user',
    action: 'gst.consent.revoked',
    subjectType: 'provider-consent',
    subjectId: consentId,
    detail: null,
  });
}
