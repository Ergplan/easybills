import { describe, expect, it } from 'vitest';

import type { ReturnVersionRecord } from '@/lib/gst-returns/types';
import { SandboxFilingProvider, UnconfiguredFilingProvider, describeFilingCapability } from '@/server/gst/filing/provider';
import {
  FilingError,
  attachOwnerFilingEvidence,
  grantConsent,
  revokeConsent,
  submitReturn,
  validateAcknowledgement,
} from '@/server/gst/filing/submit';
import { returnPeriodsCol, returnPeriodId, acknowledgementsCol } from '@/server/firebase/paths';

import { makeGstBusiness, ownerUidOf } from '../helpers';

const GSTIN = '27AAPFU0939F1ZV';

function version(over: Partial<ReturnVersionRecord> = {}): ReturnVersionRecord {
  return {
    id: 'ver-1',
    returnPeriodId: returnPeriodId(GSTIN, 'GSTR-1', '2026-09'),
    gstin: GSTIN,
    form: 'GSTR-1',
    period: '2026-09',
    versionNumber: 1,
    createdAt: '2026-10-05T00:00:00.000Z',
    createdByUid: 'uid-1',
    sourceFingerprint: 'fp-1',
    payloadHash: 'hash-approved',
    rulePackVersion: '0.0.0-unverified',
    schemaVersion: null,
    workings: {},
    approvedByUid: 'uid-1',
    approvedAt: '2026-10-05T01:00:00.000Z',
    invalidatedAt: null,
    invalidationReason: null,
    ...over,
  };
}

async function setup() {
  const business = await makeGstBusiness();
  const uid = await ownerUidOf(business);
  await grantConsent({
    businessId: business.id,
    uid,
    gstin: GSTIN,
    providerName: 'sandbox',
    environment: 'sandbox',
    expiresAt: null,
    scope: ['file:gstr1'],
  });
  return { business, uid };
}

