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
  platforms: Platform[];
}

export function HeroRollout() {
  const [data, setData] = useState<VersionData | null>(null);

  useEffect(() => {
    fetch('/versions.json')
      .then((r) => (r.ok ? r.json() : null))
      .then(setData)
      .catch(() => {});
  }, []);

  if (!data) return null;

  const rollout = data.local;
  const liveOn: string[] = [];
  const pendingOn: string[] = [];

  for (const p of data.platforms) {
    if (p.platform === 'npm') continue;
    if (p.pending === rollout) pendingOn.push(p.platform);
    else if (p.version === rollout) liveOn.push(p.platform);
  }

  const fmt = (list: string[]) => {
    if (list.length === 0) return '';
    if (list.length === 1) return list[0];
    if (list.length === 2) return `${list[0]} & ${list[1]}`;
    return `${list.slice(0, -1).join(', ')} & ${list[list.length - 1]}`;
  };

  return (
    <div className="hero-rollout">
      <strong>v{rollout} rollout:</strong>{' '}
      {liveOn.length > 0 && (
        <span className="hero-rollout-live">{fmt(liveOn)} live</span>
      )}
      {liveOn.length > 0 && pendingOn.length > 0 && <span>{' · '}</span>}
      {pendingOn.length > 0 && (
        <span className="hero-rollout-pending">{fmt(pendingOn)} inbound</span>
      )}
    </div>
  );
}
