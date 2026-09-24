/**
 * Effective-dated GST rule pack with explicit provenance.
 *
 * WHY THIS EXISTS
 * ---------------
 * Tax law is not a constant, and an LLM is not a legal authority. Every value in
 * this application that comes from law rather than arithmetic lives here, with:
 *
 *   - `effectiveFrom` / `effectiveTo`  : when the value applies
 *   - `source`                         : the official URL it was read from
 *   - `verifiedOn` / `verifiedBy`      : who checked it against that source, when
 *   - `status`                         : 'verified' | 'unverified' | 'superseded'
 *
 * An `unverified` rule NEVER silently produces a number the owner might file or
 * rely on. Instead the feature that depends on it degrades honestly:
 *   - invoice issuance is blocked only where the LAW decides whether the document
 *     is even permissible (e.g. e-invoicing applicability);
 *   - GST return readiness is blocked outright;
 *   - due dates render as "not verified" rather than as a fabricated deadline.
 *
 * ARITHMETIC IS NOT IN HERE. Splitting a taxable value into CGST/SGST/IGST,
 * rounding, and totalling are deterministic maths, fully unit-tested, and do not
 * depend on an unverified parameter. The owner states the tax rate for their own
 * supply; the app does not guess a rate for them.
 */

import type { CivilDate } from '@/lib/dates';
import { compareDates } from '@/lib/dates';

export type RuleStatus = 'verified' | 'unverified' | 'superseded';

export interface RuleProvenance {
  /** Official URL this value was read from. */
  source: string;
  /** Short human description of what the source says. */
  citation: string;
  /** ISO date the value was last checked against `source`. */
  verifiedOn: CivilDate | null;
  /** Who performed the check. Must be a person or an authorised provider feed. */
  verifiedBy: string | null;
  status: RuleStatus;
  /** Why the value is unverified, shown to operators (never to owners as jargon). */
  note?: string;
}

export interface EffectiveDated<T> {
  value: T;
  effectiveFrom: CivilDate;
  effectiveTo: CivilDate | null;
  provenance: RuleProvenance;
}

export interface RulePack {
  /** Bump on every change. Recorded on every return snapshot for traceability. */
  version: string;
  /** Human label shown in the operator-facing compliance screen. */
  label: string;
  /** Whether ANY rule in the pack is still unverified. */
  generatedOn: CivilDate;

  /**
   * Turnover (in paise) at or above which e-invoicing (IRP/IRN) applies.
   * Screened against turnover HISTORY, not just the current year -- see
   * `eInvoicing.lookbackNote`.
   */
  eInvoicing: {
    aggregateTurnoverThreshold: EffectiveDated<number | null>;
    lookbackNote: string;
  };

  /** Minimum HSN/SAC digits required on an invoice, by aggregate turnover band. */
  hsnDigits: EffectiveDated<Array<{ turnoverAbovePaise: number; minDigits: number; b2cRequired: boolean }> | null>;

  /**
   * Statutory filing due dates. `null` means "we do not have a verified rule" --
   * the UI must then say so rather than invent a date.
   */
  dueDates: {
    gstr1Monthly: EffectiveDated<{ dayOfNextMonth: number } | null>;
    gstr1Quarterly: EffectiveDated<{ dayAfterQuarterEnd: number } | null>;
    gstr3bMonthly: EffectiveDated<{ dayOfNextMonth: number } | null>;
    gstr3bQuarterly: EffectiveDated<{ dayAfterQuarterEnd: number } | null>;
    iff: EffectiveDated<{ dayOfNextMonth: number } | null>;
  };

  /** Tax rates the owner may pick from. The owner chooses; the app never infers. */
  selectableRates: EffectiveDated<number[]>;

  /** Whether the rounding of the invoice total to the nearest rupee is permitted. */
  invoiceRounding: EffectiveDated<{ toNearestRupee: boolean } | null>;

  /** Schema versions for return payloads. */
  schemaVersions: {
    gstr1: EffectiveDated<string | null>;
    gstr3b: EffectiveDated<string | null>;
  };
}

const UNVERIFIED_REASON =
  'Not verified from an official source in this build: the official GST and CBIC domains ' +
  '(cbic-gst.gov.in, gst.gov.in, tutorial.gst.gov.in, gstn.org.in) were unreachable from the ' +
  'environment this application was built in. An operator must verify this value against the ' +
  'official source and record verifiedOn/verifiedBy before the dependent feature is enabled.';

function unverified(source: string, citation: string): RuleProvenance {
  return { source, citation, verifiedOn: null, verifiedBy: null, status: 'unverified', note: UNVERIFIED_REASON };
}

/**
 * The rule pack shipped with the source tree.
 *
 * IMPORTANT: every legally-determined value below is deliberately `null` and
 * marked `unverified`. That is not an oversight and must not be "filled in from
 * memory" -- a plausible-looking wrong threshold or due date is more dangerous
 * than an absent one, because the owner would act on it. Populate it from the
 * official source, set verifiedOn/verifiedBy/status, bump `version`, and run
 * `npm run gst:validate-rulepack`.
 */
