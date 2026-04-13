import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Developer Docs — Byoky',
  description: 'SDK reference, app ecosystem guide, and integration docs for building on Byoky.',
  alternates: { canonical: '/docs' },
};

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return <div style={{ background: '#0e0e1a', minHeight: '100vh' }}>{children}</div>;
}
