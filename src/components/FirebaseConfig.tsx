'use client';

import { setFirebaseConfig } from '@/lib/firebase/client';
import type { PublicFirebaseConfig } from '@/lib/env';

/**
 * Hands the browser the Firebase Web config the server read at request time.
 *
 * Renders nothing. It exists because `firebaseAuth()` is called from plain
 * functions rather than hooks -- `signInWithPassword` and friends -- so the
 * config has to reach a module variable, not a React context. Setting it during
 * render means it is in place before any child can reach a sign-in button, and
 * because no markup depends on it there is nothing for hydration to disagree
 * about.
 */
export function FirebaseConfig({ config }: { config: PublicFirebaseConfig }) {
  setFirebaseConfig(config);
  return null;
}
