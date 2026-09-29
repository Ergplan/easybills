'use client';

import { useGuide } from './GuideProvider';

/** "?" in the header: walk me through this screen. */
export function GuideButton({ label = 'Dikhao kaise' }: { label?: string }) {
  const guide = useGuide();
  if (!guide) return null;
  return (
    <button type="button" className="btn btn--ghost guide-btn" aria-label={label} onClick={() => guide.startTour()} data-testid="guide-btn">
      <span className="guide-btn__q" aria-hidden="true">?</span>
      <span className="only-wide">{label}</span>
    </button>
  );
}
