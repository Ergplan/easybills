# Compliance scope

**Dated: 25 September 2026.** Re-check before any release.

This document states exactly which transactions this release handles, which it
refuses, and where every legally-determined value came from. There is no blanket
claim that bills produced here are "GST compliant".

---

## 1. The verification gap in this build

**No legal parameter in the shipped rule pack has been verified against an
official source.**

The official domains — `cbic-gst.gov.in`, `www.gst.gov.in`,
`tutorial.gst.gov.in`, `gstn.org.in`, `einvoice1.gst.gov.in` — were all
unreachable from the network this application was built in. Rather than fill the
gaps from memory, which would produce plausible-looking wrong thresholds and
invented deadlines, every such value ships as `null` with
`provenance.status = 'unverified'`.

```bash
npm run gst:audit-rules
```

```
Rule pack: 0.0.0-unverified
Verified:  0 of 11

NOT VERIFIED — the features depending on these are blocked or degraded:
  - eInvoicing.aggregateTurnoverThreshold
  - hsnDigits
  - dueDates.gstr1Monthly
  - dueDates.gstr1Quarterly
  - dueDates.gstr3bMonthly
  - dueDates.gstr3bQuarterly
  - dueDates.iff
  - selectableRates
  - invoiceRounding
  - schemaVersions.gstr1
  - schemaVersions.gstr3b
```

### What that means in the running app

| Unverified value | Consequence |
|---|---|
| e-invoicing threshold | A regular registrant cannot issue until they confirm, once, that e-invoicing does not apply to them. We cannot check it for them |
| Filing due dates | The GST screen shows *"we do not have a confirmed rule for it"* instead of a date. It never invents one |
| HSN digit requirements | HSN is optional and unvalidated; the field is available but no minimum is enforced |
| Schema versions | No upload file is produced. The accountant pack is plainly labelled as workings, not as a portal upload |
| Rate list | The slabs are offered as *choices*. The owner picks; the app never infers a rate |
| Invoice rounding | Round-to-rupee is on by default and shown as its own visible line, so the arithmetic always reconciles |

GST **return readiness is blocked outright** while any rule is unverified. The
blocker is addressed to the operator, not the owner:

> Some GST rules this return depends on have not been confirmed against the
> official source in this installation.

### How to close the gap

For each entry in `src/lib/gst/ruleset.ts`:

1. Read the value from the official source recorded in `provenance.source`.
2. Set `value`, `effectiveFrom`, and `effectiveTo` where the rule has an end.
3. Set `provenance.verifiedOn` (the date you checked), `provenance.verifiedBy`
   (a person or an authorised provider feed), and `provenance.status` to
   `'verified'`.
4. Bump `version`.
5. Run `npm run gst:audit-rules` until it exits zero.

Approvals record the rule-pack version they were made under, so a later rule
change is visible in the history rather than retroactively rewriting a return.

---

## 2. Supported transactions

**Billing**

1. Businesses **not registered for GST**, billing customers in India in rupees.
   No tax is added, and the document is titled "Invoice".
2. **Regular GST registrants** making ordinary domestic supplies, where:
   - the place of supply is confirmed on each bill by the owner,
   - tax is payable by the supplier (not the customer under reverse charge),
   - the supply is taxable (not exempt, nil-rated or non-GST),
   - e-invoicing does not apply, and the owner has confirmed this.

   Same-state supplies produce CGST + SGST (or UTGST where the place of supply
   is a Union Territory without a legislature). Interstate supplies produce
   IGST. Compensation cess is carried as a separate head.

**Returns** — regular taxpayers only, monthly or QRMP, GSTR-1 and GSTR-3B
workings, GSTR-2B reconciliation, and an accountant pack.

---

## 3. Unsupported — issuance is refused, drafts are kept

Every case below blocks *issuing* while preserving whatever the owner typed, and
explains itself in plain language with a next step.

| Case | Why |
|---|---|
| Composition scheme | Needs a bill of supply and CMP-08/GSTR-4. An explicit later extension |
| Exports | Zero-rating, LUT/bond and shipping-bill handling are not implemented |
| SEZ supplies | Same |
| Deemed exports | Same |
| Reverse charge | The tax is the recipient's; this release does not compute it |
| Advance receipts | Time-of-supply and adjustment rules are not implemented |
| Exempt / nil-rated | Needs a bill of supply, not a tax invoice |
| Non-GST supplies | Outside GST entirely |
| E-invoicing applicable | No IRP integration. A PDF alone is not a covered document |
| GST status "not sure" | We will not issue a document whose legal basis is unknown |
| Multiple GSTINs or locations | One business, one registration, one place |
| Currencies other than INR | Only rupees |

