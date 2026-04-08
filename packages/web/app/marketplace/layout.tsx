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
    <div>
      <nav style={{
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        padding: '16px 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: 'rgba(0,0,0,0.3)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
          <a href="/" style={{ fontWeight: 700, fontSize: '18px', color: '#f5f5f7', textDecoration: 'none' }}>
            Byoky
          </a>
          <a href="/marketplace" style={{ color: '#a1a1aa', textDecoration: 'none', fontSize: '14px' }}>
            Marketplace
          </a>
        </div>
        <a
          href="/developer/setup"
          style={{
            padding: '8px 16px', borderRadius: '8px',
            background: 'rgba(255,255,255,0.06)', color: '#e4e4e7',
            border: '1px solid rgba(255,255,255,0.1)', textDecoration: 'none',
            fontSize: '13px',
          }}
        >
          List your app
        </a>
      </nav>
      <main style={{ maxWidth: '1080px', margin: '0 auto', padding: '32px 24px' }}>
        {children}
      </main>
    </div>
  );
}
