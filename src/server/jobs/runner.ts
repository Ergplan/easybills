import 'server-only';

import { randomUUID } from 'node:crypto';

import { todayIst } from '@/lib/dates';
import type { BusinessRecord } from '@/lib/domain/types';
import { businessesCol, schedulesCol } from '@/server/firebase/paths';
import { runSchedule } from '@/server/repos/schedules';

import { claimJobs, completeJob, enqueue, failJob, type JobRecord } from './queue';

export interface RunReport {
  claimed: number;
  completed: number;
  failed: number;
  draftsCreated: number;
  details: Array<{ jobId: string; type: string; outcome: string }>;
}

/**
 * Execute one batch of due jobs.
 *
 * Called by the HTTP endpoint (for a hosted scheduler) and by the local worker
 * process. Both paths run the same code, so what is tested locally is what runs
 * in production.
 */
export async function runDueJobs(limit = 10): Promise<RunReport> {
  const workerId = `${process.env.HOSTNAME ?? 'worker'}-${randomUUID().slice(0, 8)}`;
  const jobs = await claimJobs(workerId, limit);
  const report: RunReport = { claimed: jobs.length, completed: 0, failed: 0, draftsCreated: 0, details: [] };

  for (const job of jobs) {
    try {
      const outcome = await execute(job);
      report.draftsCreated += outcome.draftsCreated;
      await completeJob(job.id);
      report.completed += 1;
      report.details.push({ jobId: job.id, type: job.type, outcome: outcome.summary });
    } catch (error) {
      await failJob(job.id, error);
      report.failed += 1;
      report.details.push({
        jobId: job.id,
        type: job.type,
        outcome: `failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  return report;
}

async function execute(job: JobRecord): Promise<{ draftsCreated: number; summary: string }> {
  switch (job.type) {
    case 'sweep-schedules': {
      // Fan out: one job per business that has an active schedule, so a single
      // slow business cannot hold up everyone else's drafts.
      const businesses = await businessesCol().limit(1000).get();
      let queued = 0;
      for (const doc of businesses.docs) {
        const active = await schedulesCol(doc.id).where('status', '==', 'active').limit(1).get();
        if (active.empty) continue;
        await enqueue({
          type: 'run-schedule',
          businessId: doc.id,
          dedupeKey: `run-schedule:${doc.id}:${todayIst()}`,
        });
        queued += 1;
      }
      return { draftsCreated: 0, summary: `queued ${queued} businesses` };
    }

    case 'run-schedule': {
      const businessId = job.businessId;
      if (!businessId) return { draftsCreated: 0, summary: 'no business' };
      const bizSnap = await businessesCol().doc(businessId).get();
      if (!bizSnap.exists) return { draftsCreated: 0, summary: 'business gone' };
      const business = { id: bizSnap.id, ...(bizSnap.data() as Omit<BusinessRecord, 'id'>) };

      const schedules = await schedulesCol(businessId).where('status', '==', 'active').limit(200).get();
      let created = 0;
      for (const doc of schedules.docs) {
        const result = await runSchedule({ business, scheduleId: doc.id });
        created += result.created.length;
      }
      return { draftsCreated: created, summary: `${created} drafts prepared` };
    }

    default:
      return { draftsCreated: 0, summary: `unknown job type ${job.type}` };
  }
}

/** Queue the daily sweep. Safe to call repeatedly -- the dedupe key collapses it. */
export async function queueDailySweep(): Promise<string> {
  return enqueue({ type: 'sweep-schedules', dedupeKey: `sweep:${todayIst()}` });
}
