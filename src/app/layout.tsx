import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';

import { FirebaseConfig } from '@/components/FirebaseConfig';
import { publicFirebaseConfig } from '@/lib/env';

import './globals.css';

/**
 * Inter, self-hosted by next/font at build time.
 *
 * Self-hosting matters here beyond performance: no request leaves the owner's
 * browser for a font, so opening a bill does not tell a third party anything.
 * The variable weight range keeps one file doing the work of five.
 *
 * Amounts use Inter's tabular figures rather than a monospace face -- every
 * digit occupies the same width so columns align, without the typewriter look.
 */
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
  weight: ['400', '500', '600', '700'],
});

export const metadata: Metadata = {
  title: 'EasyBills',
  description: 'Create a bill, share it and track payment.',
  applicationName: 'EasyBills',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Pinch-zoom stays available: disabling it fails an accessibility requirement
  // and this layout does not need it disabled.
  maximumScale: 5,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#171614' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Read on the server, once per request, and handed down. See FirebaseConfig.
  const firebase = publicFirebaseConfig();

  return (
    <html lang="en-IN" className={inter.variable}>
      <body>
        <FirebaseConfig config={firebase} />
        {children}
      </body>
    </html>
  );
}
