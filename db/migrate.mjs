#!/usr/bin/env node
// Apply db/migrations/*.sql in order, once each, under an advisory lock so two containers
// starting together cannot both apply the same file.  Plain Node + pg so it runs inside the
// production image without a TypeScript toolchain:
//
//   DATABASE_URL=postgres://... node db/migrate.mjs
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

const here = path.dirname(fileURLToPath(import.meta.url));
const LOCK = 7_310_001; // any constant; shared by every runner of this app

export async function migrate(connectionString, { log = console.log } = {}) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query('select pg_advisory_lock($1)', [LOCK]);
    await client.query(
      'create table if not exists schema_migrations (version text primary key, applied_at timestamptz not null default now())',
    );
    const done = new Set((await client.query('select version from schema_migrations')).rows.map((r) => r.version));
    const files = (await readdir(path.join(here, 'migrations'))).filter((f) => f.endsWith('.sql')).sort();
    const applied = [];
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await readFile(path.join(here, 'migrations', file), 'utf8');
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query('insert into schema_migrations (version) values ($1)', [file]);
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        throw new Error(`Migration ${file} failed: ${error.message}`);
      }
      applied.push(file);
      log(`applied ${file}`);
    }
    return applied;
  } finally {
    await client.query('select pg_advisory_unlock($1)', [LOCK]).catch(() => undefined);
    await client.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set.');
    process.exit(2);
  }
  migrate(url)
    .then((applied) => console.log(applied.length ? `${applied.length} migration(s) applied` : 'schema up to date'))
    .catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
}
