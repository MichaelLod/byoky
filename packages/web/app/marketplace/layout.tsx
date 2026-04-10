import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'App Marketplace — Byoky',
  description: 'Discover and install apps that run on your own API keys.',
  alternates: { canonical: '/marketplace' },
};

export default function MarketplaceLayout({ children }: { children: React.ReactNode }) {
  return children;
}
