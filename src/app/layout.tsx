import type { Metadata, Viewport } from 'next';
import { Baloo_2, Mukta } from 'next/font/google';

import { FirebaseConfig } from '@/components/FirebaseConfig';
import { publicFirebaseConfig } from '@/lib/env';

import './globals.css';

/**
 * Two faces from Ek Type in Mumbai, self-hosted by next/font at build time so
 * no request leaves the owner's browser for a font.
 *
 * Baloo 2 for headings: rounded, confident, and a little warm, which is the
 * voice. Mukta for everything else, made to sit beside it. Both ship
 * Devanagari, so the day the app speaks Hindi in Hindi script, the type is
 * already here.
 */
const baloo = Baloo_2({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-display',
  weight: ['600', '700', '800'],
});

const mukta = Mukta({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
  weight: ['400', '500', '600', '700'],
});

export const metadata: Metadata = {
  title: 'EkBill',
  description: 'Bill banao. WhatsApp pe bhejo. Dekho kiske paise aane hain.',
  applicationName: 'EkBill',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Pinch-zoom stays available: disabling it fails an accessibility requirement
  // and this layout does not need it disabled.
  maximumScale: 5,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f1e7' },
    { media: '(prefers-color-scheme: dark)', color: '#191714' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Read on the server, once per request, and handed down. See FirebaseConfig.
  const firebase = publicFirebaseConfig();

  return (
    <html lang="en-IN" className={`${mukta.variable} ${baloo.variable}`}>
      <body>
        <FirebaseConfig config={firebase} />
        {children}
      </body>
    </html>
  );
}
