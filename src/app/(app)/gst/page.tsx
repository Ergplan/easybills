import { redirect } from 'next/navigation';

import { addMonthsToPeriod, monthPeriodOf, todayIst, type MonthPeriod } from '@/lib/dates';
import { isMonthPeriod } from '@/lib/dates';
import { TopBar } from '@/components/TopBar';
import { requireCurrentContext } from '@/server/auth/current';
import { describeFilingCapability } from '@/server/gst/filing/provider';
import { preparePeriod } from '@/server/gst/prepare';
import { getReturnPeriod } from '@/server/gst/repo';
import { returnPeriodId } from '@/server/firebase/paths';

import { GstSetup } from './GstSetup';
import { GstGuide } from './GstGuide';

export const dynamic = 'force-dynamic';

export default async function GstPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const params = await searchParams;
  const { business } = await requireCurrentContext();

  // The module is hidden entirely from businesses it does not apply to.
  if (business.registrationType !== 'regular') redirect('/home');

  if (!business.gstReturns) {
    return (
      <>
        <TopBar title="GST returns" back={{ href: '/home' }} />
        <main className="page">
          <GstSetup businessId={business.id} suggestedGstin={business.gstin ?? ''} />
        </main>
      </>
    );
  }

  // Default to the month just gone, which is the one an owner is working on.
  const fallback: MonthPeriod = addMonthsToPeriod(monthPeriodOf(todayIst()), -1);
  const period: MonthPeriod = params.period && isMonthPeriod(params.period) ? params.period : fallback;

  const prepared = await preparePeriod({ business, period });
  const returnPeriod = await getReturnPeriod(business.id, business.gstReturns.gstin, 'GSTR-3B', period);
  const filing = describeFilingCapability();

  return (
    <>
      <TopBar title="GST returns" back={{ href: '/home' }} />
      <main className="page page--wide">
        <GstGuide
          businessId={business.id}
          businessName={business.legalName}
          prepared={JSON.parse(JSON.stringify(prepared))}
          status={returnPeriod?.status ?? 'draft'}
          completeness={returnPeriod?.completeness ?? null}
          filingCapability={filing}
          periodId={returnPeriodId(business.gstReturns.gstin, 'GSTR-3B', period)}
          filingFrequency={business.gstReturns.filingFrequency}
        />
      </main>
    </>
  );
}
