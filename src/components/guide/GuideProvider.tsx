'use client';

import { usePathname } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { noteScreen } from '@/components/nav-trail';
import { screenOf, tourFor, type GuideTarget, type ScreenKey, type TourStep } from '@/lib/guide/tours';

/**
 * The guide: a glowing ring that runs round whatever is being talked about,
 * with a speech bubble beside it.
 *
 * Two drivers, one ring. "Dikhao kaise" walks the screen's tour step by step
 * (lib/guide/tours.ts). Voice moves the ring itself as it talks, fills fields
 * from what the owner says, and presses the safe buttons -- never the ones
 * that send or save, which stay the owner's tap.
 */

export interface ScreenItem {
  id: string;
  kind: 'field' | 'choice' | 'button' | 'link';
  label: string;
  value?: string;
  /** Sends, saves or pays: voice may point at it, only the owner presses it. */
  ownerOnly: boolean;
}

interface GuideApi {
  screen: ScreenKey;
  /** Ring round a target, with words in the bubble. False when it is not on screen. */
  show: (target: GuideTarget, say: string) => boolean;
  clear: () => void;
  startTour: () => void;
  tourActive: boolean;
  /** What is on the screen now, for voice. Items get stable ids for fill/tap/show. */
  snapshot: () => ScreenItem[];
  /** Ring round an item from the last snapshot (voice's "show"). */
  showItem: (id: string, say: string) => boolean;
  fill: (id: string, value: string) => { ok: boolean; reason?: string };
  tap: (id: string) => { ok: boolean; reason?: string };
  /** The words voice is saying, shown in the bubble while it speaks. */
  setCaption: (text: string | null) => void;
}

const GuideContext = createContext<GuideApi | null>(null);

export function useGuide(): GuideApi | null {
  return useContext(GuideContext);
}

/** Final actions: voice points, the owner presses. */
const OWNER_ONLY =
  /bill banao|whatsapp|save|paise aaye|likh lo|cancel|kam karo|add karo|bhejo|sign ?out|logout|deal save|samjho|upload|files chuno|hata do|naya banao|delete|haan, padta/i;

function textOf(el: Element): string {
  return (el.textContent ?? '').replace(/\s+/g, ' ').trim();
}

export function resolveTarget(target: GuideTarget): HTMLElement | null {
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  };
  if (typeof target === 'string') {
    const all = [...document.querySelectorAll(target)];
    return (all.find(visible) as HTMLElement) ?? null;
  }
  const want = target.text.toLowerCase();
  const all = [...document.querySelectorAll(target.sel)].filter((el) => textOf(el).toLowerCase().includes(want));
  return (all.find(visible) as HTMLElement) ?? null;
}

function labelFor(el: HTMLElement): string {
  const aria = el.getAttribute('aria-label');
  if (aria) return aria;
  if (el.id) {
    const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (label) return textOf(label);
  }
  const wrapping = el.closest('label');
  if (wrapping && wrapping !== el) {
    const t = textOf(wrapping);
    if (t) return t.slice(0, 60);
  }
  const ph = el.getAttribute('placeholder');
  if (ph) return ph;
  return textOf(el).slice(0, 60);
}

/**
 * Scroll so the target sits in the upper third of the screen: the bubble
 * lives at the bottom, and what comes next on the page (the next field)
 * stays visible between the two.
 */
function bringIntoView(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  const want = Math.max(80, window.innerHeight * 0.26);
  if (r.top < want - 40 || r.bottom > window.innerHeight * 0.55) {
    window.scrollBy({ top: r.top - want, behavior: 'smooth' });
  }
}

function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

