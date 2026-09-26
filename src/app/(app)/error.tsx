'use client';

import Link from 'next/link';

/**
 * A screen inside the app failed.
 *
 * The shell -- the navigation, the top bar -- is still there, so this is a
 * panel rather than a whole page. The reassurance matters more than the
 * apology: an owner whose bill list just failed to load needs to know their
 * bills still exist before they need to know we are sorry.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="page">
      <div className="card stack">
        <h1>This screen did not load</h1>
        <p className="muted">
          Something went wrong on our side. <strong>Nothing you saved has been lost</strong> — your bills
          and payments are stored, and this screen failing does not change any of them.
        </p>
        <div className="row row--tight">
          <button type="button" className="btn btn--primary" onClick={reset}>
            Try again
          </button>
          <Link href="/home" className="btn btn--secondary">
            Go to Home
          </Link>
        </div>
        {error.digest && (
          <p className="tiny muted">
            For whoever is fixing this: error {error.digest}. Open <code>/api/health</code> for what is
            actually wrong.
          </p>
        )}
      </div>
    </main>
  );
}
