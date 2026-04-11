'use client';

import { useState, useRef, useEffect } from 'react';

function GitHubIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
    </svg>
  );
}

const installOptions = [
  { label: 'Chrome', href: 'https://chromewebstore.google.com/detail/byoky/igjohldpldlahcjmefdhlnbcpldlgmon' },
  { label: 'Firefox', href: 'https://addons.mozilla.org/en-US/firefox/addon/byoky/' },
  { label: 'iOS', href: 'https://apps.apple.com/app/byoky/id6760779919' },
  { label: 'Android', href: 'https://play.google.com/store/apps/details?id=com.byoky.app' },
];

export function Navbar() {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <nav className="navbar">
      <div className="container navbar-inner">
        <a href="/" className="navbar-brand">
          <svg width="28" height="28" viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
            <polygon points="40,5 64,3 88,5 64,14" fill="#0ea5e9"/>
            <polygon points="40,5 22,12 44,18" fill="#0284c7"/>
            <polygon points="88,5 106,12 84,18" fill="#0284c7"/>
            <polygon points="22,12 12,26 36,26" fill="#075985"/>
            <polygon points="106,12 116,26 92,26" fill="#075985"/>
            <polygon points="12,26 6,42 30,40" fill="#082f49"/>
            <polygon points="116,26 122,42 98,40" fill="#082f49"/>
            <polygon points="36,26 30,40 48,38" fill="#1e0a4a"/>
            <polygon points="92,26 98,40 80,38" fill="#1e0a4a"/>
            <circle cx="24" cy="46" r="4.5" fill="#7dd3fc"/>
            <circle cx="24" cy="46" r="2.2" fill="#e0d4ff"/>
            <circle cx="104" cy="46" r="4.5" fill="#7dd3fc"/>
            <circle cx="104" cy="46" r="2.2" fill="#e0d4ff"/>
            <polygon points="52,56 64,60 64,88" fill="#3f3f4a"/>
            <polygon points="76,56 64,60 64,88" fill="#353540"/>
          </svg>
          Byoky
        </a>
        <div className="navbar-links">
          <a href="/docs">Docs</a>
          <a href="/openclaw">OpenClaw</a>
          <a href="/blog">Blog</a>
          <a href="/demo">Demo</a>
          <a href="/apps">Apps</a>
          <a href="/marketplace">Marketplace</a>
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
          <div ref={menuRef} className="install-dropdown">
            <button
              className="btn btn-primary btn-sm"
              onClick={() => setOpen(!open)}
            >
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
                    {opt.label}
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
