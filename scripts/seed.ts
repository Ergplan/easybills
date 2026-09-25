/**
 * Seed synthetic demo data.
 *
 *   npm run db:seed -- --uid <firebase-uid> [--profile repair|consultant|home-food]
 *
 * Requires the Firebase emulators (or a configured project). Every business it
 * creates is flagged as a demo and is labelled as such throughout the app.
 */
import './load-env';

import { seedDemoBusiness, type DemoProfile } from '../src/server/services/seed';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const uid = arg('uid');
  if (!uid) {
    console.error('Usage: npm run db:seed -- --uid <firebase-uid> [--profile repair|consultant|home-food]');
    console.error('\nCreate a user first by signing up in the app, then copy the uid from');
    console.error('the Auth emulator UI at http://127.0.0.1:4000/auth');
    process.exit(1);
  }
  const profile = (arg('profile') ?? 'repair') as DemoProfile;

  const business = await seedDemoBusiness({
    uid,
    email: null,
    displayName: null,
    profile,
  });
  console.log(`Seeded demo business "${business.legalName}" (${business.id}) for uid ${uid}.`);
  process.exit(0);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
