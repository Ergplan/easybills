import Link from 'next/link';

import { Icon } from '@/components/Icon';
import { t } from '@/lib/copy';
import { contractReaderConfig } from '@/lib/env';
import { gstTabVisible } from '@/lib/domain/gst-tab';
import { DEFAULT_RULE_PACK } from '@/lib/gst/ruleset';
import { requireCurrentContext } from '@/server/auth/current';
import { getCustomer, listCustomers } from '@/server/repos/customers';
import { billsForProject, getProject, listProjectsForCustomer } from '@/server/repos/projects';

import { HelpAgent, type ProjectSummary } from './HelpAgent';

export const dynamic = 'force-dynamic';

/** "Mera bill thoda complex hai, help karo." */
export default async function HelpPage({
  searchParams,
}: {
  searchParams: Promise<{ customer?: string; project?: string; from?: string }>;
}) {
  const params = await searchParams;
  const { business } = await requireCurrentContext();
  const customer = params.customer ? await getCustomer(business.id, params.customer) : null;
  const customers = customer ? [] : (await listCustomers(business.id, { limit: 200 })).map((c) => ({ id: c.id, name: c.name }));

  let projects: ProjectSummary[] = [];
  if (customer) {
    const list = await listProjectsForCustomer(business.id, customer.id);
    projects = await Promise.all(
      list.map(async (p) => {
        const { entries } = await billsForProject(business.id, p.id);
        return {
          id: p.id,
          name: p.name,
          totalPaise: p.totalPaise,
          billedPaise: entries.filter((e) => e.status === 'issued').reduce((s, e) => s + e.basisPaise, 0),
        };
      }),
    );
  }

  const record = params.project ? await getProject(business.id, params.project) : null;
  const project = record && customer && record.customerId === customer.id ? record : null;
  const entries = project ? (await billsForProject(business.id, project.id)).entries : [];
  const chargesGst = gstTabVisible(business);

  return (
    <main className="page">
      <div className="row">
        <Link
          href={params.from ? `/bills/${params.from}` : '/home'}
          className="btn btn--ghost"
          aria-label={t('common.back')}
          style={{ paddingInline: 8 }}
        >
          <Icon name="back" size={20} />
        </Link>
        <div className="grow">
          <h1 style={{ fontSize: '1.3rem' }}>{t('help.title')}</h1>
          {customer && <p className="faint">{customer.name}</p>}
        </div>
      </div>
      <HelpAgent
        key={`${customer?.id ?? ''}:${project?.id ?? ''}`}
        businessId={business.id}
        customers={customers}
        customer={customer ? { id: customer.id, name: customer.name } : null}
        projects={projects}
        project={
          project
            ? {
                id: project.id,
                name: project.name,
                totalPaise: project.totalPaise,
                gstMode: project.gstMode,
                gstRateBp: project.gstRateBp,
                billing: project.billing,
                milestones: project.milestones,
                retentionBp: project.retentionBp,
              }
            : null
        }
        entries={entries}
        fromDraftId={params.from ?? null}
        chargesGst={chargesGst}
        ratesBp={[...DEFAULT_RULE_PACK.selectableRates.value]}
        defaultRateBp={chargesGst ? business.defaultTaxRateBp ?? 1800 : null}
        modelReader={contractReaderConfig().enabled}
      />
    </main>
  );
}
