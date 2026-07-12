import type { Metadata } from 'next';
import { Space_Grotesk, Inter, JetBrains_Mono } from 'next/font/google';
import { Navbar } from './components/Navbar';
import { ProductHuntBanner } from './components/ProductHuntBanner';
import './globals.css';

// Display: a grotesk with mechanical character (shares DNA with monospace) — an
// "instrument" voice for a control plane. Body: Inter, neutral and legible.
// Mono: JetBrains — carries every number, label, and readout (the signature).
const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-sora', // keep the existing var name so all rules pick it up
  display: 'swap',
});

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
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
    default: 'Byoky — The control layer for AI spend',
    template: '%s — Byoky',
  },
  description:
    'Govern every AI dollar. Give every employee and agent access to any model with budgets, policy, and real-time spend visibility. Typically cuts 20–40% of the AI bill. Live in 10 minutes. 2% of managed spend — no seats, no flat fee.',
  keywords: [
    'AI spend management',
    'LLM cost control',
    'AI governance platform',
    'LLM gateway',
    'AI budgets and policy',
    'AI observability',
    'AI FinOps',
    'AI access management',
    'LLM proxy',
    'AI cost optimization',
    'enterprise AI control plane',
    'AI usage governance',
    'multi-provider LLM',
    'BYOK enterprise',
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
    title: 'Byoky — The control layer for AI spend',
    description:
      'Okta + Ramp, for AI. Govern every AI dollar with budgets, policy, and observability across every provider. Cut 20–40% of your AI bill. 2% of managed spend — no seats.',
    url: 'https://byoky.com',
    siteName: 'Byoky',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Byoky — The control layer for AI spend',
    description:
      'Okta + Ramp, for AI. Govern every AI dollar with budgets, policy, and observability. Cut 20–40% of your AI bill. 2% of managed spend — no seats.',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${spaceGrotesk.variable} ${jetbrainsMono.variable} ${inter.variable}`}>
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'SoftwareApplication',
              name: 'Byoky',
              applicationCategory: 'BusinessApplication',
              operatingSystem: 'Web',
              description:
                'The control layer for AI spend. Govern every AI dollar with budgets, policy, observability, and cost optimization across every provider. 2% of managed spend — no seats, no flat fee.',
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