export function GuideProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '/';
  const screen = screenOf(pathname);
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [say, setSay] = useState<string | null>(null);
  const [caption, setCaption] = useState<string | null>(null);
  const [tour, setTour] = useState<{ steps: TourStep[]; at: number } | null>(null);

  const clear = useCallback(() => {
    setTarget(null);
    setSay(null);
    setTour(null);
  }, []);

  const show = useCallback((t: GuideTarget, words: string) => {
    const el = resolveTarget(t);
    if (!el) return false;
    bringIntoView(el);
    setTarget(el);
    setSay(words);
    return true;
  }, []);

  const stepsOnScreen = useCallback(() => tourFor(screen).filter((s) => resolveTarget(s.target)), [screen]);

  const goTo = useCallback(
    (steps: TourStep[], at: number) => {
      const step = steps[at];
      if (!step) {
        clear();
        return;
      }
      setTour({ steps, at });
      show(step.target, step.say);
    },
    [clear, show],
  );

  const startTour = useCallback(() => {
    const steps = stepsOnScreen();
    if (!steps.length) {
      setTarget(null);
      setTour(null);
      setSay('Is screen pe dikhane ko kuch khaas nahi. Upar peeche wala teer Ghar le jayega.');
      return;
    }
    goTo(steps, 0);
  }, [goTo, stepsOnScreen]);

  // A new screen: whatever the ring was on is gone, and Back learns where we were.
  useEffect(() => {
    clear();
    noteScreen(window.location.pathname + window.location.search);
  }, [pathname, clear]);

  // First visit to a screen: offer its tour, once. Not for browsers driven by
  // tests (navigator.webdriver), and not while voice is doing the guiding.
  useEffect(() => {
    if (typeof window === 'undefined' || navigator.webdriver) return;
    let seen: string | null = null;
    try {
      if (localStorage.getItem('ekbill.tour.auto') === 'off') return;
      seen = localStorage.getItem(`ekbill.tour.${screen}`);
    } catch {
      return;
    }
    if (seen || screen === 'other') return;
    const id = window.setTimeout(() => {
      if (document.documentElement.dataset.voice === 'live') return;
      try {
        localStorage.setItem(`ekbill.tour.${screen}`, '1');
      } catch {
        // No storage: the tour simply offers itself again next time.
      }
      startTour();
    }, 900);
    return () => window.clearTimeout(id);
  }, [screen, startTour]);

  const items = useRef(new Map<string, HTMLElement>());

  const snapshot = useCallback((): ScreenItem[] => {
    items.current.clear();
    const root = document.querySelector('main') ?? document.body;
    const els = [...root.querySelectorAll<HTMLElement>('input:not([type=hidden]), textarea, select, button, a[href]')].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && !el.closest('.guide-bubble') && !(el as HTMLButtonElement).disabled;
    });
    const out: ScreenItem[] = [];
    const used = new Set<string>();
    for (const el of els.slice(0, 60)) {
      const tag = el.tagName.toLowerCase();
      const label = labelFor(el);
      if (!label && tag !== 'input' && tag !== 'textarea') continue;
      let id = el.id || el.dataset.testid || label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || tag;
      while (used.has(id)) id = `${id}-2`;
      used.add(id);
      items.current.set(id, el);
      const kind: ScreenItem['kind'] =
        tag === 'a' ? 'link' : tag === 'button' ? 'button' : tag === 'select' ? 'choice' : 'field';
      out.push({
        id,
        kind,
        label,
        value: kind === 'field' || kind === 'choice' ? (el as HTMLInputElement).value : undefined,
        ownerOnly: (kind === 'button' || kind === 'link') && (el.dataset.guideTap === 'owner' || OWNER_ONLY.test(label)),
      });
    }
    return out;
  }, []);

  const find = useCallback(
    (id: string): HTMLElement | null => {
      if (!items.current.size) snapshot();
      return items.current.get(id) ?? (document.getElementById(id) as HTMLElement | null);
    },
    [snapshot],
  );

  const fill = useCallback(
    (id: string, value: string) => {
      const el = find(id);
      if (!el) return { ok: false, reason: 'not on screen' };
      if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) {
        return { ok: false, reason: 'not a field' };
      }
      if (('readOnly' in el && el.readOnly) || el.disabled) return { ok: false, reason: 'cannot be changed here' };
      if (el instanceof HTMLSelectElement) {
        const want = value.trim().toLowerCase();
        const option = [...el.options].find((o) => o.value.toLowerCase() === want || o.text.toLowerCase().includes(want));
        if (!option) return { ok: false, reason: 'no such choice' };
        setNativeValue(el, option.value);
      } else {
        setNativeValue(el, value);
      }
      bringIntoView(el);
      setTarget(el);
      return { ok: true };
    },
    [find],
  );

  const tap = useCallback(
    (id: string) => {
      const el = find(id);
      if (!el) return { ok: false, reason: 'not on screen' };
      const label = labelFor(el);
      if (el.dataset.guideTap === 'owner' || OWNER_ONLY.test(label)) {
        bringIntoView(el);
        setTarget(el);
        return { ok: false, reason: 'owner taps this one themselves; it is highlighted for them' };
      }
      setTarget(el);
      el.click();
      return { ok: true };
    },
    [find],
  );

  const showItem = useCallback(
    (id: string, words: string) => {
      const el = find(id);
      if (!el) return false;
      bringIntoView(el);
      setTarget(el);
      setSay(words || null);
      return true;
    },
    [find],
  );

  const api = useMemo<GuideApi>(
    () => ({ screen, show, clear, startTour, tourActive: tour !== null, snapshot, showItem, fill, tap, setCaption }),
    [screen, show, clear, startTour, tour, snapshot, showItem, fill, tap],
  );

  // Browser journeys drive the guide the way voice does (fill, tap, show).
  // Only for browsers under automation; nothing is exposed to a normal visit.
  useEffect(() => {
    if (typeof navigator !== 'undefined' && navigator.webdriver) {
      (window as unknown as { __ekbillGuide?: GuideApi }).__ekbillGuide = api;
    }
  }, [api]);

  return (
    <GuideContext.Provider value={api}>
      {children}
      <GuideOverlay
        target={target}
        say={caption ?? say}
        tour={tour}
        onNext={() => tour && goTo(tour.steps, tour.at + 1)}
        onPrev={() => tour && goTo(tour.steps, Math.max(0, tour.at - 1))}
        onClose={clear}
      />
    </GuideContext.Provider>
  );
}

