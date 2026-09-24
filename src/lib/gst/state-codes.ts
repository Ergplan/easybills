/**
 * GST state codes (the first two digits of a GSTIN).
 *
 * PROVENANCE: these codes and the SGST/UTGST distinction are structural
 * reference data, not a tax computation. They are seeded here so the app can
 * tell same-state from interstate supply. `taxAuthority` decides whether the
 * state half of an intra-state supply is SGST or UTGST: Union Territories
 * WITHOUT a legislature levy UTGST; UTs with a legislature (Delhi, Puducherry,
 * Jammu & Kashmir) levy SGST like a State.
 *
 * This table must be re-checked against the official list before production
 * use -- see docs/compliance/README.md. It is versioned so a correction is a
 * visible change, not a silent edit.
 */

export const STATE_CODE_TABLE_VERSION = '2026-09-24.1';

export type TaxAuthority = 'SGST' | 'UTGST';

export interface GstState {
  code: string;
  name: string;
  taxAuthority: TaxAuthority;
  /** Union Territory (with or without legislature). */
  unionTerritory: boolean;
}

export const GST_STATES: readonly GstState[] = [
  { code: '01', name: 'Jammu and Kashmir', taxAuthority: 'SGST', unionTerritory: true },
  { code: '02', name: 'Himachal Pradesh', taxAuthority: 'SGST', unionTerritory: false },
  { code: '03', name: 'Punjab', taxAuthority: 'SGST', unionTerritory: false },
  { code: '04', name: 'Chandigarh', taxAuthority: 'UTGST', unionTerritory: true },
  { code: '05', name: 'Uttarakhand', taxAuthority: 'SGST', unionTerritory: false },
  { code: '06', name: 'Haryana', taxAuthority: 'SGST', unionTerritory: false },
  { code: '07', name: 'Delhi', taxAuthority: 'SGST', unionTerritory: true },
  { code: '08', name: 'Rajasthan', taxAuthority: 'SGST', unionTerritory: false },
  { code: '09', name: 'Uttar Pradesh', taxAuthority: 'SGST', unionTerritory: false },
  { code: '10', name: 'Bihar', taxAuthority: 'SGST', unionTerritory: false },
  { code: '11', name: 'Sikkim', taxAuthority: 'SGST', unionTerritory: false },
  { code: '12', name: 'Arunachal Pradesh', taxAuthority: 'SGST', unionTerritory: false },
  { code: '13', name: 'Nagaland', taxAuthority: 'SGST', unionTerritory: false },
  { code: '14', name: 'Manipur', taxAuthority: 'SGST', unionTerritory: false },
  { code: '15', name: 'Mizoram', taxAuthority: 'SGST', unionTerritory: false },
  { code: '16', name: 'Tripura', taxAuthority: 'SGST', unionTerritory: false },
  { code: '17', name: 'Meghalaya', taxAuthority: 'SGST', unionTerritory: false },
  { code: '18', name: 'Assam', taxAuthority: 'SGST', unionTerritory: false },
  { code: '19', name: 'West Bengal', taxAuthority: 'SGST', unionTerritory: false },
  { code: '20', name: 'Jharkhand', taxAuthority: 'SGST', unionTerritory: false },
  { code: '21', name: 'Odisha', taxAuthority: 'SGST', unionTerritory: false },
  { code: '22', name: 'Chhattisgarh', taxAuthority: 'SGST', unionTerritory: false },
  { code: '23', name: 'Madhya Pradesh', taxAuthority: 'SGST', unionTerritory: false },
  { code: '24', name: 'Gujarat', taxAuthority: 'SGST', unionTerritory: false },
  { code: '26', name: 'Dadra and Nagar Haveli and Daman and Diu', taxAuthority: 'UTGST', unionTerritory: true },
  { code: '27', name: 'Maharashtra', taxAuthority: 'SGST', unionTerritory: false },
  { code: '29', name: 'Karnataka', taxAuthority: 'SGST', unionTerritory: false },
  { code: '30', name: 'Goa', taxAuthority: 'SGST', unionTerritory: false },
  { code: '31', name: 'Lakshadweep', taxAuthority: 'UTGST', unionTerritory: true },
  { code: '32', name: 'Kerala', taxAuthority: 'SGST', unionTerritory: false },
  { code: '33', name: 'Tamil Nadu', taxAuthority: 'SGST', unionTerritory: false },
  { code: '34', name: 'Puducherry', taxAuthority: 'SGST', unionTerritory: true },
  { code: '35', name: 'Andaman and Nicobar Islands', taxAuthority: 'UTGST', unionTerritory: true },
  { code: '36', name: 'Telangana', taxAuthority: 'SGST', unionTerritory: false },
  { code: '37', name: 'Andhra Pradesh', taxAuthority: 'SGST', unionTerritory: false },
  { code: '38', name: 'Ladakh', taxAuthority: 'UTGST', unionTerritory: true },
  { code: '97', name: 'Other Territory', taxAuthority: 'UTGST', unionTerritory: true },
];

const BY_CODE = new Map(GST_STATES.map((s) => [s.code, s]));

export function findState(code: string | null | undefined): GstState | null {
  if (!code) return null;
  return BY_CODE.get(String(code).padStart(2, '0')) ?? null;
}

export function stateName(code: string | null | undefined): string {
  return findState(code)?.name ?? 'Unknown state';
}
