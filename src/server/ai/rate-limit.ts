import 'server-only';

import { aiConfig } from '@/lib/env';
import { withTx } from '@/server/db/pool';

/**
 * Per-business request budget, enforced server-side.
 *
 * Counted in Postgres rather than in memory so the limit holds across server
 * instances and restarts. Both an hourly and a daily cap apply, because a
 * runaway loop and a slow grind cost the same money by different routes.
 */
export class RateLimitedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RateLimitedError';
  }
}

export async function consumeAiBudget(businessId: string, kind: 'interpret' | 'transcribe'): Promise<void> {
  const config = aiConfig();
  const now = new Date();
  const hourKey = `${kind}__${now.toISOString().slice(0, 13)}`;
  const dayKey = `${kind}__${now.toISOString().slice(0, 10)}`;

  await withTx(async (tx) => {
    // Old windows are cleared as new ones are counted; nothing else reads them.
    await tx.query('delete from ai_usage where business_id = $1 and expires_at < now()', [businessId]);
    const { rows } = await tx.query<{ key: string; count: number }>(
      'select key, count from ai_usage where business_id = $1 and key = any($2) for update',
      [businessId, [hourKey, dayKey]],
    );
    const hourCount = rows.find((r) => r.key === hourKey)?.count ?? 0;
    const dayCount = rows.find((r) => r.key === dayKey)?.count ?? 0;

    if (hourCount >= config.maxRequestsPerHour) {
      throw new RateLimitedError('You have used the assistant a lot in the last hour. Please try again shortly, or type the bill.');
    }
    if (dayCount >= config.maxRequestsPerDay) {
      throw new RateLimitedError('You have reached today’s limit for the assistant. You can still type your bills as usual.');
    }

    const bump = `insert into ai_usage (business_id, key, count, expires_at) values ($1, $2, 1, now() + $3::interval)
       on conflict (business_id, key) do update set count = ai_usage.count + 1`;
    await tx.query(bump, [businessId, hourKey, '3 hours']);
    await tx.query(bump, [businessId, dayKey, '3 days']);
  });
}
