'use client';

import { useEffect, useState } from 'react';

interface Platform {
  platform: string;
  version: string | null;
  status: string;
  pending?: string;
}

interface VersionData {
  local: string;
  native: string;
  platforms: Platform[];
  generatedAt: string;
}

const ICONS: Record<string, string> = {
  Chrome: 'chrome',
  Firefox: 'firefox',
  iOS: 'apple',
  Android: 'android',
  npm: 'npm',
};

export function VersionStatus() {
  const [data, setData] = useState<VersionData | null>(null);

  useEffect(() => {
    fetch('/versions.json')
      .then((r) => (r.ok ? r.json() : null))
      .then(setData)
      .catch(() => {});
  }, []);

  if (!data) return null;

  return (
    <div className="version-status">
      <div className="version-status-label">Platform versions</div>
      <div className="version-status-grid">
        {data.platforms.map((p) => (
          <div key={p.platform} className="version-status-item">
            <span className="version-status-platform">
              <span className={`version-status-dot ${p.pending ? 'pending' : 'live'}`} />
              {p.platform}
            </span>
            <span className="version-status-version">
              {p.version ? `v${p.version}` : '—'}
              {p.pending && (
                <span className="version-status-pending" title={`v${p.pending} pending review`}>
                  {' '}
                  → v{p.pending}
                </span>
              )}
            </span>
            {p.platform === 'Chrome' && p.pending && (
              <a
                href="https://github.com/MichaelLod/byoky/blob/main/INSTALL.md#chrome-install-from-source"
                className="version-status-source"
                target="_blank"
                rel="noopener noreferrer"
              >
                install from source
              </a>
            )}
            {p.platform === 'iOS' && p.pending && (
              <span className="version-status-source" title="Apple review typically takes 1–3 days">
                review in progress · hang tight
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