There is deliberately **no generic "add tax" toggle**. A toggle would let an
owner produce something that looks like a tax invoice for a transaction this
release has not verified.

### Not supported in returns

Reverse-charge liability, imports, advances and anything else this release
cannot compute **blocks complete-return readiness** and is routed to accountant
review. A tax obligation is never omitted merely because the billing module
cannot originate it. Composition returns (CMP-08, GSTR-4) and annual returns
(GSTR-9, GSTR-9C) are explicit later extensions and are not routed through the
regular-taxpayer flow.

---

## 4. Structural reference data

Some data is *structural* rather than a tax computation, and is encoded directly
with a version so a correction is a visible change:

| Data | Where | Version |
|---|---|---|
| GST state codes and SGST/UTGST split | `src/lib/gst/state-codes.ts` | `2026-09-24.1` |
| GSTIN format and check digit | `src/lib/gst/gstin.ts` | published mod-36 scheme |
| Financial year (1 April – 31 March) | `src/lib/dates/index.ts` | — |
| GST quarters (Apr–Jun, Jul–Sep, Oct–Dec, Jan–Mar) | `src/lib/dates/index.ts` | — |

A GSTIN check proves the string is well-formed and internally consistent. It
does **not** prove the GSTIN exists, is active, or belongs to the named party.
The app says "format looks right", never "verified".

---

## 5. Money and rounding

Documented in full in `src/lib/money/index.ts`.

- Money: integer **paise**. Quantity: integer **milli-units**. Rates: integer
  **basis points**. No floating-point arithmetic touches an amount.
- Rounding is **half-up away from zero**, applied once at each of three
  boundaries: the line taxable value, each tax head separately, and the optional
  round-off of the invoice total to the nearest rupee.
- CGST and SGST are each computed from the taxable value at half the rate,
  independently. Neither is derived from the other, and an odd-rate split that
  differs by a paise is *reported*, not absorbed.
- The rupee round-off is carried as its own visible line, so the total always
  reconciles to its parts.

---

## 6. Issuance integrity

- Issuing happens in one transaction: re-price from stored lines, re-assess
  legality, allocate the financial-year number, reserve the formatted number,
  write the snapshot.
- Concurrent or repeated issue attempts produce exactly one invoice. Ten
  simultaneous attempts are covered by a test.
- Issued records are immutable. Business and customer edits apply prospectively;
  a test changes the business name, address and GSTIN after issuing and asserts
  the invoice is untouched.
- Numbers are never silently reused: the sequence cannot move backwards once a
  bill has been issued, and the formatted number is reserved so a prefix change
  cannot produce a duplicate.
- PDF rendering is outside the issuance transaction. A failed render re-renders
  the same issued invoice; it never issues a second one.
- Corrections go through credit and debit notes, which preserve reason, actor
  and time. A customer-balance correction is recorded separately from a claim
  that tax liability changed (`affectsTaxLiability`).

---

## 7. Sources to verify against

Starting points, recorded here so the next person knows where to look. These are
**not** a compliance sign-off, and none of them was reachable from this build.

| What | Source |
|---|---|
| Tax invoice particulars, credit/debit notes | https://cbic-gst.gov.in/gst-invoice-rules.html |
| Rates | https://cbic-gst.gov.in/gst-goods-services-rates.html |
| Returns, forms and due dates | https://www.gst.gov.in/help/returns |
| GSTR-1 guide | https://tutorial.gst.gov.in/userguide/returns/GSTR_1.htm |
| GSTR-1A FAQ | https://tutorial.gst.gov.in/downloads/news/creative_faqs_on_gstr1a_fo_cr25785.pdf |
| GSTR-2B FAQ | https://tutorial.gst.gov.in/userguide/returns/FAQ_gstr2b.htm |
| IMS advisory | https://tutorial.gst.gov.in/downloads/news/revised_advisory_on_ims.pdf |
| e-invoicing | https://einvoice1.gst.gov.in/ |
| GSP ecosystem | https://www.gstn.org.in/gsp-ecosystem |
| Empanelled GSPs | https://gstn.org.in/empanelled-gsps |

---

## 8. Launch gates

Not met at the time of writing:

- [ ] Every rule-pack value verified, dated and attributed (`npm run gst:audit-rules` exits zero)
- [ ] **A qualified GST practitioner has reviewed the return workflows.** This has not happened. Nothing in this repository should be read as implying it has
- [ ] The supported-scenario list re-checked against current law
- [ ] E-invoicing applicability screened against verified turnover history and exclusions, not just current turnover
- [ ] Return payloads validated against the current official schema
- [ ] A provider contract in place before any production filing
