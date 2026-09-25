/**
 * Is the business profile complete enough to issue a bill?
 *
 * ONE SOURCE OF TRUTH. Home's setup banner and the editor's warning both ask
 * this question, so they can never disagree, and neither can drift from what
 * issuance actually enforces.
 *
 * Previously Home guessed, using `numberingConfirmed` as a proxy. That flag is
 * only set when the owner explicitly saves the numbering section -- which
 * nothing requires, because the default numbering works. So the banner said
 * "before you issue your first one..." forever, including to owners who had
 * already issued several. A warning whose stated precondition is false teaches
 * people to ignore warnings.
 */

import { assessIssuance, type Blocker, type GstRegistrationType } from '@/lib/gst/scenarios';
import type { CivilDate } from '@/lib/dates';

export interface ProfileLike {
  registrationType: GstRegistrationType;
  stateCode: string | null;
  gstin: string | null;
  declaredAggregateTurnoverPaise: number | null;
  eInvoicingSelfDeclaredNotApplicable: boolean;
}

/** Blockers that belong to the PROFILE rather than to one particular bill. */
const PROFILE_CODES = new Set([
  'gst-status-unconfirmed',
  'composition-not-supported',
  'missing-gstin',
  'missing-seller-state',
  'e-invoicing-unscreened',
  'e-invoicing-applicable',
  'turnover-not-declared',
]);

export interface SetupStatus {
  /** True when nothing about the profile would stop a bill being issued. */
  complete: boolean;
  blockers: Blocker[];
  /** A single short line for a banner. Null when nothing is outstanding. */
  headline: string | null;
}

export function profileSetupStatus(business: ProfileLike, issueDate: CivilDate): SetupStatus {
  const assessment = assessIssuance({
    registrationType: business.registrationType,
    sellerStateCode: business.stateCode,
    sellerGstin: business.gstin,
    // Judged against the seller's own state so a missing place of supply -- a
    // property of a specific bill -- does not show up as a profile problem.
    placeOfSupplyStateCode: business.stateCode,
    supplyFlags: [],
    declaredAggregateTurnoverPaise: business.declaredAggregateTurnoverPaise,
    eInvoicingSelfDeclaredNotApplicable: business.eInvoicingSelfDeclaredNotApplicable,
    issueDate,
  });

  const blockers = assessment.blockers.filter((b) => PROFILE_CODES.has(b.code));

  return {
    complete: blockers.length === 0,
    blockers,
    headline: blockers.length ? blockers[0]!.message : null,
  };
}
