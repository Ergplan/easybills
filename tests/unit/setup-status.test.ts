import { describe, expect, it } from 'vitest';

import { profileSetupStatus, type ProfileLike } from '@/lib/domain/setup-status';

const TODAY = '2026-09-25';

const base: ProfileLike = {
  registrationType: 'not-registered',
  stateCode: '27',
  gstin: null,
  declaredAggregateTurnoverPaise: null,
  eInvoicingSelfDeclaredNotApplicable: false,
};

describe('profile setup status', () => {
  it('is complete for an unregistered business that has chosen its status', () => {
    const s = profileSetupStatus(base, TODAY);
    expect(s.complete).toBe(true);
    expect(s.headline).toBeNull();
  });

  it('is incomplete while GST status is unconfirmed', () => {
    const s = profileSetupStatus({ ...base, registrationType: 'not-sure' }, TODAY);
    expect(s.complete).toBe(false);
    expect(s.blockers.map((b) => b.code)).toContain('gst-status-unconfirmed');
    expect(s.headline).toMatch(/GST status/i);
  });

  it('is complete for a registrant who has settled GST number and e-invoicing', () => {
    const s = profileSetupStatus(
      {
        registrationType: 'regular',
        stateCode: '27',
        gstin: '27AAPFU0939F1ZV',
        declaredAggregateTurnoverPaise: null,
        eInvoicingSelfDeclaredNotApplicable: true,
      },
      TODAY,
    );
    expect(s.complete).toBe(true);
  });

  /**
   * The bug this replaced: Home used `numberingConfirmed` as a proxy, which
   * nothing in the billing flow ever sets. The banner therefore said "before
   * you issue your first one" to owners who had already issued several.
   * Setup status must depend only on things that genuinely stop issuance.
   */
  it('does not depend on whether the owner visited the numbering settings', () => {
    // Numbering is not an input at all -- it cannot be, because it has a
    // working default and issuance never requires touching it.
    const s = profileSetupStatus(base, TODAY);
    expect(s.complete).toBe(true);
    expect(Object.keys(base)).not.toContain('numberingConfirmed');
  });

  /**
   * A bill-specific problem is not a profile problem. Place of supply is chosen
   * per bill, so it must never light up the Home banner.
   */
  it('ignores problems that belong to one particular bill', () => {
    const s = profileSetupStatus(
      {
        registrationType: 'regular',
        stateCode: '27',
        gstin: '27AAPFU0939F1ZV',
        declaredAggregateTurnoverPaise: null,
        eInvoicingSelfDeclaredNotApplicable: true,
      },
      TODAY,
    );
    expect(s.blockers.map((b) => b.code)).not.toContain('missing-place-of-supply');
  });

  it('flags a registrant who has not settled e-invoicing', () => {
    const s = profileSetupStatus(
      {
        registrationType: 'regular',
        stateCode: '27',
        gstin: '27AAPFU0939F1ZV',
        declaredAggregateTurnoverPaise: null,
        eInvoicingSelfDeclaredNotApplicable: false,
      },
      TODAY,
    );
    expect(s.complete).toBe(false);
    expect(s.blockers.map((b) => b.code)).toContain('e-invoicing-unscreened');
  });

  it('gives every blocker something the owner can act on', () => {
    const s = profileSetupStatus({ ...base, registrationType: 'not-sure' }, TODAY);
    for (const b of s.blockers) {
      expect(b.whatYouCanDo.length).toBeGreaterThan(15);
    }
  });
});
