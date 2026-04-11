import type { Metadata } from 'next';
import { Sora, JetBrains_Mono, Outfit } from 'next/font/google';
import './globals.css';
import { NavBar } from './components/Navbar';

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
    'Build AI apps with zero API costs. Your users connect their own keys through Byoky — encrypted locally, proxied securely. 15 providers, 2 lines to integrate. Open source.',
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
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png',
  },
  openGraph: {
    title: 'Byoky — Build AI apps. Your users bring the keys.',
    description:
      'Build AI apps with zero API costs. Your users bring their own keys — encrypted locally, proxied securely. 15 providers, 2 lines to integrate.',
    url: 'https://byoky.com',
    siteName: 'Byoky',
    type: 'website',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'Byoky — Build AI apps with zero API costs',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Byoky — Build AI apps. Your users bring the keys.',
    description:
      'Build AI apps with zero API costs. 15 providers, 2 lines to integrate. Your users bring their own keys — encrypted and proxied securely.',
    images: ['/og-image.png'],
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
                'Build AI apps with zero API costs. Your users bring their own keys — encrypted locally with AES-256-GCM, proxied securely. 15 providers, open source.',
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
        <NavBar />
        {children}
      </body>
    </html>
  );
}