describe('provider selection', () => {
  it('reports honestly that nothing is configured', () => {
    const cap = describeFilingCapability();
    expect(cap.mode).toBe('unconfigured');
    expect(cap.available).toBe(false);
    // The one claim we must never make without a real connection.
    expect(cap.productionVerified).toBe(false);
  });

  /**
   * An owner has no use for a variable name. The reason they see says what is
   * true and what to do instead; the configuration detail is kept for whoever
   * runs the app, and must never leak into an owner-facing screen.
   */
  it('keeps configuration names out of the owner-facing reason', () => {
    const cap = describeFilingCapability();
    expect(cap.reason).toBeTruthy();
    expect(cap.reason).not.toMatch(/GSP_|_URL|_ID|_SECRET|env|docs\//i);
    expect(cap.reason).toMatch(/gst portal|accountant/i);
    // ...while the operator still gets what they need.
    expect(cap.operatorDetail).toMatch(/GSP_MODE/);
  });

  it('refuses to file when unconfigured rather than quietly using the sandbox', async () => {
    const { business, uid } = await setup();
    await expect(
      submitReturn({
        businessId: business.id,
        uid,
        version: version(),
        approvedPayloadHash: 'hash-approved',
        payload: { any: 'thing' },
        provider: new UnconfiguredFilingProvider(),
      }),
    ).rejects.toBeInstanceOf(FilingError);
  });

  it('marks sandbox acknowledgements so they cannot pass as real', async () => {
    const provider = new SandboxFilingProvider('succeed');
    const r = await provider.submit({
      gstin: GSTIN, form: 'GSTR-1', period: '2026-09', payload: {}, payloadHash: 'h', idempotencyKey: 'k1',
    });
    expect(r.arn).toMatch(/^SANDBOX-ARN-/);
  });
});

describe('approval binding', () => {
  /** GATE: "Filing approval cannot be reused for a changed payload." */
  it('refuses a payload whose hash differs from what was approved', async () => {
    const { business, uid } = await setup();
    await expect(
      submitReturn({
        businessId: business.id,
        uid,
        version: version({ payloadHash: 'hash-something-else' }),
        approvedPayloadHash: 'hash-approved',
        payload: {},
        provider: new SandboxFilingProvider('succeed'),
      }),
    ).rejects.toThrow(/not what is about to be sent/i);
  });

  it('refuses an unapproved version', async () => {
    const { business, uid } = await setup();
    await expect(
      submitReturn({
        businessId: business.id,
        uid,
        version: version({ approvedByUid: null, approvedAt: null }),
        approvedPayloadHash: 'hash-approved',
        payload: {},
        provider: new SandboxFilingProvider('succeed'),
      }),
    ).rejects.toThrow(/not been approved/i);
  });

  it('refuses an approval that was invalidated by a later change', async () => {
    const { business, uid } = await setup();
    await expect(
      submitReturn({
        businessId: business.id,
        uid,
        version: version({ invalidatedAt: '2026-10-06T00:00:00.000Z', invalidationReason: 'a purchase bill changed' }),
        approvedPayloadHash: 'hash-approved',
        payload: {},
        provider: new SandboxFilingProvider('succeed'),
      }),
    ).rejects.toThrow(/no longer valid/i);
  });
});

describe('authorisation', () => {
  /** GATE: "expired authorisation ... handled safely." */
  it('refuses when consent has expired', async () => {
    const business = await makeGstBusiness();
    const uid = await ownerUidOf(business);
    await grantConsent({
      businessId: business.id, uid, gstin: GSTIN, providerName: 'sandbox', environment: 'sandbox',
      expiresAt: '2020-01-01T00:00:00.000Z', scope: [],
    });
    await expect(
      submitReturn({
        businessId: business.id, uid, version: version(), approvedPayloadHash: 'hash-approved', payload: {},
        provider: new SandboxFilingProvider('succeed'),
      }),
    ).rejects.toThrow(/not authorised/i);
  });

  it('refuses after consent is revoked', async () => {
    const business = await makeGstBusiness();
    const uid = await ownerUidOf(business);
    const consent = await grantConsent({
      businessId: business.id, uid, gstin: GSTIN, providerName: 'sandbox', environment: 'sandbox',
      expiresAt: null, scope: [],
    });
    await revokeConsent(business.id, uid, consent.id);
    await expect(
      submitReturn({
        businessId: business.id, uid, version: version(), approvedPayloadHash: 'hash-approved', payload: {},
        provider: new SandboxFilingProvider('succeed'),
      }),
    ).rejects.toThrow(/not authorised/i);
  });

  it('does not accept sandbox consent for a production submission', async () => {
    const { business } = await setup();
    const { activeConsent } = await import('@/server/gst/filing/submit');
    expect(await activeConsent(business.id, GSTIN, 'production')).toBeNull();
    expect(await activeConsent(business.id, GSTIN, 'sandbox')).not.toBeNull();
  });
});

describe('submission outcomes', () => {
  it('records a filed period only on a matching acknowledgement', async () => {
    const { business, uid } = await setup();
    const result = await submitReturn({
      businessId: business.id, uid, version: version(), approvedPayloadHash: 'hash-approved',
      payload: { b2b: [] }, provider: new SandboxFilingProvider('succeed'),
    });
    expect(result.status).toBe('filed');
    expect(result.acknowledgement?.arn).toMatch(/^SANDBOX-ARN-/);
    expect(result.acknowledgement?.verified).toBe(true);

    const period = await returnPeriodsCol(business.id).doc(returnPeriodId(GSTIN, 'GSTR-1', '2026-09')).get();
    expect(period.data()!.status).toBe('filed');
  });

  /** GATE: "schema rejection ... handled safely. No ... false Filed state." */
  it('records a rejection as failed, never as filed', async () => {
    const { business, uid } = await setup();
    const result = await submitReturn({
      businessId: business.id, uid, version: version(), approvedPayloadHash: 'hash-approved',
      payload: {}, provider: new SandboxFilingProvider('reject-schema'),
    });
    expect(result.status).toBe('failed');
    expect(result.acknowledgement).toBeNull();
    expect(result.attempt.errors[0]!.code).toBe('SCHEMA_INVALID');
    expect(result.attempt.errors[0]!.field).toBeTruthy();
  });

  /** GATE: "timeout with unknown outcome". */
  it('records an unknown outcome on a timeout instead of guessing', async () => {
    const { business, uid } = await setup();
    const result = await submitReturn({
      businessId: business.id, uid, version: version(), approvedPayloadHash: 'hash-approved',
      payload: {}, provider: new SandboxFilingProvider('timeout'),
    });
    expect(result.status).toBe('status-unknown');
    expect(result.attempt.status).toBe('unknown');
    expect(result.acknowledgement).toBeNull();

    const period = await returnPeriodsCol(business.id).doc(returnPeriodId(GSTIN, 'GSTR-1', '2026-09')).get();
    expect(period.data()!.status).toBe('status-unknown');
  });

  /** GATE: "already-filed periods are handled safely." */
  it('reports a period already filed elsewhere rather than filing it again', async () => {
    const { business, uid } = await setup();
    const provider = new SandboxFilingProvider('succeed');
    provider.markFiled(GSTIN, 'GSTR-1', '2026-09');

    const result = await submitReturn({
      businessId: business.id, uid, version: version(), approvedPayloadHash: 'hash-approved',
      payload: {}, provider,
    });
    expect(result.status).toBe('failed');
    expect(result.attempt.errors[0]!.code).toBe('ALREADY_FILED');
  });

  /** GATE: "repeated button taps ... No duplicate filings." */
  it('produces one filing from five simultaneous submissions', async () => {
    const { business, uid } = await setup();
    const provider = new SandboxFilingProvider('succeed');

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        submitReturn({
          businessId: business.id, uid, version: version(), approvedPayloadHash: 'hash-approved',
          payload: {}, provider,
        }),
      ),
    );

    const fulfilled = results.filter((r) => r.status === 'fulfilled') as Array<
      PromiseFulfilledResult<Awaited<ReturnType<typeof submitReturn>>>
    >;
    const blocked = results.filter(
      (r) => r.status === 'rejected' && /already being submitted/i.test(String((r.reason as Error).message)),
    );

    // Exactly one attempt actually submits. Every other outcome is either
    // stopped by the in-flight lock or reports the period as already filed --
    // never a second filing.
    const freshFilings = fulfilled.filter((r) => r.value.status === 'filed' && !r.value.alreadyFiled);
    expect(freshFilings.length).toBe(1);
    expect(fulfilled.length + blocked.length).toBe(5);
    for (const r of fulfilled) {
      expect(['filed', 'status-unknown']).toContain(r.value.status);
    }

    // And only one acknowledgement exists, because its id is deterministic.
    const acks = await acknowledgementsCol(business.id).where('period', '==', '2026-09').get();
    expect(acks.size).toBe(1);
  });

  it('is idempotent when the same approved payload is retried', async () => {
    const provider = new SandboxFilingProvider('succeed');
    const first = await provider.submit({
      gstin: GSTIN, form: 'GSTR-1', period: '2026-09', payload: {}, payloadHash: 'h', idempotencyKey: 'same-key',
    });
    const second = await provider.submit({
      gstin: GSTIN, form: 'GSTR-1', period: '2026-09', payload: {}, payloadHash: 'h', idempotencyKey: 'same-key',
    });
    expect(second.arn).toBe(first.arn);
    expect(second.providerReference).toBe(first.providerReference);
  });
});

