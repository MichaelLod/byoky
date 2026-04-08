'use client';

import { usePathname } from 'next/navigation';
import { useRef, useState, useEffect } from 'react';

const links = [
  { href: '/', label: 'Home' },
  { href: '/demo/pay', label: 'Demo' },
  { href: '/developer', label: 'Developers' },
  { href: '/marketplace', label: 'Marketplace' },
  { href: '/wallet', label: 'Wallet' },
];

function isActive(pathname: string, href: string) {
  if (href === '/') return pathname === '/';
  return pathname.startsWith(href);
}

export function NavBar() {
  const pathname = usePathname();
  const containerRef = useRef<HTMLDivElement>(null);
  const linkRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const activeIndex = links.findIndex((l) => isActive(pathname, l.href));
    const el = linkRefs.current[activeIndex];
    const container = containerRef.current;
    if (el && container) {
      const containerRect = container.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      setIndicator({
        left: elRect.left - containerRect.left,
        width: elRect.width,
      });
    }
  }, [pathname]);

  return (
    <nav style={{
      position: 'sticky', top: 0, zIndex: 100,
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
        <div ref={containerRef} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '14px', position: 'relative' }}>
          {/* Sliding highlight indicator */}
          {mounted && indicator.width > 0 && (
            <div style={{
              position: 'absolute',
              left: indicator.left,
              width: indicator.width,
              height: '34px',
              borderRadius: '8px',
              background: 'rgba(255, 79, 0, 0.08)',
              transition: 'left 0.35s cubic-bezier(0.4, 0, 0.2, 1), width 0.35s cubic-bezier(0.4, 0, 0.2, 1)',
              top: '50%',
              transform: 'translateY(-50%)',
              pointerEvents: 'none',
            }} />
          )}
          {links.map((link, i) => (
            <a
              key={link.href}
              href={link.href}
              ref={(el) => { linkRefs.current[i] = el; }}
              style={{
                padding: '8px 14px',
                borderRadius: '8px',
                color: isActive(pathname, link.href) ? 'var(--teal)' : 'var(--text-secondary)',
                textDecoration: 'none',
                fontWeight: isActive(pathname, link.href) ? 600 : 400,
                transition: 'color 0.3s ease',
                position: 'relative',
                zIndex: 1,
              }}
            >
              {link.label}
            </a>
          ))}
          <a href="/demo/pay" style={{
            padding: '8px 16px', borderRadius: '8px',
            background: 'var(--teal)', color: '#fff',
            textDecoration: 'none', fontWeight: 600, fontSize: '13px',
            marginLeft: '4px', position: 'relative', zIndex: 1,
          }}>
            Try Byoky
          </a>
          <a
            href="https://github.com/MichaelLod/byoky"
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: 'flex', alignItems: 'center', padding: '8px', color: 'var(--text-secondary)', marginLeft: '4px', position: 'relative', zIndex: 1 }}
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
