import type { Metadata } from 'next';
import { Sora, JetBrains_Mono, Outfit } from 'next/font/google';
import { Navbar } from './components/Navbar';
import './globals.css';

const sora = Sora({
  subsets: ['latin'],
  variable: '--font-sora',
  display: 'swap',
});

const outfit = Outfit({
  subsets: ['latin'],
  variable: '--font-outfit',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL('https://byoky.com'),
  title: {
    default: 'Byoky — Build AI apps. Your users bring the keys.',
    template: '%s — Byoky',
  },
  description:
    'Build AI apps with zero API costs. Your users connect their own keys through Byoky — encrypted locally, proxied securely. 13 providers, 2 lines to integrate. Open source.',
  keywords: [
    'AI API key wallet',
    'LLM API key manager',
    'bring your own key',
    'BYOK',
    'browser extension',
    'API key security',
    'Chrome extension security',
    'API key theft protection',
    'secure API key storage',
    'AI key encryption',
    'protect OpenAI keys',
    'OpenAI key wallet',
    'Anthropic key wallet',
    'AI developer tools',
  ],
  alternates: {
    canonical: '/',
  },
  icons: {
    icon: [
      { url: '/favicon-v2.ico', sizes: 'any' },
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon-96x96.png', sizes: '96x96', type: 'image/png' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { url: '/icon.svg', type: 'image/svg+xml' },
    ],
    shortcut: '/favicon-v2.ico',
    apple: '/apple-touch-icon.png',
  },
  openGraph: {
    title: 'Byoky — Share your AI budget without sharing your keys',
    description:
      'Send a friend tokens from your Claude, OpenAI, or Gemini plan. One network for all your AI tokens — open source, end-to-end encrypted.',
    url: 'https://byoky.com',
    siteName: 'Byoky',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Byoky — Share your AI budget without sharing your keys',
    description:
      'Send a friend tokens from your Claude, OpenAI, or Gemini plan. One network for all your AI tokens — open source, end-to-end encrypted.',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${sora.variable} ${jetbrainsMono.variable} ${outfit.variable}`}>
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'SoftwareApplication',
              name: 'Byoky',
              applicationCategory: 'BrowserApplication',
              operatingSystem: 'Chrome, Firefox, Safari',
              description:
                'Build AI apps with zero API costs. Your users bring their own keys — encrypted locally with AES-256-GCM, proxied securely. 13 providers, open source.',
              url: 'https://byoky.com',
              offers: {
                '@type': 'Offer',
                price: '0',
                priceCurrency: 'USD',
              },
              isAccessibleForFree: true,
              license: 'https://opensource.org/licenses/MIT',
            }),
          }}
        />
        <Navbar />
        {children}
      </body>
    </html>
  );
}
