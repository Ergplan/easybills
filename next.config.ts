import type { NextConfig } from 'next';

/**
 * Firebase App Hosting creates a Web App for the backend and hands the build
 * its config as FIREBASE_WEBAPP_CONFIG. The browser bundle reads the same four
 * values under their NEXT_PUBLIC_ names, and Next inlines those at build time,
 * so they cannot be supplied at runtime.
 *
 * Mapping one onto the other here means a deployment does not have to copy
 * values Firebase already knows, and cannot copy them wrongly. Anything set
 * explicitly still wins: this only fills in what is missing.
 */
function firebaseWebEnv(): Record<string, string> {
  const raw = process.env.FIREBASE_WEBAPP_CONFIG;
  if (!raw) return {};
  let config: Record<string, string>;
  try {
    config = JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
  const mapped: Record<string, string> = {
    NEXT_PUBLIC_FIREBASE_API_KEY: config.apiKey ?? '',
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: config.authDomain ?? '',
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: config.projectId ?? '',
    NEXT_PUBLIC_FIREBASE_APP_ID: config.appId ?? '',
  };
  return Object.fromEntries(
    Object.entries(mapped).filter(([name, value]) => value !== '' && !process.env[name]),
  );
}

/**
 * When this server was built.
 *
 * "Is my change actually deployed yet?" has no obvious answer on a platform
 * that rebuilds on push: the app looks the same either way, and a setting that
 * has not landed yet is indistinguishable from a setting that is wrong. This
 * is stamped at build time and reported by /api/health, so the question takes
 * one request instead of a guess.
 */
const BUILD_STAMP = new Date().toISOString();

const nextConfig: NextConfig = {
  reactStrictMode: true,
  env: { ...firebaseWebEnv(), NEXT_PUBLIC_BUILD_STAMP: BUILD_STAMP },
  // Emit a self-contained server with only the dependencies it actually uses,
  // so the deployable image carries the app rather than node_modules. Harmless
  // in development; `next dev` ignores it.
  output: 'standalone',
  // The PDF renderer drives a real Chromium via playwright-core. It must stay in the
  // Node runtime and must not be bundled by Next's server compiler.
  serverExternalPackages: ['playwright-core', '@sparticuz/chromium', 'firebase-admin', 'pdfjs-dist'],
  // Next traces which files a build actually needs and copies only those into
  // the standalone server. It follows `import` and `require`, which is why it
  // misses both of these: playwright-core reads browsers.json as DATA at
  // runtime, and @sparticuz/chromium's browser is a brotli archive under bin/
  // that nothing imports.
  //
  // The result is a server that starts cleanly, serves every page, and then
  // fails the moment a PDF is asked for -- or, because Business details reports
  // whether PDFs work, fails that page on load. Both packages are therefore
  // copied whole.
  outputFileTracingIncludes: {
    '/**': ['./node_modules/playwright-core/**/*', './node_modules/@sparticuz/chromium/**/*'],
  },
  // The dev indicator defaults to bottom-left, where it sits directly on top of
  // the Home tab at mobile widths and swallows taps. Moved out of the way.
  devIndicators: { position: 'top-right' },
  experimental: {
    // Invoice payloads with many lines can exceed the default server action body cap.
    serverActions: { bodySizeLimit: '4mb' },
  },
};

export default nextConfig;
