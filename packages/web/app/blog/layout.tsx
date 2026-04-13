import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Blog — Byoky',
  description:
    'Notes on AI API keys, wallets, agent plumbing, and what we learn while building Byoky.',
  alternates: { canonical: '/blog' },
};

export default function BlogLayout({ children }: { children: React.ReactNode }) {
  return <div style={{ background: '#0e0e1a', minHeight: '100vh' }}>{children}</div>;
}
