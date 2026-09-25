import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The PDF renderer drives a real Chromium via playwright-core. It must stay in the
  // Node runtime and must not be bundled by Next's server compiler.
  serverExternalPackages: ['playwright-core', 'firebase-admin'],
  // The dev indicator defaults to bottom-left, where it sits directly on top of
  // the Home tab at mobile widths and swallows taps. Moved out of the way.
  devIndicators: { position: 'top-right' },
  experimental: {
    // Invoice payloads with many lines can exceed the default server action body cap.
    serverActions: { bodySizeLimit: '4mb' },
  },
};

export default nextConfig;
