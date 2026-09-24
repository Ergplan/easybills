import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The PDF renderer drives a real Chromium via playwright-core. It must stay in the
  // Node runtime and must not be bundled by Next's server compiler.
  serverExternalPackages: ['playwright-core', 'firebase-admin'],
  experimental: {
    // Invoice payloads with many lines can exceed the default server action body cap.
    serverActions: { bodySizeLimit: '4mb' },
  },
};

export default nextConfig;
