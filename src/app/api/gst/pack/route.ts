import { NextResponse } from 'next/server';

import { isMonthPeriod } from '@/lib/dates';
import { buildAccountantPack } from '@/lib/gst-returns/export';
import { RETURN_STATUS_LABELS } from '@/lib/gst-returns/types';
import { requireBusiness } from '@/server/auth/guard';
import { preparePeriod } from '@/server/gst/prepare';
import { getReturnPeriod } from '@/server/gst/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The accountant pack.
 *
 * Several CSVs and a README, concatenated into one plain-text download so it
 * needs no zip library and opens anywhere. Every file states the period, the
 * GSTIN and -- prominently -- that a prepared return is not a filed one.
 *
 * It is NOT labelled as a portal upload file, because it is not one. Inventing
 * an upload format would be worse than offering none.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const businessId = url.searchParams.get('b') ?? '';
  const period = url.searchParams.get('period') ?? '';

  try {
    const { business } = await requireBusiness(businessId);
    if (!isMonthPeriod(period)) {
      return NextResponse.json({ error: 'Choose a valid period.' }, { status: 400 });
    }
    if (!business.gstReturns) {
      return NextResponse.json({ error: 'GST returns are not set up.' }, { status: 400 });
    }

    const prepared = await preparePeriod({ business, period, persistFindings: false });
    const returnPeriod = await getReturnPeriod(business.id, business.gstReturns.gstin, 'GSTR-3B', period);

    const files = buildAccountantPack({
      gstin: prepared.gstin,
      period,
      businessName: business.legalName,
      outwardDocuments: prepared.outwardDocuments,
      supplierBills: prepared.supplierBills,
      findings: prepared.findings,
      gstr1: prepared.gstr1,
      gstr3b: prepared.gstr3b,
      rulePackVersion: prepared.rulePackVersion,
      preparedAt: new Date().toISOString(),
      statusLabel: RETURN_STATUS_LABELS[returnPeriod?.status ?? 'draft'],
    });

    const body = files
      .map((f) => `===== ${f.filename} =====\n${f.content}\n`)
      .join('\n');

    return new NextResponse(body, {
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'content-disposition': `attachment; filename="gst-pack-${prepared.gstin}-${period}.txt"`,
        'cache-control': 'private, no-store',
      },
    });
  } catch (error) {
    const status = (error as Error)?.name === 'NotAuthorisedError' ? 403 : 500;
    return NextResponse.json(
      { error: status === 403 ? 'You do not have access to this business.' : 'Could not build the pack.' },
      { status },
    );
  }
}
