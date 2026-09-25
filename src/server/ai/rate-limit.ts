import 'server-only';

import { aiConfig } from '@/lib/env';
import { db } from '@/server/firebase/admin';
import { aiUsageCol } from '@/server/firebase/paths';

/**
 * Per-business request budget, enforced server-side.
 *
 * Counted in Firestore rather than in memory so the limit holds across server
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

  await db().runTransaction(async (tx) => {
    const hourRef = aiUsageCol(businessId).doc(hourKey);
    const dayRef = aiUsageCol(businessId).doc(dayKey);
    const [hourSnap, daySnap] = await tx.getAll(hourRef, dayRef);

    const hourCount = (hourSnap.data()?.count as number | undefined) ?? 0;
    const dayCount = (daySnap.data()?.count as number | undefined) ?? 0;

    if (hourCount >= config.maxRequestsPerHour) {
      throw new RateLimitedError('You have used the assistant a lot in the last hour. Please try again shortly, or type the bill.');
    }
    if (dayCount >= config.maxRequestsPerDay) {
      throw new RateLimitedError('You have reached today’s limit for the assistant. You can still type your bills as usual.');
    }

    // Expiry lets a scheduled cleanup remove old counters without a scan.
    tx.set(hourRef, { kind, window: 'hour', count: hourCount + 1, expiresAt: Date.now() + 3 * 3600_000 });
    tx.set(dayRef, { kind, window: 'day', count: dayCount + 1, expiresAt: Date.now() + 3 * 86_400_000 });
  });
}
