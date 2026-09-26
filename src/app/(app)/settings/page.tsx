import { auditRulePack } from '@/lib/gst/ruleset';
import { SUPPORTED_SCENARIOS_SUMMARY, UNSUPPORTED_SCENARIOS_SUMMARY } from '@/lib/gst/scenarios';
import { TopBar } from '@/components/TopBar';
import { requireCurrentContext } from '@/server/auth/current';
import { describeAiConfiguration } from '@/server/ai/adapters';
import { backgroundWorkConfigured, gspConfig } from '@/lib/env';
import { pdfCapability } from '@/server/pdf/render';

import { SettingsForm } from './SettingsForm';

export const dynamic = 'force-dynamic';

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  // Only ever an in-app path, never an arbitrary URL somebody could hand us.
  const returnTo = typeof params.next === 'string' && /^\/bills\/[A-Za-z0-9-]{1,64}$/.test(params.next)
    ? params.next
    : null;

  const { business, user } = await requireCurrentContext();
  const audit = auditRulePack();
  const ai = describeAiConfiguration();
  const gsp = gspConfig();
  // Whether this deployment can actually produce a PDF. Asked here rather than
  // discovered when an owner taps Download on a bill they have already sent.
  const pdf = await pdfCapability();
  const backgroundWork = backgroundWorkConfigured();

  return (
    <>
      <TopBar title="Business details" back={{ href: returnTo ?? '/home' }} showProfile={false} />
      <main className="page">
        <SettingsForm
          returnTo={returnTo}
          business={business}
          userEmail={user.email}
          ruleAudit={audit}
          aiStatus={ai}
          gspMode={gsp.mode}
          pdfStatus={pdf}
          backgroundWork={backgroundWork}
          supported={[...SUPPORTED_SCENARIOS_SUMMARY]}
          unsupported={[...UNSUPPORTED_SCENARIOS_SUMMARY]}
        />
      </main>
    </>
  );
}
