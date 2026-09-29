'use client';

import { useRouter } from 'next/navigation';

import { Icon } from './Icon';
import { markBack, previousScreen } from './nav-trail';

/**
 * Back goes where you came from. Opened from "Kiske paise aane hain", a bill's
 * back arrow returns there, not to some fixed list. Arrived directly (a link
 * from WhatsApp, a reload), there is nowhere to go back to in this app, so it
 * goes to the screen's natural parent instead.
 */
export function BackButton({ fallback, label = 'Peeche' }: { fallback: string; label?: string }) {
  const router = useRouter();
  return (
    <a
      href={fallback}
      className="btn btn--ghost topbar__back"
      aria-label={label}
      onClick={(e) => {
        const prev = previousScreen();
        if (prev) {
          e.preventDefault();
          markBack();
          router.push(prev);
        } else {
          e.preventDefault();
          router.push(fallback);
        }
      }}
    >
      <Icon name="back" size={22} />
    </a>
  );
}
