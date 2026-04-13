'use client';

import { usePathname } from 'next/navigation';

const tabs = [
  { href: '/developer', label: 'Dashboard' },
  { href: '/developer/docs', label: 'Docs' },
  { href: '/developer/apps', label: 'Apps' },
  { href: '/developer/setup', label: 'Setup' },
  { href: '/developer/payouts', label: 'Payouts' },
];

export function DevNav() {
  const pathname = usePathname();

  function isActive(href: string) {
    if (href === '/developer') return pathname === '/developer';
    return pathname.startsWith(href);
  }

  return (
    <div style={{
      position: 'sticky', top: '56px', zIndex: 50,
      background: 'rgba(255,255,255,0.9)',
      backdropFilter: 'blur(8px)',
      WebkitBackdropFilter: 'blur(8px)',
      borderBottom: '1px solid var(--border)',
    }}>
      <nav style={{
        padding: '0 24px',
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        fontSize: '14px',
        maxWidth: '960px',
        margin: '0 auto',
      }}>
        {tabs.map((tab) => (
          <a key={tab.href} href={tab.href} style={{
            padding: '12px 14px',
            color: isActive(tab.href) ? 'var(--teal)' : 'var(--text-secondary)',
            textDecoration: 'none',
            fontSize: '14px',
            fontWeight: isActive(tab.href) ? 600 : 400,
            borderBottom: isActive(tab.href) ? '2px solid var(--teal)' : '2px solid transparent',
            transition: 'color 0.2s, border-color 0.2s',
          }}>{tab.label}</a>
        ))}
      </nav>
    </div>
  );
}
