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
  title: 'Byoky — MetaMask for AI',
  description:
    'A secure browser wallet for your LLM API keys and setup tokens. Connect to any app — your keys never leave the extension.',
  icons: {
    icon: [
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/icon.svg', type: 'image/svg+xml' },
    ],
    apple: '/apple-touch-icon.png',
  },
  openGraph: {
    title: 'Byoky — MetaMask for AI',
    description:
      'A secure browser wallet for your LLM API keys. Install once, connect everywhere. Your keys never leave the extension.',
    url: 'https://byoky.com',
    siteName: 'Byoky',
    type: 'website',
    images: [
      {
        url: 'https://byoky.com/og-image.png',
        width: 1200,
        height: 630,
        alt: 'Byoky — MetaMask for AI',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Byoky — MetaMask for AI',
    description:
      'A secure browser wallet for your LLM API keys. Your keys never leave the extension.',
    images: ['https://byoky.com/og-image.png'],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${sora.variable} ${jetbrainsMono.variable} ${outfit.variable}`}>
      <body>{children}</body>
    </html>
  );
}