/** The ring and the bubble, drawn over the page without blocking it. */
function GuideOverlay({
  target,
  say,
  tour,
  onNext,
  onPrev,
  onClose,
}: {
  target: HTMLElement | null;
  say: string | null;
  tour: { steps: TourStep[]; at: number } | null;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
}) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Follow the target as the page scrolls, resizes or re-renders.
  useEffect(() => {
    if (!target) {
      setRect(null);
      return;
    }
    let raf = 0;
    const tick = () => {
      if (!target.isConnected) {
        setRect(null);
        return;
      }
      setRect(target.getBoundingClientRect());
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [target]);

  if (!mounted || (!say && !rect)) return null;

  const pad = 8;
  const ring = rect
    ? { top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }
    : null;
  // The bubble stays at the bottom, above the tabs, unless the target is down
  // there itself (the Bill banao button); then it goes to the top.
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const low = ring ? ring.top + ring.height > vh * 0.62 : false;
  const bubbleStyle: React.CSSProperties = low ? { top: 76 } : { bottom: 'calc(var(--bubble-bottom, 88px) + env(safe-area-inset-bottom, 0px))' };
  const last = tour ? tour.at >= tour.steps.length - 1 : false;

  return createPortal(
    <>
      {ring && <div className="guide-ring" style={ring} aria-hidden="true" />}
      {say && (
        <div className="guide-bubble" style={bubbleStyle} role="status" aria-live="polite">
          <p className="guide-bubble__say">{say}</p>
          {tour ? (
            <div className="guide-bubble__row">
              <span className="guide-bubble__count">
                {tour.at + 1}/{tour.steps.length}
              </span>
              {tour.at > 0 && (
                <button type="button" className="btn btn--ghost btn--small" onClick={onPrev}>
                  Peeche
                </button>
              )}
              <button type="button" className="btn btn--ghost btn--small" onClick={onClose}>
                Band karo
              </button>
              <button type="button" className="btn btn--primary btn--small" onClick={last ? onClose : onNext}>
                {last ? 'Samajh gaya' : 'Aage'}
              </button>
            </div>
          ) : (
            <div className="guide-bubble__row">
              <button type="button" className="btn btn--ghost btn--small" onClick={onClose}>
                Theek hai
              </button>
            </div>
          )}
        </div>
      )}
    </>,
    document.body,
  );
}
