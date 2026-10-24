import type { Metadata } from 'next';
import { Sora, JetBrains_Mono, Outfit } from 'next/font/google';
import { Navbar } from './components/Navbar';
import { ProductHuntBanner } from './components/ProductHuntBanner';
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
    default: 'Byoky — The MetaMask for API keys',
    template: '%s — Byoky',
  },
  description:
    'Keep every AI API key in one wallet. Apps connect to the wallet, the wallet proxies their calls, and your keys never leave Byoky. No servers, no accounts. 13 providers, fully open source.',
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
    'MetaMask for API keys',
    'local AI key wallet',
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
    title: 'Byoky — The MetaMask for API keys',
    description:
      'Keep every AI API key in one wallet. Apps connect to the wallet. Your keys never leave Byoky. No servers, no accounts, fully open source.',
    url: 'https://byoky.com',
    siteName: 'Byoky',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Byoky — The MetaMask for API keys',
    description:
      'Keep every AI API key in one wallet. Apps connect to the wallet. Your keys never leave Byoky. No servers, no accounts, fully open source.',
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
              operatingSystem: 'Chrome, Firefox, iOS, Android',
              description:
                'The MetaMask for API keys. Keep every AI API key in one wallet, encrypted locally with AES-256-GCM. Apps connect to the wallet and never see your keys. No servers, no accounts, 13 providers, open source.',
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
        <ProductHuntBanner />
        <Navbar />
        {children}
      </body>
    </html>
  );
}
