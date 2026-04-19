'use client';

import { useState, useRef, useEffect } from 'react';
import { usePathname } from 'next/navigation';

function GitHubIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
    </svg>
  );
}

function DropdownIcon({ name }: { name: string }) {
  switch (name) {
    case 'chrome': return <svg width="16" height="16" viewBox="0 0 48 48"><circle cx="24" cy="24" r="22" fill="#fff" stroke="#ddd" strokeWidth="1"/><path d="M24 8a16 16 0 0 1 13.86 8H24v0z" fill="#EA4335"/><path d="M37.86 16A16 16 0 0 1 24 40l6.93-12z" fill="#FBBC05"/><path d="M24 40A16 16 0 0 1 10.14 16l6.93 12z" fill="#34A853"/><path d="M10.14 16A16 16 0 0 1 24 8v8z" fill="#4285F4"/><circle cx="24" cy="24" r="6" fill="#fff"/><circle cx="24" cy="24" r="4" fill="#4285F4"/></svg>;
    case 'firefox': return <svg width="16" height="16" viewBox="0 0 48 48"><circle cx="24" cy="24" r="22" fill="#fff" stroke="#ddd" strokeWidth="1"/><path d="M38 18c-1-4-4-7-8-9 2 2 3 5 3 7 0 3-2 6-5 7-4 1-7-1-7-1s1 5 6 6c4 1 8-1 10-4 1-1 1-3 1-6z" fill="#FF4F00"/><path d="M14 30c-1-3 0-6 2-9 1-2 3-3 5-4-2 2-3 4-2 7 0 2 2 4 4 5 3 1 6 0 7-2-1 3-4 6-8 6-3 1-6-1-8-3z" fill="#FF9500"/></svg>;
    case 'apple': return <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg>;
    case 'android': return <svg width="16" height="16" viewBox="0 0 24 24" fill="#3DDC84"><path d="M17.523 15.341a.91.91 0 0 0 .916-.907V9.478a.91.91 0 0 0-.916-.907.91.91 0 0 0-.917.907v4.956a.91.91 0 0 0 .917.907zm-11.046 0a.91.91 0 0 0 .917-.907V9.478a.91.91 0 0 0-.917-.907.91.91 0 0 0-.916.907v4.956a.91.91 0 0 0 .916.907zm1.48 5.178c0 .504.41.912.916.912h.95v2.66a.91.91 0 0 0 .916.909.91.91 0 0 0 .917-.908v-2.66h1.688v2.66a.91.91 0 0 0 .916.909.91.91 0 0 0 .917-.908v-2.66h.95a.914.914 0 0 0 .916-.913V8.879H7.957v11.64zM15.4 3.11l1.124-1.727a.235.235 0 0 0-.073-.324.237.237 0 0 0-.326.072l-1.14 1.75A6.813 6.813 0 0 0 12 2.321c-1.07 0-2.08.195-3.003.56L7.857 1.13a.236.236 0 0 0-.325-.072.235.235 0 0 0-.073.324L8.583 3.11C6.572 4.12 5.204 6.071 5.204 8.338h13.592c0-2.267-1.368-4.219-3.396-5.228zM9.662 6.39a.57.57 0 0 1-.572-.568.57.57 0 0 1 .572-.57.57.57 0 0 1 .573.57.57.57 0 0 1-.573.569zm4.676 0a.57.57 0 0 1-.573-.568.57.57 0 0 1 .573-.57.57.57 0 0 1 .572.57.57.57 0 0 1-.572.569z"/></svg>;
    default: return null;
  }
}

const installOptions = [
  { label: 'Chrome', href: 'https://chromewebstore.google.com/detail/byoky/igjohldpldlahcjmefdhlnbcpldlgmon', icon: 'chrome' },
  { label: 'Firefox', href: 'https://addons.mozilla.org/en-US/firefox/addon/byoky/', icon: 'firefox' },
  { label: 'iOS', href: 'https://apps.apple.com/app/byoky/id6760779919', icon: 'apple' },
  { label: 'Android', href: 'https://play.google.com/store/apps/details?id=com.byoky.app', icon: 'android' },
];

export function Navbar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [embedded, setEmbedded] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleEnter() {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setOpen(true);
  }
  function handleLeave() {
    timeoutRef.current = setTimeout(() => setOpen(false), 150);
  }

  useEffect(() => () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); }, []);

  useEffect(() => {
    const w = window as unknown as { __byokyBridge?: unknown };
    if (window.self !== window.top || w.__byokyBridge) setEmbedded(true);
  }, []);

  useEffect(() => { setMobileOpen(false); }, [pathname]);

  if (pathname === '/chat' || embedded) return null;

  const navLinks: Array<{ href: string; label: string; match: (p: string) => boolean }> = [
    { href: '/', label: 'Home', match: (p) => p === '/' },
    { href: '/token-pool', label: 'Token Pool', match: (p) => p.startsWith('/token-pool') || p.startsWith('/marketplace') },
    { href: '/demo', label: 'Demo', match: (p) => p.startsWith('/demo') },
    { href: '/openclaw', label: 'OpenClaw', match: (p) => p.startsWith('/openclaw') },
    { href: '/blog', label: 'Blog', match: (p) => p.startsWith('/blog') },
    { href: '/docs', label: 'Docs', match: (p) => p.startsWith('/docs') },
  ];

  return (
    <nav className="navbar">
      <div className="container navbar-inner">
        <a href="/" className="navbar-brand">
          <img src="/byoky_logo.svg" alt="Byoky" width="28" height="28" />
          Byoky
        </a>
        <div className="navbar-links">
          {navLinks.map((l) => (
            <a key={l.href} href={l.href} className={l.match(pathname) ? 'nav-active' : ''}>{l.label}</a>
          ))}
        </div>
        <div className="navbar-right">
          <a
            href="https://github.com/MichaelLod/byoky"
            className="navbar-icon"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="GitHub"
          >
            <GitHubIcon />
          </a>
          <div
            className="install-dropdown"
            onMouseEnter={handleEnter}
            onMouseLeave={handleLeave}
          >
            <button className="btn btn-primary btn-sm">
              Install
              <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" style={{ marginLeft: 4 }}>
                <path d={open ? 'M3 8l3-3 3 3' : 'M3 4l3 3 3-3'} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
              </svg>
            </button>
            {open && (
              <div className="install-dropdown-menu">
                {installOptions.map((opt) => (
                  <a
                    key={opt.label}
                    href={opt.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="install-dropdown-item"
                  >
                    <DropdownIcon name={opt.icon} />
                    {opt.label}
                  </a>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            className="navbar-menu-btn"
            aria-label="Menu"
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((v) => !v)}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {mobileOpen ? (
                <><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>
              ) : (
                <><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></>
              )}
            </svg>
          </button>
        </div>
      </div>
      {mobileOpen && (
        <div className="navbar-mobile-menu">
          {navLinks.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className={l.match(pathname) ? 'nav-active' : ''}
              onClick={() => setMobileOpen(false)}
            >
              {l.label}
            </a>
          ))}
        </div>
      )}
    </nav>
  );
}
