import type { CustomerRecord, InvoiceRecord, SavedItemRecord } from '@/lib/domain/types';
import type { SupplyFlag } from '@/lib/gst/scenarios';

/**
 * Editor state keeps money and quantity as the STRINGS the owner typed.
 *
 * Parsing happens on save, server-side, so a half-typed "12." never becomes 0,
 * the cursor never jumps while typing, and nothing is silently reformatted
 * underneath the owner's fingers.
 */
export interface LineDraft {
  id: string;
  description: string;
  quantity: string;
  unitPrice: string;
  discount: string;
  taxRate: string;
  unit: string;
  hsnCode: string;
  priceIncludesTax: boolean;
  savedItemId: string | null;
  saveForNextTime: boolean;
}

export interface EditorState {
  kind: 'quick-bill' | 'customer-invoice';
  issueDate: string;
  dueDate: string | null;
  paymentTermsDays: number | null;
  customer: {
    customerId: string | null;
    name: string;
    phone: string;
    email: string;
    addressLine1: string;
    city: string;
    pincode: string;
    stateCode: string;
    gstin: string;
    pan: string;
  };
  placeOfSupplyStateCode: string;
  supplyFlags: SupplyFlag[];
  lines: LineDraft[];
  notes: string;
  revision: number;
}

export interface EditorBootstrap {
  businessId: string;
  invoice: InvoiceRecord;
  recentCustomers: CustomerRecord[];
  savedItems: SavedItemRecord[];
  sellerStateCode: string | null;
  chargesGst: boolean;
  selectableRatesBp: number[];
  defaultTaxRateBp: number | null;
  aiEnabled: boolean;
}

export function emptyLine(taxRate = ''): LineDraft {
  return {
    id: crypto.randomUUID(),
    description: '',
    quantity: '1',
    unitPrice: '',
    discount: '',
    taxRate,
    unit: '',
    hsnCode: '',
    priceIncludesTax: false,
    savedItemId: null,
    saveForNextTime: false,
  };
}
