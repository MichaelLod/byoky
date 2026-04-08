import type { Metadata } from 'next';
import { Sora, JetBrains_Mono, Outfit } from 'next/font/google';
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
    default: 'Byoky — Stripe for AI Access',
    template: '%s — Byoky',
  },
  description:
    'The payment layer for AI apps. Users pay from one wallet, developers pay zero for inference. Add a Pay with Byoky button in 2 lines of code.',
  keywords: [
    'AI payment',
    'AI wallet',
    'Stripe for AI',
    'AI app payments',
    'LLM billing',
    'AI developer tools',
    'pay per use AI',
    'AI inference billing',
    'OpenAI payments',
    'Anthropic payments',
    'AI app marketplace',
    'developer SDK',
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
      { url: '/icon.svg', type: 'image/svg+xml' },
    ],
    apple: '/apple-touch-icon.png',
  },
  openGraph: {
    title: 'Byoky — Bring Your Own Key',
    description:
      'A secure browser wallet for your LLM API keys. Install once, connect everywhere. Your keys never leave the extension.',
    url: 'https://byoky.com',
    siteName: 'Byoky',
    type: 'website',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'Byoky — Bring Your Own Key',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Byoky — Bring Your Own Key',
    description:
      'A secure browser wallet for your LLM API keys. Your keys never leave the extension.',
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
                'A secure browser wallet for your LLM API keys and setup tokens. Connect to any app — your keys never leave the extension.',
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
        {children}
      </body>
    </html>
  );
}
