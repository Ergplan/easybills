import { NextResponse } from 'next/server';

import { isMonthPeriod } from '@/lib/dates';
import { quarterBounds, quarterCsv } from '@/lib/domain/gst-summary';
import { zipStore } from '@/lib/zip';
import { requireBusiness } from '@/server/auth/guard';
import { listIssuedBetween } from '@/server/repos/invoices';
import { renderInvoicePdf } from '@/server/pdf/render';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * "CA ko bhejo": one zip with the quarter's spreadsheet and every bill as
 * a PDF. Built on demand, never stored, authorised against the caller's
 * membership before anything is read.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const businessId = url.searchParams.get('b') ?? '';
  const month = url.searchParams.get('q') ?? '';

  try {
    const { business } = await requireBusiness(businessId);
    if (!isMonthPeriod(month)) return NextResponse.json({ error: 'Choose a valid quarter.' }, { status: 400 });

    const { from, to, label } = quarterBounds(month);
    const issued = await listIssuedBetween(businessId, from, to);
    const entries = [
      { name: `bikri-${label.replace(/[^A-Za-z0-9-]+/g, '-')}.csv`, data: new TextEncoder().encode('﻿' + quarterCsv(issued, month, { name: business.legalName, gstin: business.gstin })) },
    ];
    for (const inv of issued) {
      const pdf = await renderInvoicePdf(inv, { upiQrDataUrl: null });
      const safe = (inv.number ?? inv.id).replace(/[^A-Za-z0-9\-_]/g, '-');
      entries.push({ name: `bills/${safe}.pdf`, data: new Uint8Array(pdf) });
    }

    const zip = zipStore(entries);
    return new NextResponse(new Blob([zip as BlobPart]), {
      headers: {
        'content-type': 'application/zip',
        'content-disposition': `attachment; filename="gst-${label.replace(/[^A-Za-z0-9-]+/g, '-')}.zip"`,
        'cache-control': 'private, no-store',
      },
    });
  } catch (error) {
    const status = (error as Error)?.name === 'NotAuthorisedError' ? 403 : 500;
    return NextResponse.json({ error: status === 403 ? 'No access.' : 'Could not build the pack.' }, { status });
  }
}
