import 'server-only';

import { randomUUID } from 'node:crypto';

import { db } from '@/server/firebase/admin';
import { jobsCol } from '@/server/firebase/paths';

/**
 * A small durable job queue on Firestore.
 *
 * Why not a cron in the browser: monthly drafts must appear whether or not the
 * owner has the app open. Why not a plain setInterval in the server process: a
 * deploy or a crash would lose the tick. So work is a ROW, claimed under a lease
 * and retried with backoff, and the only thing a scheduler has to do is poke an
 * endpoint.
 *
 * At-most-once is NOT promised here, and does not need to be: the recurrence
 * work is idempotent by construction (deterministic occurrence ids), so a job
 * that runs twice produces the same single draft.
 */

export type JobType = 'sweep-schedules' | 'run-schedule';

export interface JobRecord {
  id: string;
  type: JobType;
  businessId: string | null;
  payload: Record<string, unknown>;
  /** Earliest time this job may run. */
  runAfter: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  attempts: number;
  maxAttempts: number;
  /** While held, other workers leave this job alone. */
  leaseUntil: string | null;
  leaseOwner: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  /** Deduplication key, so the same work is not queued twice. */
  dedupeKey: string | null;
}

const LEASE_MS = 2 * 60 * 1000;

export async function enqueue(args: {
  type: JobType;
  businessId?: string | null;
  payload?: Record<string, unknown>;
  runAfter?: Date;
  dedupeKey?: string;
  maxAttempts?: number;
}): Promise<string> {
  const now = new Date();
  // A deterministic id from the dedupe key turns "do not queue this twice" into
  // a database guarantee rather than a query-then-write race.
  const id = args.dedupeKey ? `dedupe__${encodeURIComponent(args.dedupeKey)}` : randomUUID();
  const ref = jobsCol().doc(id);

  const record: JobRecord = {
    id,
    type: args.type,
    businessId: args.businessId ?? null,
    payload: args.payload ?? {},
    runAfter: (args.runAfter ?? now).toISOString(),
    status: 'pending',
    attempts: 0,
    maxAttempts: args.maxAttempts ?? 5,
    leaseUntil: null,
    leaseOwner: null,
    lastError: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    dedupeKey: args.dedupeKey ?? null,
  };

  if (args.dedupeKey) {
    const existing = await ref.get();
    // Only re-queue if the previous one finished; a pending duplicate is a no-op.
    if (existing.exists && (existing.data() as JobRecord).status === 'pending') return id;
    await ref.set(record);
  } else {
    await ref.set(record);
  }
  return id;
}

/** Claim up to `limit` due jobs under a lease. */
export async function claimJobs(workerId: string, limit = 5): Promise<JobRecord[]> {
  const now = new Date();
  const snap = await jobsCol()
    .where('status', 'in', ['pending', 'running'])
    .where('runAfter', '<=', now.toISOString())
    .limit(limit * 3)
    .get();

  const claimed: JobRecord[] = [];
  for (const doc of snap.docs) {
    if (claimed.length >= limit) break;
    const job = doc.data() as JobRecord;
    // Skip a job another worker currently holds.
    if (job.status === 'running' && job.leaseUntil && job.leaseUntil > now.toISOString()) continue;

    try {
      const got = await db().runTransaction(async (tx) => {
        const fresh = await tx.get(doc.ref);
        if (!fresh.exists) return null;
        const j = fresh.data() as JobRecord;
        if (j.status === 'done' || j.status === 'failed') return null;
        if (j.status === 'running' && j.leaseUntil && j.leaseUntil > new Date().toISOString()) return null;

        const leased: Partial<JobRecord> = {
          status: 'running',
          leaseUntil: new Date(Date.now() + LEASE_MS).toISOString(),
          leaseOwner: workerId,
          attempts: j.attempts + 1,
          updatedAt: new Date().toISOString(),
        };
        tx.update(doc.ref, leased);
        return { ...j, ...leased } as JobRecord;
      });
      if (got) claimed.push(got);
    } catch {
      // Contention: another worker won the race. Move on.
    }
  }
  return claimed;
}

export async function completeJob(jobId: string): Promise<void> {
  await jobsCol().doc(jobId).update({
    status: 'done',
    leaseUntil: null,
    leaseOwner: null,
    updatedAt: new Date().toISOString(),
  });
}

/** Retry with exponential backoff, giving up after `maxAttempts`. */
export async function failJob(jobId: string, error: unknown): Promise<void> {
  const ref = jobsCol().doc(jobId);
  const snap = await ref.get();
  if (!snap.exists) return;
  const job = snap.data() as JobRecord;
  const message = error instanceof Error ? error.message : String(error);

  if (job.attempts >= job.maxAttempts) {
    await ref.update({
      status: 'failed',
      lastError: message.slice(0, 500),
      leaseUntil: null,
      leaseOwner: null,
      updatedAt: new Date().toISOString(),
    });
    return;
  }

  const backoffMs = Math.min(60 * 60 * 1000, 2 ** job.attempts * 30_000);
  await ref.update({
    status: 'pending',
    runAfter: new Date(Date.now() + backoffMs).toISOString(),
    lastError: message.slice(0, 500),
    leaseUntil: null,
    leaseOwner: null,
    updatedAt: new Date().toISOString(),
  });
}
