'use client';

import { usePathname } from 'next/navigation';
import { useRef, useState, useEffect } from 'react';

const installOptions: { label: string; href: string; external: boolean; icon: string }[] = [
  { label: 'Web App', href: '/wallet/connect', external: false, icon: 'globe' },
  { label: 'Chrome', href: 'https://chromewebstore.google.com/detail/byoky/igjohldpldlahcjmefdhlnbcpldlgmon', external: true, icon: 'chrome' },
  { label: 'Firefox', href: 'https://addons.mozilla.org/en-US/firefox/addon/byoky/', external: true, icon: 'firefox' },
  { label: 'iOS', href: 'https://apps.apple.com/app/byoky/id6760779919', external: true, icon: 'apple' },
  { label: 'Android', href: 'https://play.google.com/store/apps/details?id=com.byoky.app', external: true, icon: 'android' },
];

function DropdownIcon({ name }: { name: string }) {
  switch (name) {
    case 'globe': return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>;
    case 'chrome': return <svg width="16" height="16" viewBox="0 0 48 48"><circle cx="24" cy="24" r="22" fill="#fff" stroke="#ddd" strokeWidth="1"/><path d="M24 8a16 16 0 0 1 13.86 8H24v0z" fill="#EA4335"/><path d="M37.86 16A16 16 0 0 1 24 40l6.93-12z" fill="#FBBC05"/><path d="M24 40A16 16 0 0 1 10.14 16l6.93 12z" fill="#34A853"/><path d="M10.14 16A16 16 0 0 1 24 8v8z" fill="#4285F4"/><circle cx="24" cy="24" r="6" fill="#fff"/><circle cx="24" cy="24" r="4" fill="#4285F4"/></svg>;
    case 'firefox': return <svg width="16" height="16" viewBox="0 0 48 48"><circle cx="24" cy="24" r="22" fill="#fff" stroke="#ddd" strokeWidth="1"/><path d="M38 18c-1-4-4-7-8-9 2 2 3 5 3 7 0 3-2 6-5 7-4 1-7-1-7-1s1 5 6 6c4 1 8-1 10-4 1-1 1-3 1-6z" fill="#FF4F00"/><path d="M14 30c-1-3 0-6 2-9 1-2 3-3 5-4-2 2-3 4-2 7 0 2 2 4 4 5 3 1 6 0 7-2-1 3-4 6-8 6-3 1-6-1-8-3z" fill="#FF9500"/></svg>;
    case 'apple': return <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg>;
    case 'android': return <svg width="16" height="16" viewBox="0 0 24 24" fill="#3DDC84"><path d="M17.523 15.341a.91.91 0 0 0 .916-.907V9.478a.91.91 0 0 0-.916-.907.91.91 0 0 0-.917.907v4.956a.91.91 0 0 0 .917.907zm-11.046 0a.91.91 0 0 0 .917-.907V9.478a.91.91 0 0 0-.917-.907.91.91 0 0 0-.916.907v4.956a.91.91 0 0 0 .916.907zm1.48 5.178c0 .504.41.912.916.912h.95v2.66a.91.91 0 0 0 .916.909.91.91 0 0 0 .917-.908v-2.66h1.688v2.66a.91.91 0 0 0 .916.909.91.91 0 0 0 .917-.908v-2.66h.95a.914.914 0 0 0 .916-.913V8.879H7.957v11.64zM15.4 3.11l1.124-1.727a.235.235 0 0 0-.073-.324.237.237 0 0 0-.326.072l-1.14 1.75A6.813 6.813 0 0 0 12 2.321c-1.07 0-2.08.195-3.003.56L7.857 1.13a.236.236 0 0 0-.325-.072.235.235 0 0 0-.073.324L8.583 3.11C6.572 4.12 5.204 6.071 5.204 8.338h13.592c0-2.267-1.368-4.219-3.396-5.228zM9.662 6.39a.57.57 0 0 1-.572-.568.57.57 0 0 1 .572-.57.57.57 0 0 1 .573.57.57.57 0 0 1-.573.569zm4.676 0a.57.57 0 0 1-.573-.568.57.57 0 0 1 .573-.57.57.57 0 0 1 .572.57.57.57 0 0 1-.572.569z"/></svg>;
    default: return null;
  }
}

