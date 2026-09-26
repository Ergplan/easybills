'use client';

/**
 * The last resort, for an error thrown before or outside any other boundary.
 *
 * It replaces the whole document, so it carries no shared layout, no fonts and
 * no stylesheet -- everything it needs is inline. Anything imported here is
 * something that could itself be the thing that is broken.
 *
 * What it must never do is say "A server error occurred" and stop. Somebody is
 * looking at this because their bills did not load; the least it owes them is
 * whether their data is safe and what to do next.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en-IN">
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'grid',
          placeItems: 'center',
          padding: 24,
          background: '#f4f2ee',
          color: '#1b1915',
          fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
          lineHeight: 1.55,
        }}
      >
        <main style={{ maxWidth: 460, width: '100%' }}>
          <h1 style={{ fontSize: '1.5rem', margin: '0 0 12px', letterSpacing: '-0.03em' }}>
            This did not load
          </h1>
          <p style={{ margin: '0 0 12px' }}>
            Something went wrong on our side, not yours. <strong>Nothing you saved has been lost</strong> —
            your bills are stored, and this screen failing does not change any of them.
          </p>
          <p style={{ margin: '0 0 20px' }}>Try again in a moment. If it keeps happening, tell whoever looks after this app.</p>
          <button
            type="button"
            onClick={reset}
            style={{
              minHeight: 44,
              padding: '10px 20px',
              borderRadius: 8,
              border: 0,
              background: '#2b4595',
              color: '#fff',
              font: 'inherit',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
          {error.digest && (
            <p style={{ marginTop: 24, fontSize: '0.8125rem', color: '#6e675e' }}>
              For whoever is fixing this: error {error.digest}. Open <code>/api/health</code> on this
              address for what is actually wrong.
            </p>
          )}
        </main>
      </body>
    </html>
  );
}
