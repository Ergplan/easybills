import { t } from '@/lib/copy';
import type { BillPaper, BillShareAs } from '@/lib/domain/bill-look';

/** Where a bill's file comes from: the owner's saved look unless the link asks for another. */
export function billFileUrl(invoiceId: string, businessId: string, ask: { format?: BillShareAs; paper?: BillPaper; download?: boolean } = {}): string {
  const q = new URLSearchParams({ b: businessId });
  if (ask.format) q.set('format', ask.format);
  if (ask.paper) q.set('paper', ask.paper);
  if (ask.download) q.set('download', '1');
  return `/api/invoices/${invoiceId}/pdf?${q}`;
}

/** The bill as a File for the share sheet: a PDF or a photo, named after its number. */
export async function fetchBillFile(url: string, number: string): Promise<File> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(t('error.generic'));
  const blob = await res.blob();
  const photo = blob.type === 'image/jpeg';
  return new File([blob], `${number || 'bill'}.${photo ? 'jpg' : 'pdf'}`, { type: photo ? 'image/jpeg' : 'application/pdf' });
}

/** Where the share sheet cannot take a file: save it, so it can be attached by hand. */
export function saveFile(file: File): void {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.click();
  URL.revokeObjectURL(url);
}
