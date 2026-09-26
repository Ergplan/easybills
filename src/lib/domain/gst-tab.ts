import type { BusinessRecord } from '@/lib/domain/types';

/**
 * The GST tab exists only for a business with a GST number. Registration
 * type follows the number (see `parseProfile`), so both are checked here in
 * case an older record has one without the other.
 */
export function gstTabVisible(business: Pick<BusinessRecord, 'gstin' | 'registrationType'>): boolean {
  return Boolean(business.gstin) && business.registrationType === 'regular';
}
