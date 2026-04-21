'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

interface Platform {
  platform: string;
  version: string | null;
  status: string;
  pending?: string;
}

interface VersionData {
  local: string;
  platforms: Platform[];
}

const CHROME_URL = 'https://chromewebstore.google.com/detail/byoky/igjohldpldlahcjmefdhlnbcpldlgmon';
const FIREFOX_URL = 'https://addons.mozilla.org/en-US/firefox/addon/byoky/';
const IOS_URL = 'https://apps.apple.com/app/byoky/id6760779919';
const ANDROID_URL = 'https://play.google.com/store/apps/details?id=com.byoky.app';

export function InstallWalletButton({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<VersionData | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/versions.json')
      .then((r) => (r.ok ? r.json() : null))
      .then(setData)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const find = (name: string) => data?.platforms.find((p) => p.platform === name);
  const versionLabel = (name: string) => {
    const p = find(name);
    if (!p) return '';
    if (p.pending) return `v${p.pending} pending`;
    return p.version ? `v${p.version}` : '';
  };

  const rollout = data?.local;
  const chrome = find('Chrome');
  const showLoadUnpacked = Boolean(rollout && chrome?.pending === rollout);

  return (
    <div className="install-wallet-wrap" ref={containerRef}>
      <button
        type="button"
        className={className}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {children}
      </button>
      {open && (
        <div className="install-wallet-menu" role="menu">
          <a href={CHROME_URL} target="_blank" rel="noopener noreferrer" role="menuitem">
            <span className="install-wallet-menu-name">Chrome</span>
            <span className="install-wallet-menu-version">{versionLabel('Chrome')}</span>
          </a>
          {showLoadUnpacked && (
            <a
              href={`https://github.com/MichaelLod/byoky/releases/download/v${rollout}/byoky-chrome-v${rollout}.zip`}
              target="_blank"
              rel="noopener noreferrer"
              role="menuitem"
              title="Download unpacked build — load via chrome://extensions → Load unpacked"
            >
              <span className="install-wallet-menu-name">Chrome (load unpacked)</span>
              <span className="install-wallet-menu-version">v{rollout}</span>
            </a>
          )}
          <a href={FIREFOX_URL} target="_blank" rel="noopener noreferrer" role="menuitem">
            <span className="install-wallet-menu-name">Firefox</span>
            <span className="install-wallet-menu-version">{versionLabel('Firefox')}</span>
          </a>
          <a href={IOS_URL} target="_blank" rel="noopener noreferrer" role="menuitem">
            <span className="install-wallet-menu-name">iOS</span>
            <span className="install-wallet-menu-version">{versionLabel('iOS')}</span>
          </a>
          <a href={ANDROID_URL} target="_blank" rel="noopener noreferrer" role="menuitem">
            <span className="install-wallet-menu-name">Android</span>
            <span className="install-wallet-menu-version">{versionLabel('Android')}</span>
          </a>
        </div>
      )}
    </div>
  );
}
