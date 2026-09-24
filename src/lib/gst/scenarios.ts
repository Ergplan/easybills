/**
 * What kind of document is this, and may it be issued at all?
 *
 * The product promise is a simple billing app, not a universal tax engine. The
 * honest way to keep that promise is to state precisely which transactions are
 * supported and to REFUSE to issue anything else -- while still letting the owner
 * keep the draft, so nothing they typed is lost.
 *
 * There is deliberately no generic "add tax" toggle. A toggle would let an owner
 * produce a document that looks like a tax invoice for a transaction this release
 * has not verified, which is the exact failure mode a billing app must not have.
 */

import type { CivilDate } from '@/lib/dates';
import { resolveVerified, type RulePack } from './ruleset';
import { DEFAULT_RULE_PACK } from './ruleset';

/** Confirmed GST standing of the business. "not-sure" is a real, honest state. */
export type GstRegistrationType = 'not-registered' | 'regular' | 'composition' | 'not-sure';

/** Why a supply might fall outside the supported set. */
export type SupplyFlag =
  | 'export'
  | 'sez'
  | 'deemed-export'
  | 'reverse-charge'
  | 'advance-receipt'
  | 'exempt-or-nil-rated'
  | 'non-gst-supply';

export const SUPPLY_FLAG_LABELS: Record<SupplyFlag, string> = {
  export: 'Export outside India',
  sez: 'Supply to a SEZ unit or developer',
  'deemed-export': 'Deemed export',
  'reverse-charge': 'Tax payable by the customer under reverse charge',
  'advance-receipt': 'Advance received before supply',
  'exempt-or-nil-rated': 'Exempt or nil-rated supply',
  'non-gst-supply': 'Non-GST supply (such as petrol or alcohol)',
};

export type DocumentKind = 'tax-invoice' | 'invoice-no-gst' | 'bill-of-supply' | 'blocked';

export interface IssuanceSubject {
  registrationType: GstRegistrationType;
  sellerStateCode: string | null;
  sellerGstin: string | null;
  placeOfSupplyStateCode: string | null;
  supplyFlags: readonly SupplyFlag[];
  /**
   * Aggregate turnover the owner has declared, in paise, for e-invoice screening.
   * `null` means "not declared", which is itself a reason to check.
   */
  declaredAggregateTurnoverPaise: number | null;
  /** Whether the owner has confirmed e-invoicing does not apply to them. */
  eInvoicingSelfDeclaredNotApplicable: boolean;
  issueDate: CivilDate;
}

export interface Blocker {
  code: string;
  /** Plain language, addressed to the owner. No tax jargon, no rule numbers. */
  message: string;
  /** What the owner can actually do about it. */
  whatYouCanDo: string;
}

export interface IssuanceAssessment {
  documentKind: DocumentKind;
  /** The heading printed on the document. */
  documentTitle: string;
  chargesGst: boolean;
  canIssue: boolean;
  blockers: Blocker[];
  /** Non-blocking things worth saying once, in review. */
  notices: string[];
}

