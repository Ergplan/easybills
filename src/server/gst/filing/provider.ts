import 'server-only';

import { gspConfig } from '@/lib/env';

import type { FilingAttemptStatus, ReturnForm } from '@/lib/gst-returns/types';

/**
 * The GST Suvidha Provider adapter boundary.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO, and will not be extended to do:
 *  - scrape the GST portal's login pages,
 *  - handle, bypass or automate CAPTCHA or OTP,
 *  - store a taxpayer's GST portal password,
 *  - send OTPs, signing material or session tokens to a language model,
 *  - file or pay anything without an explicit, per-submission owner approval.
 *
 * Filing goes through an authorised provider's published API, with the
 * taxpayer's recorded consent, using whatever signing the provider supports
 * (EVC or DSC). Where credentials are absent, the sandbox adapter runs instead
 * and SAYS SO -- a mocked success is never reported as a live filing.
 */

export interface FilingRequest {
  gstin: string;
  form: ReturnForm;
  period: string;
  /** The exact payload the owner approved. */
  payload: unknown;
  /** Hash of that payload. The provider call carries it for traceability. */
  payloadHash: string;
  /** Reused verbatim on every retry of the same submission. */
  idempotencyKey: string;
}

export interface FilingResponse {
  status: FilingAttemptStatus;
  providerReference: string | null;
  /** Only ever set when the provider reports an authoritative acknowledgement. */
  arn: string | null;
  filedAt: string | null;
  errors: Array<{ code: string; message: string; field?: string }>;
}

export interface StatusRequest {
  gstin: string;
  form: ReturnForm;
  period: string;
  providerReference: string | null;
  idempotencyKey: string;
}

export interface GstFilingProvider {
  readonly name: string;
  readonly environment: 'sandbox' | 'production';
  /** Whether this adapter can actually reach a provider right now. */
  readonly available: boolean;
  /**
   * Why it is unavailable, in plain language, for the BUSINESS OWNER.
   * Never contains configuration names -- an owner has no use for those.
   */
  readonly unavailableReason: string | null;
  /** The same thing for whoever runs the app. Never shown in owner screens. */
  readonly operatorDetail: string | null;
  submit(request: FilingRequest): Promise<FilingResponse>;
  /** Query an outcome. Used BEFORE any resubmission after a timeout. */
  queryStatus(request: StatusRequest): Promise<FilingResponse>;
}

export class FilingProviderError extends Error {
  constructor(message: string, public readonly retryable: boolean) {
    super(message);
    this.name = 'FilingProviderError';
  }
}

// ---------------------------------------------------------------------------
// Sandbox adapter
// ---------------------------------------------------------------------------

/**
 * A deterministic sandbox provider.
 *
 * It exercises the whole submission, status and acknowledgement path -- including
 * the failure modes that matter (schema rejection, timeout with an unknown
 * outcome, an already-filed period) -- without contacting anything.
 *
 * Its acknowledgements carry a SANDBOX prefix so that a sandbox ARN can never be
 * mistaken for a real one, in the database or on screen.
 */
export class SandboxFilingProvider implements GstFilingProvider {
  readonly name = 'sandbox';
  readonly environment = 'sandbox' as const;
  readonly available = true;
  readonly unavailableReason = null;
  readonly operatorDetail = null;

  /** Submissions seen, keyed by idempotency key, so a retry returns the same answer. */
  private readonly seen = new Map<string, FilingResponse>();
  /** Periods already filed in this sandbox. */
  private readonly filed = new Set<string>();

  constructor(private readonly behaviour: 'succeed' | 'reject-schema' | 'timeout' | 'already-filed' = 'succeed') {}

  private key(gstin: string, form: ReturnForm, period: string): string {
    return `${gstin}|${form}|${period}`;
  }

