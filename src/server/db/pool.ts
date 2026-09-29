import 'server-only';

import { Pool, type PoolClient } from 'pg';

import { databaseUrl } from '@/lib/env';

/**
 * One connection pool per server process.
 *
 * Postgres is the only store of business records. Browsers never reach it: every
 * read and write goes through a server action or route that has already resolved
 * the caller and checked membership of the business being touched.
 */

declare global {
  // Survives Next's dev-mode module reloads, which would otherwise open a new
  // pool on every edit until Postgres runs out of connections.
  var __ekbillPool: Pool | undefined;
}

export function pool(): Pool {
  if (!globalThis.__ekbillPool) {
    globalThis.__ekbillPool = new Pool({
      connectionString: databaseUrl(),
      max: Number(process.env.DATABASE_POOL_MAX ?? 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
    // An idle client dropped by the server must not crash the process.
    globalThis.__ekbillPool.on('error', () => undefined);
  }
  return globalThis.__ekbillPool;
}

/** Anything a query can run on: the pool, or a client inside a transaction. */
export type Db = Pool | PoolClient;

/** Postgres error codes a transaction is worth retrying on. */
const RETRYABLE = new Set([
  '40001', // serialization_failure
  '40P01', // deadlock_detected
  '23505', // unique_violation: the losing side of an insert race re-reads and finds the winner
]);

/**
 * Run `fn` in a transaction and retry it when a concurrent one got there first.
 *
 * Rows a transaction decides on are locked with `SELECT ... FOR UPDATE` (see
 * `getDoc(..., { lock: true })`), so two issues of the same draft, or two
 * payments against the same bill, queue behind each other rather than both
 * reading the old balance. Where two transactions race to INSERT the same key
 * -- a double-tapped payment with the same idempotency key -- the loser hits
 * the primary key, rolls back, and on retry reads the winner's row.
 */
export async function withTx<T>(fn: (tx: PoolClient) => Promise<T>, attempts = 5): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const client = await pool().connect();
    try {
      await client.query('begin');
      const result = await fn(client);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      lastError = error;
      const code = (error as { code?: string }).code;
      if (!code || !RETRYABLE.has(code)) throw error;
      await new Promise((r) => setTimeout(r, 10 + Math.random() * 40 * (attempt + 1)));
    } finally {
      client.release();
    }
  }
  throw lastError;
}