export function assessIssuance(subject: IssuanceSubject, pack: RulePack = DEFAULT_RULE_PACK): IssuanceAssessment {
  const blockers: Blocker[] = [];
  const notices: string[] = [];

  // --- Unsupported supply types -------------------------------------------
  for (const flag of subject.supplyFlags) {
    blockers.push({
      code: `unsupported-supply:${flag}`,
      message: `This bill is marked as: ${SUPPLY_FLAG_LABELS[flag]}. This app cannot issue that kind of bill yet.`,
      whatYouCanDo:
        'Your draft is saved and nothing is lost. Ask your accountant to raise this one, or remove the marking if it was set by mistake.',
    });
  }

  // --- Registration standing ----------------------------------------------
  let documentKind: DocumentKind = 'blocked';
  let documentTitle = 'Draft';
  let chargesGst = false;

  switch (subject.registrationType) {
    case 'not-registered': {
      documentKind = 'invoice-no-gst';
      documentTitle = 'Invoice';
      chargesGst = false;
      notices.push('You are set up as not registered for GST, so no GST is added to this bill.');
      break;
    }
    case 'regular': {
      documentKind = 'tax-invoice';
      documentTitle = 'Tax Invoice';
      chargesGst = true;
      if (!subject.sellerGstin) {
        blockers.push({
          code: 'missing-gstin',
          message: 'Your GST number is needed before you can issue a GST bill.',
          whatYouCanDo: 'Add your GST number in Business details.',
        });
      }
      if (!subject.sellerStateCode) {
        blockers.push({
          code: 'missing-seller-state',
          message: 'Your business state is needed to work out the right GST.',
          whatYouCanDo: 'Add your state in Business details.',
        });
      }
      if (!subject.placeOfSupplyStateCode) {
        blockers.push({
          code: 'missing-place-of-supply',
          message: 'Please confirm which state this supply is for.',
          whatYouCanDo: 'Choose the state under "Where is this supply for?" in the bill.',
        });
      }
      break;
    }
    case 'composition': {
      // A composition taxpayer cannot collect GST and issues a bill of supply.
      // CMP-08/GSTR-4 are an explicit later extension, so this release refuses
      // rather than routing them through the regular-taxpayer flow.
      documentKind = 'blocked';
      documentTitle = 'Draft';
      chargesGst = false;
      blockers.push({
        code: 'composition-not-supported',
        message: 'Your business is under the GST composition scheme. This app does not handle composition billing yet.',
        whatYouCanDo:
          'Your drafts are saved. Please bill through your accountant for now. We will tell you when composition is supported.',
      });
      break;
    }
    case 'not-sure': {
      documentKind = 'blocked';
      documentTitle = 'Draft';
      chargesGst = false;
      blockers.push({
        code: 'gst-status-unconfirmed',
        message: 'We need to know your GST status before issuing a bill, so the bill is correct.',
        whatYouCanDo: 'Open Business details and choose your GST status. Your accountant can tell you in a minute if you are unsure.',
      });
      break;
    }
  }

  // --- e-invoicing screening ----------------------------------------------
  // Without an implemented IRP flow, a covered supplier must not be handed a PDF
  // as though it were a complete document. We can only clear this when we have a
  // VERIFIED threshold; otherwise we ask the owner to confirm, once.
  if (subject.registrationType === 'regular') {
    const threshold = resolveVerified(pack.eInvoicing.aggregateTurnoverThreshold, subject.issueDate);
    if (threshold === null) {
      if (!subject.eInvoicingSelfDeclaredNotApplicable) {
        blockers.push({
          code: 'e-invoicing-unscreened',
          message: 'Some GST-registered businesses must create bills through the government e-invoice system. We could not check this for you automatically.',
          whatYouCanDo:
            'Open Business details and confirm with your accountant whether e-invoicing applies to you. If it does, this app cannot issue your bills yet.',
        });
      } else {
        notices.push('You have confirmed that government e-invoicing does not apply to your business.');
      }
    } else if (subject.declaredAggregateTurnoverPaise === null) {
      blockers.push({
        code: 'turnover-not-declared',
        message: 'We need your yearly sales figure to check one GST rule for you.',
        whatYouCanDo: 'Add your yearly sales in Business details.',
      });
    } else if (subject.declaredAggregateTurnoverPaise >= threshold) {
      blockers.push({
        code: 'e-invoicing-applicable',
        message: 'Your business size means bills must go through the government e-invoice system. This app cannot do that yet.',
        whatYouCanDo: 'Your drafts are saved. Please raise these bills through your e-invoice provider or accountant.',
      });
    }
  }

  const canIssue = blockers.length === 0 && documentKind !== 'blocked';
  return { documentKind, documentTitle, chargesGst, canIssue, blockers, notices };
}

/** A short, honest summary for the compliance screen. Never a blanket claim. */
export const SUPPORTED_SCENARIOS_SUMMARY = [
  'Businesses not registered for GST, billing customers in India in rupees.',
  'Regular GST-registered businesses making ordinary domestic supplies, where the place of supply is confirmed on each bill, tax is payable by you (not the customer), and e-invoicing does not apply.',
] as const;

export const UNSUPPORTED_SCENARIOS_SUMMARY = [
  'Composition scheme businesses (CMP-08 and GSTR-4 are a later extension).',
  'Exports, supplies to SEZ units or developers, and deemed exports.',
  'Supplies where the customer pays the tax under reverse charge.',
  'Advances received before the supply is made.',
  'Exempt, nil-rated and non-GST supplies.',
  'Any business covered by government e-invoicing, until an IRP connection is built.',
  'Businesses with more than one GST registration or more than one billing location.',
  'Currencies other than the rupee.',
] as const;