export const DEFAULT_RULE_PACK: RulePack = {
  version: '0.0.0-unverified',
  label: 'Unverified starter pack — no legal parameter has been confirmed',
  generatedOn: '2026-09-24',

  eInvoicing: {
    aggregateTurnoverThreshold: {
      value: null,
      effectiveFrom: '2017-07-01',
      effectiveTo: null,
      provenance: unverified(
        'https://einvoice1.gst.gov.in/',
        'Aggregate-turnover threshold at or above which e-invoicing (IRN from an IRP) is mandatory, and the exclusions that apply.',
      ),
    },
    lookbackNote:
      'Applicability is screened on turnover in ANY preceding financial year from the year the ' +
      'scheme began, not only the current year, and several categories of supplier are excluded ' +
      'outright. Both the threshold and the exclusion list must come from the official source.',
  },

  hsnDigits: {
    value: null,
    effectiveFrom: '2021-04-01',
    effectiveTo: null,
    provenance: unverified(
      'https://cbic-gst.gov.in/gst-invoice-rules.html',
      'Minimum number of HSN/SAC digits on a tax invoice by aggregate turnover band, and whether B2C supplies are included.',
    ),
  },

  dueDates: {
    gstr1Monthly: {
      value: null,
      effectiveFrom: '2017-07-01',
      effectiveTo: null,
      provenance: unverified('https://www.gst.gov.in/help/returns', 'Statutory due date for monthly GSTR-1.'),
    },
    gstr1Quarterly: {
      value: null,
      effectiveFrom: '2021-01-01',
      effectiveTo: null,
      provenance: unverified('https://www.gst.gov.in/help/returns', 'Statutory due date for quarterly GSTR-1 under QRMP.'),
    },
    gstr3bMonthly: {
      value: null,
      effectiveFrom: '2017-07-01',
      effectiveTo: null,
      provenance: unverified('https://www.gst.gov.in/help/returns', 'Statutory due date for monthly GSTR-3B.'),
    },
    gstr3bQuarterly: {
      value: null,
      effectiveFrom: '2021-01-01',
      effectiveTo: null,
      provenance: unverified(
        'https://www.gst.gov.in/help/returns',
        'Statutory due date for quarterly GSTR-3B under QRMP, which varies by the taxpayer’s state group.',
      ),
    },
    iff: {
      value: null,
      effectiveFrom: '2021-01-01',
      effectiveTo: null,
      provenance: unverified('https://www.gst.gov.in/help/returns', 'Cut-off for the optional Invoice Furnishing Facility in months 1 and 2 of a quarter.'),
    },
  },

  selectableRates: {
    // Basis points. These are the slabs the OWNER may choose from; the app never
    // picks one. The list is a UI convenience, so it does not gate issuance --
    // but an owner may type any rate their supply actually attracts.
    value: [0, 10, 25, 100, 150, 300, 500, 600, 900, 1200, 1400, 1800, 2800],
    effectiveFrom: '2017-07-01',
    effectiveTo: null,
    provenance: unverified(
      'https://cbic-gst.gov.in/gst-goods-services-rates.html',
      'The set of GST rate slabs a supplier may select. Presented as choices only; the owner is responsible for the rate applicable to their supply.',
    ),
  },

  invoiceRounding: {
    value: { toNearestRupee: true },
    effectiveFrom: '2017-07-01',
    effectiveTo: null,
    provenance: unverified(
      'https://cbic-gst.gov.in/',
      'Whether the tax amount on an invoice may be rounded to the nearest rupee, and at what level the rounding is applied.',
    ),
  },

  schemaVersions: {
    gstr1: {
      value: null,
      effectiveFrom: '2017-07-01',
      effectiveTo: null,
      provenance: unverified('https://www.gst.gov.in/help/returns', 'Current GSTR-1 offline/JSON upload schema version.'),
    },
    gstr3b: {
      value: null,
      effectiveFrom: '2017-07-01',
      effectiveTo: null,
      provenance: unverified('https://www.gst.gov.in/help/returns', 'Current GSTR-3B schema version.'),
    },
  },
};

export function isEffective<T>(rule: EffectiveDated<T>, on: CivilDate): boolean {
  if (compareDates(on, rule.effectiveFrom) < 0) return false;
  if (rule.effectiveTo && compareDates(on, rule.effectiveTo) > 0) return false;
  return true;
}

/** Resolve a rule for a date, returning null when it is missing, stale or unverified. */
export function resolveVerified<T>(rule: EffectiveDated<T>, on: CivilDate): T | null {
  if (!isEffective(rule, on)) return null;
  if (rule.provenance.status !== 'verified') return null;
  return rule.value;
}

export interface RulePackAudit {
  version: string;
  total: number;
  verified: number;
  unverified: string[];
  fullyVerified: boolean;
}

/** Walks the pack so operators and the acceptance report can see exactly what is unverified. */
export function auditRulePack(pack: RulePack = DEFAULT_RULE_PACK): RulePackAudit {
  const entries: Array<[string, RuleProvenance]> = [
    ['eInvoicing.aggregateTurnoverThreshold', pack.eInvoicing.aggregateTurnoverThreshold.provenance],
    ['hsnDigits', pack.hsnDigits.provenance],
    ['dueDates.gstr1Monthly', pack.dueDates.gstr1Monthly.provenance],
    ['dueDates.gstr1Quarterly', pack.dueDates.gstr1Quarterly.provenance],
    ['dueDates.gstr3bMonthly', pack.dueDates.gstr3bMonthly.provenance],
    ['dueDates.gstr3bQuarterly', pack.dueDates.gstr3bQuarterly.provenance],
    ['dueDates.iff', pack.dueDates.iff.provenance],
    ['selectableRates', pack.selectableRates.provenance],
    ['invoiceRounding', pack.invoiceRounding.provenance],
    ['schemaVersions.gstr1', pack.schemaVersions.gstr1.provenance],
    ['schemaVersions.gstr3b', pack.schemaVersions.gstr3b.provenance],
  ];
  const unverifiedKeys = entries.filter(([, p]) => p.status !== 'verified').map(([k]) => k);
  return {
    version: pack.version,
    total: entries.length,
    verified: entries.length - unverifiedKeys.length,
    unverified: unverifiedKeys,
    fullyVerified: unverifiedKeys.length === 0,
  };
}
