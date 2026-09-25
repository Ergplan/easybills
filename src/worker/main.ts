/**
 * Local background worker.
 *
 * Runs the same `runDueJobs` the HTTP endpoint runs. Use `npm run worker` for a
 * long-running loop in development, or `npm run worker:once` for a single pass
 * (which is what a container-based scheduled task would invoke).
 *
 * In production, prefer the HTTP endpoint driven by a managed scheduler: it
 * needs no always-on process and survives deploys.
 */
import { queueDailySweep, runDueJobs } from '@/server/jobs/runner';

const INTERVAL_MS = Number(process.env.WORKER_INTERVAL_MS ?? 60_000);

async function pass(): Promise<void> {
  await queueDailySweep();
  const report = await runDueJobs(20);
  if (report.claimed > 0) {
    console.log(
      `[worker] claimed=${report.claimed} completed=${report.completed} failed=${report.failed} drafts=${report.draftsCreated}`,
    );
    for (const d of report.details) console.log(`  - ${d.type}: ${d.outcome}`);
  }
}

async function main() {
  const once = process.argv.includes('--once');
  if (once) {
    await pass();
    process.exit(0);
  }

  console.log(`[worker] started, polling every ${INTERVAL_MS}ms. Ctrl-C to stop.`);
  let stopping = false;
  process.on('SIGINT', () => {
    stopping = true;
    console.log('\n[worker] stopping after the current pass…');
  });

  while (!stopping) {
    try {
      await pass();
    } catch (error) {
      console.error('[worker] pass failed', error);
    }
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
  process.exit(0);
}

void main();
