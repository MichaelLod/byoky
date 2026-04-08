import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'App Marketplace',
  description: 'Discover AI apps powered by Byoky. Use one wallet across all of them.',
};

export default function MarketplaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main style={{ maxWidth: '1080px', margin: '0 auto', padding: '32px 24px' }}>
      {children}
    </main>
  );
}
