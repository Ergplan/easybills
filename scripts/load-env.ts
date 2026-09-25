/**
 * Load environment files for CLI entry points.
 *
 * Next loads `.env.local` and `.env` itself, but the job worker and the seed
 * script run as plain Node processes and would otherwise start with nothing
 * configured -- failing with "Missing required environment variable" even
 * though the file is sitting right there.
 *
 * Later files do not override values already set, matching Next's precedence:
 * a variable exported in the shell wins over `.env.local`, which wins over
 * `.env`.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const FILES = ['.env.local', '.env'];

for (const file of FILES) {
  const path = resolve(process.cwd(), file);
  if (!existsSync(path)) continue;
  try {
    // Node 21.7+ parses the file and skips keys already present.
    process.loadEnvFile(path);
  } catch (error) {
    console.warn(`[env] could not read ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
