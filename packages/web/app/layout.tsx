import type { Metadata, Viewport } from 'next';
import { Chakra_Petch, IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';
import { Navbar } from './components/Navbar';
import { ProductHuntBanner } from './components/ProductHuntBanner';
import './globals.css';

const chakraPetch = Chakra_Petch({
  subsets: ['latin'],
  weight: ['600', '700'],
  variable: '--font-chakra',
  display: 'swap',
});

const plexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-plex',
  display: 'swap',
});

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
  display: 'swap',
});

// Browsers keep a favicon cached under its URL, so a new icon needs a new
// URL. Bump this whenever the icon files in public/ change.
const ICON_VERSION = '?v=3';

// Render every page per request: the CSP's script nonce (middleware.ts) is
// new for each response, and Next.js can only put it on the inline scripts
// of a page it is rendering, not of one prerendered at build time.
export const dynamic = 'force-dynamic';

export const viewport: Viewport = {
  themeColor: '#07060A',
  colorScheme: 'dark',
};

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
      { url: `/favicon-v2.ico${ICON_VERSION}`, sizes: 'any' },
      { url: `/favicon-16x16.png${ICON_VERSION}`, sizes: '16x16', type: 'image/png' },
      { url: `/favicon-32x32.png${ICON_VERSION}`, sizes: '32x32', type: 'image/png' },
      { url: `/favicon-96x96.png${ICON_VERSION}`, sizes: '96x96', type: 'image/png' },
      { url: `/icon-192.png${ICON_VERSION}`, sizes: '192x192', type: 'image/png' },
      { url: `/icon-512.png${ICON_VERSION}`, sizes: '512x512', type: 'image/png' },
      { url: `/icon.svg${ICON_VERSION}`, type: 'image/svg+xml' },
    ],
    shortcut: `/favicon-v2.ico${ICON_VERSION}`,
    apple: `/apple-touch-icon.png${ICON_VERSION}`,
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
    <html lang="en" className={`${chakraPetch.variable} ${plexSans.variable} ${plexMono.variable}`}>
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
