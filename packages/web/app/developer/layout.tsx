import type { Metadata } from 'next';
import '../demo/demo.css';

export const metadata: Metadata = {
  title: 'Developer Portal',
  description: 'Register your app, integrate the Byoky SDK, and track usage analytics.',
};

export default function DeveloperLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="developer-portal">
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
          <div style={{ display: 'flex', gap: '16px', fontSize: '14px' }}>
            <a href="/developer" style={{ color: '#a1a1aa', textDecoration: 'none' }}>Dashboard</a>
            <a href="/developer/apps" style={{ color: '#a1a1aa', textDecoration: 'none' }}>Apps</a>
            <a href="/developer/setup" style={{ color: '#a1a1aa', textDecoration: 'none' }}>Setup</a>
            <a href="/developer/payouts" style={{ color: '#a1a1aa', textDecoration: 'none' }}>Payouts</a>
          </div>
        </div>
      </nav>
      <main style={{ maxWidth: '960px', margin: '0 auto', padding: '32px 24px' }}>
        {children}
      </main>
    </div>
  );
}
