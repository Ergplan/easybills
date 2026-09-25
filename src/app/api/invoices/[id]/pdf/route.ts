import { NextResponse } from 'next/server';

import { requireBusiness } from '@/server/auth/guard';
import { getInvoice } from '@/server/repos/invoices';
import { renderInvoicePdf } from '@/server/pdf/render';
import { upiQrDataUrl } from '@/server/pdf/upi';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Serve an invoice PDF.
 *
 * The PDF is generated on demand and streamed straight to the owner. It is never
 * written to a public bucket, never given a guessable permanent URL, and the
 * request is authorised against the caller's membership of the business before
 * a single byte is rendered.
 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const url = new URL(request.url);
  const businessId = url.searchParams.get('b') ?? '';
  const disposition = url.searchParams.get('download') === '1' ? 'attachment' : 'inline';

  try {
    const { business } = await requireBusiness(businessId);
    const invoice = await getInvoice(businessId, id);
    if (!invoice) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

    const qr =
      invoice.status === 'issued' && invoice.balancePaise > 0
        ? await upiQrDataUrl({
            bank: invoice.issued?.seller.bank ?? business.bank,
            payeeName: invoice.issued?.seller.legalName ?? business.legalName,
            amountPaise: invoice.balancePaise,
            reference: invoice.number,
          })
        : null;

    const pdf = await renderInvoicePdf(invoice, { upiQrDataUrl: qr });
    const safeNumber = (invoice.number ?? 'draft').replace(/[^A-Za-z0-9\-_]/g, '-');

    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `${disposition}; filename="${safeNumber}.pdf"`,
        // Never cached by a shared cache: this is a private business document.
        'cache-control': 'private, no-store',
      },
    });
  } catch (error) {
    const status = (error as Error)?.name === 'NotAuthorisedError' ? 403 : 500;
    return NextResponse.json(
      { error: status === 403 ? 'You do not have access to this bill.' : 'Could not produce the PDF.' },
      { status },
    );
  }
}
