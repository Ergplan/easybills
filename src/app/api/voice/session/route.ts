import { NextResponse } from 'next/server';

import { t } from '@/lib/copy';
import { voiceConfig } from '@/lib/env';
import { realtimeSessionBody } from '@/lib/voice/session';
import { requireCurrentContext } from '@/server/auth/current';
import { listCustomers } from '@/server/repos/customers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Mint a short-lived client secret for one voice session.
 *
 * The real OpenAI key stays here. The browser gets a secret that lasts ten
 * minutes and opens exactly one Realtime session, with these instructions
 * and these tools baked in server-side so the page cannot widen them.
 */
export async function POST() {
  const config = voiceConfig();
  if (!config.enabled || !config.apiKey) {
    return NextResponse.json({ error: t('voice.off') }, { status: 503 });
  }
  try {
    const { business } = await requireCurrentContext();
    const customers = (await listCustomers(business.id, { limit: 200 })).map((c) => ({ id: c.id, name: c.name }));
    const res = await fetch(`${config.baseUrl}/v1/realtime/client_secrets`, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(realtimeSessionBody({ businessName: business.legalName, customers, model: config.model, voice: config.voice })),
    });
    if (!res.ok) {
      console.error('[easybills] voice session refused', res.status, await res.text().catch(() => ''));
      return NextResponse.json({ error: t('voice.failed') }, { status: 502 });
    }
    const body = (await res.json()) as { value?: string; expires_at?: number };
    if (!body.value) return NextResponse.json({ error: t('voice.failed') }, { status: 502 });
    return NextResponse.json({ secret: body.value, expiresAt: body.expires_at ?? null, model: config.model, baseUrl: config.baseUrl });
  } catch (error) {
    console.error('[easybills] voice session failed', error);
    return NextResponse.json({ error: t('voice.failed') }, { status: 500 });
  }
}
