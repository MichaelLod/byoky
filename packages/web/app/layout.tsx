import type { Metadata } from 'next';
import { Sora, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const sora = Sora({
  subsets: ['latin'],
  variable: '--font-sora',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'byoky — MetaMask for AI',
  description:
    'A secure browser wallet for your LLM API keys and auth tokens. Your keys never leave the extension.',
  openGraph: {
    title: 'byoky — MetaMask for AI',
    description:
      'A secure browser wallet for your LLM API keys. Install once, connect everywhere.',
    url: 'https://byoky.com',
    siteName: 'byoky',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'byoky — MetaMask for AI',
    description:
      'A secure browser wallet for your LLM API keys. Your keys never leave the extension.',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${sora.variable} ${jetbrainsMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
