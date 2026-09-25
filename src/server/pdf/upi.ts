import 'server-only';

import QRCode from 'qrcode';

import type { BankDetails } from '@/lib/domain/types';
import { formatMoneyPlain } from '@/lib/money';

/**
 * UPI payment QR.
 *
 * TWO THINGS THIS IS NOT:
 *  1. It is NOT a government e-invoice QR code. The two look similar to an owner
 *     and mean completely different things, so the PDF says so in plain words
 *     wherever this appears.
 *  2. Its presence is NOT evidence of payment. A scanned code, a screenshot or a
 *     customer's assurance never marks an invoice paid -- only a recorded
 *     payment entry does.
 *
 * The payee details are the owner's OWN saved details, and the UI asks them to
 * confirm those before the code is used, because a wrong VPA sends a customer's
 * money to a stranger.
 */
export async function upiQrDataUrl(args: {
  bank: BankDetails;
  payeeName: string;
  amountPaise?: number;
  reference?: string | null;
}): Promise<string | null> {
  const vpa = args.bank.upiId?.trim();
  if (!vpa) return null;
  if (!/^[\w.\-]{2,60}@[a-zA-Z]{2,30}$/.test(vpa)) return null;

  const params = new URLSearchParams();
  params.set('pa', vpa);
  params.set('pn', args.payeeName.slice(0, 50));
  params.set('cu', 'INR');
  if (args.amountPaise && args.amountPaise > 0) params.set('am', formatMoneyPlain(args.amountPaise));
  if (args.reference) params.set('tn', args.reference.slice(0, 50));

  const uri = `upi://pay?${params.toString()}`;

  try {
    return await QRCode.toDataURL(uri, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 240,
      color: { dark: '#000000', light: '#ffffff' },
    });
  } catch {
    // A QR we cannot draw is simply omitted; it is never replaced with a
    // placeholder that might be scanned.
    return null;
  }
}
