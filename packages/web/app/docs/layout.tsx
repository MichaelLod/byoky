import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Developer Docs — Byoky',
  description: 'SDK reference and integration guides for building on Byoky. Users bring their own AI keys through a local wallet.',
  alternates: { canonical: '/docs' },
};

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return <div style={{ background: 'var(--bg)', minHeight: '100vh' }}>{children}</div>;
}
