import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Token Pool — Byoky',
  description: 'Browse free community token gifts. Redeem API tokens shared by generous users.',
  alternates: { canonical: '/token-pool' },
};

export default function TokenPoolLayout({ children }: { children: React.ReactNode }) {
  return children;
}
