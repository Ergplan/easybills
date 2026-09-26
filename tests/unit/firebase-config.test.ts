/**
 * The browser gets a Firebase config wherever the host chose to put one.
 *
 * Next inlines `NEXT_PUBLIC_*` into the client bundle at BUILD time. A host
 * that supplies configuration only at RUNTIME therefore produces a bundle with
 * four empty strings and a sign-in page that cannot sign anyone in -- which is
 * exactly what Firebase App Hosting did. The config is read on the server and
 * handed down instead, so both shapes work.
 */
import { afterEach, describe, expect, it } from 'vitest';

const KEYS = [
  'NEXT_PUBLIC_FIREBASE_API_KEY',
  'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
  'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
  'NEXT_PUBLIC_FIREBASE_APP_ID',
  'FIREBASE_WEBAPP_CONFIG',
] as const;

const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function clear() {
  for (const k of KEYS) delete process.env[k];
}

async function readConfig() {
  const { publicFirebaseConfig } = await import('@/lib/env');
  return publicFirebaseConfig();
}

describe('the Firebase Web config the browser is handed', () => {
  it('uses the NEXT_PUBLIC_ values when a build was given them', async () => {
    clear();
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'from-build';
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY = 'key-b';
    process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN = 'from-build.firebaseapp.com';
    process.env.NEXT_PUBLIC_FIREBASE_APP_ID = 'app-b';
    expect(await readConfig()).toEqual({
      projectId: 'from-build',
      apiKey: 'key-b',
      authDomain: 'from-build.firebaseapp.com',
      appId: 'app-b',
    });
  });

  it('falls back to what App Hosting injects at runtime', async () => {
    clear();
    process.env.FIREBASE_WEBAPP_CONFIG = JSON.stringify({
      projectId: 'from-runtime',
      apiKey: 'key-r',
      authDomain: 'from-runtime.firebaseapp.com',
      appId: 'app-r',
    });
    expect(await readConfig()).toEqual({
      projectId: 'from-runtime',
      apiKey: 'key-r',
      authDomain: 'from-runtime.firebaseapp.com',
      appId: 'app-r',
    });
  });

  it('prefers an explicitly configured value over the injected one', async () => {
    clear();
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'explicit';
    process.env.FIREBASE_WEBAPP_CONFIG = JSON.stringify({ projectId: 'injected' });
    expect((await readConfig()).projectId).toBe('explicit');
  });

  it('derives the auth domain when the injected config omits it', async () => {
    clear();
    process.env.FIREBASE_WEBAPP_CONFIG = JSON.stringify({ projectId: 'ekbill', apiKey: 'k' });
    expect((await readConfig()).authDomain).toBe('ekbill.firebaseapp.com');
  });

  it('reports nothing rather than guessing when the injected config is unreadable', async () => {
    clear();
    process.env.FIREBASE_WEBAPP_CONFIG = 'not json at all';
    // An empty projectId is what makes the sign-in page say what is missing.
    expect((await readConfig()).projectId).toBe('');
  });
});
