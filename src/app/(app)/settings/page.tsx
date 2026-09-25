import { auditRulePack } from '@/lib/gst/ruleset';
import { SUPPORTED_SCENARIOS_SUMMARY, UNSUPPORTED_SCENARIOS_SUMMARY } from '@/lib/gst/scenarios';
import { TopBar } from '@/components/TopBar';
import { requireCurrentContext } from '@/server/auth/current';
import { describeAiConfiguration } from '@/server/ai/adapters';
import { gspConfig } from '@/lib/env';

import { SettingsForm } from './SettingsForm';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const { business, user } = await requireCurrentContext();
  const audit = auditRulePack();
  const ai = describeAiConfiguration();
  const gsp = gspConfig();

  return (
    <>
      <TopBar title="Business details" back={{ href: '/home' }} showProfile={false} />
      <main className="page">
        <SettingsForm
          business={business}
          userEmail={user.email}
          ruleAudit={audit}
          aiStatus={ai}
          gspMode={gsp.mode}
          supported={[...SUPPORTED_SCENARIOS_SUMMARY]}
          unsupported={[...UNSUPPORTED_SCENARIOS_SUMMARY]}
        />
      </main>
    </>
  );
}
