'use client';

/**
 * The screens visited in this tab, so Back can mean "where I just was".
 * Kept in sessionStorage: it survives a reload, and a new tab starts clean.
 *
 * A step is only popped when it really was a step back -- our back arrow, or
 * the phone's own back gesture (popstate). Going forward to a screen you saw
 * two steps ago is a new step, not a back.
 */
const KEY = 'ekbill.trail';
let goingBack = false;

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    goingBack = true;
  });
}

function read(): string[] {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}

function write(trail: string[]) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(trail.slice(-30)));
  } catch {
    // No storage: Back falls back to each screen's parent.
  }
}

/** Our back arrow is about to go to the previous screen. */
export function markBack() {
  goingBack = true;
}

/** Called on every screen change. */
export function noteScreen(path: string) {
  const trail = read();
  if (goingBack) {
    goingBack = false;
    // Drop everything after the screen we went back to.
    const at = trail.lastIndexOf(path);
    if (at >= 0) {
      write(trail.slice(0, at + 1));
      return;
    }
  }
  if (trail[trail.length - 1] === path) return;
  trail.push(path);
  write(trail);
}

/** The screen before this one, if this tab came from somewhere in the app. */
export function previousScreen(): string | null {
  const trail = read();
  return trail.length >= 2 ? trail[trail.length - 2]! : null;
}
