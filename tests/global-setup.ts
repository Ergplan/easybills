import pg from 'pg';

// @ts-expect-error -- plain ESM module without types, shared with the production image
import { migrate } from '../db/migrate.mjs';

/**
 * Once per test run: an empty schema, then every migration. Tests therefore
 * exercise exactly the schema a fresh VM gets, and never see a previous run's rows.
 */
export default async function setup() {
  const url = process.env.DATABASE_URL ?? 'postgres://postgres@127.0.0.1:5440/ekbill_test';
  if (!/test/.test(new URL(url).pathname)) throw new Error(`Refusing to reset ${url}`);
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query('drop schema if exists public cascade; create schema public;');
  await client.end();
  await migrate(url, { log: () => undefined });
}
