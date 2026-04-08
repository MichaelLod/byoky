'use client';

import { usePathname } from 'next/navigation';

const links = [
  { href: '/', label: 'Home' },
  { href: '/demo/pay', label: 'Demo' },
  { href: '/developer', label: 'Developers' },
  { href: '/marketplace', label: 'Marketplace' },
  { href: '/wallet', label: 'Wallet' },
];

export function NavBar() {
  const pathname = usePathname();

  function isActive(href: string) {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  }

  return (
    <nav style={{
      position: 'sticky', top: 0, zIndex: 100,
      borderBottom: 'none',
      background: 'rgba(255,255,255,0.85)',
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      padding: '0 24px',
    }}>
      <div style={{
        maxWidth: '1080px', margin: '0 auto',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        height: '56px',
      }}>
        <a href="/" style={{ fontWeight: 800, fontSize: '20px', color: 'var(--text)', textDecoration: 'none', letterSpacing: '-0.02em' }}>
          Byoky
        </a>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '14px' }}>
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              style={{
                padding: '8px 14px',
                borderRadius: '8px',
                color: isActive(link.href) ? 'var(--teal)' : 'var(--text-secondary)',
                textDecoration: 'none',
                fontWeight: isActive(link.href) ? 600 : 400,
                background: isActive(link.href) ? 'rgba(255, 79, 0, 0.08)' : 'transparent',
                transition: 'color 0.3s ease, background 0.3s ease, font-weight 0.3s ease',
              }}
            >
              {link.label}
            </a>
          ))}
          <a href="/demo/pay" style={{
            padding: '8px 16px', borderRadius: '8px',
            background: 'var(--teal)', color: '#fff',
            textDecoration: 'none', fontWeight: 600, fontSize: '13px',
            marginLeft: '4px',
          }}>
            Try Byoky
          </a>
          <a
            href="https://github.com/MichaelLod/byoky"
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: 'flex', alignItems: 'center', padding: '8px', color: 'var(--text-secondary)', marginLeft: '4px' }}
            title="GitHub"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
            </svg>
          </a>
        </div>
      </div>
    </nav>
  );
}