  async submit(request: FilingRequest): Promise<FilingResponse> {
    // Idempotency: the same key must never produce a second filing.
    const existing = this.seen.get(request.idempotencyKey);
    if (existing) return existing;

    const periodKey = this.key(request.gstin, request.form, request.period);

    if (this.behaviour === 'already-filed' || this.filed.has(periodKey)) {
      const response: FilingResponse = {
        status: 'rejected',
        providerReference: null,
        arn: null,
        filedAt: null,
        errors: [{ code: 'ALREADY_FILED', message: 'A return has already been filed for this GSTIN, form and period.' }],
      };
      this.seen.set(request.idempotencyKey, response);
      return response;
    }

    if (this.behaviour === 'reject-schema') {
      const response: FilingResponse = {
        status: 'rejected',
        providerReference: `SANDBOX-REF-${request.idempotencyKey.slice(0, 8)}`,
        arn: null,
        filedAt: null,
        errors: [
          { code: 'SCHEMA_INVALID', message: 'Payload failed schema validation.', field: 'b2b[0].inv[0].itms' },
        ],
      };
      this.seen.set(request.idempotencyKey, response);
      return response;
    }

    if (this.behaviour === 'timeout') {
      // Deliberately NOT recorded in `seen`: a timeout means we do not know the
      // outcome, so the caller must query status rather than assume anything.
      throw new FilingProviderError('The provider did not respond in time.', true);
    }

    const response: FilingResponse = {
      status: 'succeeded',
      providerReference: `SANDBOX-REF-${request.idempotencyKey.slice(0, 8)}`,
      // The SANDBOX prefix is load-bearing: it must never look like a real ARN.
      arn: `SANDBOX-ARN-${request.gstin.slice(0, 4)}-${request.period.replace('-', '')}`,
      filedAt: new Date().toISOString(),
      errors: [],
    };
    this.seen.set(request.idempotencyKey, response);
    this.filed.add(periodKey);
    return response;
  }

  async queryStatus(request: StatusRequest): Promise<FilingResponse> {
    const existing = this.seen.get(request.idempotencyKey);
    if (existing) return existing;
    return {
      status: 'unknown',
      providerReference: request.providerReference,
      arn: null,
      filedAt: null,
      errors: [],
    };
  }

  /** Test hook: pretend a period was already filed elsewhere. */
  markFiled(gstin: string, form: ReturnForm, period: string): void {
    this.filed.add(this.key(gstin, form, period));
  }
}

// ---------------------------------------------------------------------------
// Unconfigured adapter
// ---------------------------------------------------------------------------

/**
 * What you get when no provider is configured.
 *
 * It refuses every call with a clear reason. It never falls back to the sandbox
 * and reports success, because "the tests passed" must never be confused with
 * "the return was filed".
 */
export class UnconfiguredFilingProvider implements GstFilingProvider {
  readonly name = 'unconfigured';
  readonly environment = 'sandbox' as const;
  readonly available = false;
  /** For the owner: what is true, and what to do instead. */
  readonly unavailableReason =
    'Filing straight from this app has not been set up. Download the pack below and file on the GST portal, ' +
    'or send the pack to your accountant.';
  /** For the operator: how to change that. Never rendered in owner screens. */
  readonly operatorDetail =
    'No GST filing provider is configured. Set GSP_MODE, GSP_BASE_URL, GSP_CLIENT_ID and GSP_CLIENT_SECRET, ' +
    'and see docs/provider-configuration.md.';

  async submit(): Promise<FilingResponse> {
    throw new FilingProviderError(this.unavailableReason, false);
  }

  async queryStatus(): Promise<FilingResponse> {
    throw new FilingProviderError(this.unavailableReason, false);
  }
}

/**
 * Select the provider from configuration.
 *
 * Production requires BOTH `GSP_MODE=production` AND `GSP_PRODUCTION_ENABLED=true`
 * AND full credentials. Anything less falls back to sandbox or unconfigured --
 * never to a silent production attempt.
 */
export function selectFilingProvider(): GstFilingProvider {
  const config = gspConfig();

  if (config.mode === 'unconfigured') return new UnconfiguredFilingProvider();

  if (config.mode === 'sandbox') return new SandboxFilingProvider('succeed');

  if (config.mode === 'production') {
    if (!config.productionEnabled || !config.baseUrl || !config.clientId || !config.clientSecret) {
      return new UnconfiguredFilingProvider();
    }
    // A real provider adapter is implemented against a specific GSP's published
    // API. Until this deployment has provider access, production submission
    // stays unavailable rather than silently using the sandbox.
    return new UnconfiguredFilingProvider();
  }

  return new UnconfiguredFilingProvider();
}

export function describeFilingCapability(): {
  mode: string;
  available: boolean;
  environment: string;
  productionVerified: boolean;
  /** Plain language, safe to show a business owner. */
  reason: string | null;
  /** Configuration detail, for operator-facing screens and logs only. */
  operatorDetail: string | null;
} {
  const provider = selectFilingProvider();
  const config = gspConfig();
  return {
    mode: config.mode,
    available: provider.available,
    environment: provider.environment,
    // Never claimed without a real provider connection that has been exercised.
    productionVerified: false,
    reason: provider.unavailableReason,
    operatorDetail: provider.operatorDetail,
  };
}