describe('acknowledgement validation', () => {
  /** GATE: "Wrong-GSTIN/period acknowledgements fail validation." */
  it('rejects an acknowledgement for another GSTIN, form or period', () => {
    const good = { arn: 'ARN123', gstin: GSTIN, form: 'GSTR-1' as const, period: '2026-09', expectedGstin: GSTIN, expectedForm: 'GSTR-1' as const, expectedPeriod: '2026-09' };
    expect(validateAcknowledgement(good).ok).toBe(true);
    expect(validateAcknowledgement({ ...good, gstin: '29AAGCB7383J1Z4' }).ok).toBe(false);
    expect(validateAcknowledgement({ ...good, form: 'GSTR-3B' }).ok).toBe(false);
    expect(validateAcknowledgement({ ...good, period: '2026-08' }).ok).toBe(false);
    expect(validateAcknowledgement({ ...good, arn: null }).ok).toBe(false);
    expect(validateAcknowledgement({ ...good, arn: '   ' }).ok).toBe(false);
  });
});

describe('owner-attached evidence', () => {
  /**
   * An owner who filed on the portal themselves can record it -- but their
   * evidence is never promoted to "Filed" without verification.
   */
  it('records owner evidence as reported-filed, not filed', async () => {
    const { business, uid } = await setup();
    const ack = await attachOwnerFilingEvidence({
      businessId: business.id, uid, gstin: GSTIN, form: 'GSTR-1', period: '2026-09',
      arn: 'AA270926000000X', attachmentName: 'receipt.pdf', attachmentHash: 'abc', note: null,
    });
    expect(ack.evidenceSource).toBe('owner-attached');
    expect(ack.verified).toBe(false);

    const period = await returnPeriodsCol(business.id).doc(returnPeriodId(GSTIN, 'GSTR-1', '2026-09')).get();
    expect(period.data()!.status).toBe('reported-filed-unverified');
  });
});
