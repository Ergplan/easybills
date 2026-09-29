import { NextResponse } from 'next/server';

import { checkLogo, parseLook } from '@/lib/domain/bill-look';
import { requireBusiness } from '@/server/auth/guard';
import { renderInvoiceImage } from '@/server/pdf/render';
import { sampleInvoice } from '@/server/pdf/sample';
import { upiQrDataUrl } from '@/server/pdf/upi';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * "Namuna bill dekho": a made-up bill in the owner's name, drawn with the
 * choices on the Aap screen -- including ones not saved yet, like a logo
 * just picked -- as a picture to show right there. Nothing is stored.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { businessId?: string; design?: string; paper?: string; accent?: string; logoDataUrl?: string | null };
    const { business } = await requireBusiness(String(body.businessId ?? ''));
    const look = parseLook(body);
    const logo = checkLogo(body.logoDataUrl ?? null);
    const invoice = sampleInvoice({ ...business, accentColour: look.accent, logoDataUrl: logo.ok ? logo.value : business.logoDataUrl });
    const qr = await upiQrDataUrl({ bank: business.bank, payeeName: business.legalName, amountPaise: invoice.totals.grandTotalPaise, reference: null });
    const image = await renderInvoiceImage(invoice, { upiQrDataUrl: qr, look, watermark: 'SAMPLE' });
    return new NextResponse(new Uint8Array(image), {
      headers: { 'content-type': 'image/jpeg', 'cache-control': 'private, no-store' },
    });
  } catch (error) {
    const status = (error as Error)?.name === 'NotAuthorisedError' ? 403 : 500;
    return NextResponse.json({ error: status === 403 ? 'Not allowed.' : 'Could not draw the sample.' }, { status });
  }
}
