import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Token Marketplace — Byoky',
  description: 'Browse free community token gifts. Redeem API tokens shared by generous users.',
  alternates: { canonical: '/marketplace' },
};

export default function MarketplaceLayout({ children }: { children: React.ReactNode }) {
  return children;
}