const links = [
  { href: '/', label: 'Home' },
  { href: '/demo', label: 'Demo' },
  { href: '/openclaw', label: 'OpenClaw' },
  { href: '/developer', label: 'Developers' },
  { href: '/marketplace', label: 'Marketplace' },
  { href: '/blog', label: 'Blog' },
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
  const [mobileOpen, setMobileOpen] = useState(false);
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
        <a href="/" style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 800, fontSize: '20px', color: 'var(--text)', textDecoration: 'none', letterSpacing: '-0.02em' }}>
          <img src="/byoky-icon.png" alt="" style={{ height: '24px', width: 'auto' }} />
          Byoky
        </a>
        {/* Mobile hamburger */}
        <button
          className="nav-burger"
          onClick={() => setMobileOpen(!mobileOpen)}
          style={{ display: 'none', background: 'none', border: 'none', padding: '8px', cursor: 'pointer', color: 'var(--text)' }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {mobileOpen ? <><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></> : <><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="18" x2="21" y2="18" /></>}
          </svg>
        </button>
        <div ref={containerRef} className={`nav-links ${mobileOpen ? 'nav-links-open' : ''}`} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '14px', position: 'relative' }}>
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
              onClick={() => setMobileOpen(false)}
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
          <InstallDropdown />
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
      {mobileOpen && (
        <div className="nav-mobile-menu">
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={() => setMobileOpen(false)}
              style={{ fontWeight: isActive(pathname, link.href) ? 600 : 400, color: isActive(pathname, link.href) ? 'var(--teal)' : undefined }}
            >
              {link.label}
            </a>
          ))}
          <a href="https://github.com/MichaelLod/byoky" target="_blank" rel="noopener noreferrer" onClick={() => setMobileOpen(false)}>
            GitHub
          </a>
        </div>
      )}
      <style>{`
        @media (max-width: 768px) {
          .nav-burger { display: flex !important; }
          .nav-links { display: none !important; }
          .nav-mobile-menu {
            display: flex;
            flex-direction: column;
            gap: 4px;
            padding: 12px 24px 16px;
            border-top: 1px solid var(--border);
            position: absolute;
            left: 0;
            right: 0;
            background: rgba(255,255,255,0.98);
            backdrop-filter: blur(12px);
            box-shadow: 0 8px 24px rgba(0,0,0,0.08);
            z-index: 200;
          }
          .nav-mobile-menu a {
            padding: 10px 14px;
            border-radius: 8px;
            font-size: 15px;
            color: var(--text-secondary);
            text-decoration: none;
          }
          .nav-mobile-menu a:hover {
            background: var(--bg-elevated);
          }
        }
        @media (min-width: 769px) {
          .nav-mobile-menu { display: none; }
        }
      `}</style>
    </nav>
  );
}

function InstallDropdown() {
  const [open, setOpen] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleEnter() {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setOpen(true);
  }
  function handleLeave() {
    timeoutRef.current = setTimeout(() => setOpen(false), 150);
  }

  return (
    <div
      style={{ position: 'relative', zIndex: 10, marginLeft: '4px' }}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      <button
        style={{
          padding: '8px 16px', borderRadius: '8px',
          background: 'var(--teal)', color: '#fff',
          border: 'none', fontWeight: 600, fontSize: '13px',
          cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px',
        }}
      >
        Try Byoky
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d={open ? 'M3 8l3-3 3 3' : 'M3 4l3 3 3-3'} />
        </svg>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', right: 0, marginTop: '6px',
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: '12px', padding: '6px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
          minWidth: '180px',
        }}>
          {installOptions.map((opt) => (
            <a
              key={opt.label}
              href={opt.href}
              target={opt.external ? '_blank' : undefined}
              rel={opt.external ? 'noopener noreferrer' : undefined}
              style={{
                display: 'flex', alignItems: 'center', gap: '10px',
                padding: '8px 14px', borderRadius: '8px',
                fontSize: '13px', color: 'var(--text)', textDecoration: 'none',
                transition: 'background 0.15s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-elevated)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              <DropdownIcon name={opt.icon} />
              {opt.label}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
