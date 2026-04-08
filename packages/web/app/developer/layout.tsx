import type { Metadata } from 'next';
import '../demo/demo.css';

// Override demo-app dark theme when used in developer portal
const devOverrideCSS = `
.dev-code-example.demo-app {
  --bg: #ffffff;
  --bg-surface: #f8f9fa;
  --bg-card: #ffffff;
  --bg-elevated: #f1f3f5;
  --border: #e2e8f0;
  --border-hover: #cbd5e1;
  --text: #1a1a2e;
  --text-secondary: #64748b;
  --text-muted: #94a3b8;
  --teal: #FF4F00;
  --teal-light: #FF6B2B;
  --teal-dark: #CC3F00;
  background: transparent;
  min-height: auto;
  padding: 0;
}
.dev-code-example .code-window {
  background: #1a1a2e;
}
.dev-code-example .code-body,
.dev-code-example .code-body code {
  color: #e2e2ec;
}
.dev-code-example .code-titlebar {
  background: rgba(0,0,0,0.2);
}
.dev-code-example .code-filename {
  color: #7a7a9c;
}
`;

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
      <style dangerouslySetInnerHTML={{ __html: devOverrideCSS }} />
      <nav style={{
        borderBottom: '1px solid var(--border)',
        padding: '0 24px',
        display: 'flex',
        alignItems: 'center',
        gap: '20px',
        fontSize: '14px',
        maxWidth: '960px',
        margin: '0 auto',
      }}>
        <a href="/developer" style={{ padding: '12px 0', color: 'var(--text-secondary)', textDecoration: 'none', borderBottom: '2px solid transparent' }}>Dashboard</a>
        <a href="/developer/apps" style={{ padding: '12px 0', color: 'var(--text-secondary)', textDecoration: 'none', borderBottom: '2px solid transparent' }}>Apps</a>
        <a href="/developer/setup" style={{ padding: '12px 0', color: 'var(--text-secondary)', textDecoration: 'none', borderBottom: '2px solid transparent' }}>Setup</a>
        <a href="/developer/payouts" style={{ padding: '12px 0', color: 'var(--text-secondary)', textDecoration: 'none', borderBottom: '2px solid transparent' }}>Payouts</a>
      </nav>
      <main style={{ maxWidth: '960px', margin: '0 auto', padding: '32px 24px' }}>
        {children}
      </main>
    </div>
  );
}
