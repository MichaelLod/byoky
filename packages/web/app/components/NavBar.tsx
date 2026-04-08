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
                transition: 'all 0.15s',
              }}
            >
              {link.label}
            </a>
          ))}
          <a
            href="https://github.com/MichaelLod/byoky"
            target="_blank"
            rel="noopener noreferrer"
            style={{ padding: '8px 14px', color: 'var(--text-secondary)', textDecoration: 'none' }}
          >
            GitHub
          </a>
          <a href="/demo/pay" style={{
            padding: '8px 16px', borderRadius: '8px',
            background: 'var(--teal)', color: '#fff',
            textDecoration: 'none', fontWeight: 600, fontSize: '13px',
            marginLeft: '4px',
          }}>
            Try Byoky
          </a>
        </div>
      </div>
    </nav>
  );
}
