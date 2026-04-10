import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Apps — Byoky',
  description: 'Discover and install apps that run on your own API keys.',
  alternates: { canonical: '/apps' },
};

export default function AppsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
