import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';

import { jobRunnerSecret } from '@/lib/env';
import { queueDailySweep, runDueJobs } from '@/server/jobs/runner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The endpoint a hosted scheduler (Cloud Scheduler, cron, a platform job) pokes.
 *
 * It is protected by a shared secret compared in constant time, and it is the
 * only way to trigger background work over HTTP. It does no work itself beyond
 * queueing the daily sweep and draining due jobs, so a scheduler that fires
 * twice, late, or not at all still converges on the right drafts.
 */
function authorised(request: Request): boolean {
  const header = request.headers.get('authorization') ?? '';
  const presented = header.startsWith('Bearer ') ? header.slice(7) : '';
  let expected: string;
  try {
    expected = jobRunnerSecret();
  } catch {
    return false;
  }
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!authorised(request)) {
    return NextResponse.json({ ok: false, error: 'Not authorised.' }, { status: 401 });
  }
  try {
    await queueDailySweep();
    const report = await runDueJobs(20);
    return NextResponse.json({ ok: true, report });
  } catch (error) {
    console.error('[easybills] job runner failed', error);
    return NextResponse.json({ ok: false, error: 'Job run failed.' }, { status: 500 });
  }
}
