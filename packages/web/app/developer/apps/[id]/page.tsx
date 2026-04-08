'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useVaultToken, vaultFetch } from '../../../wallet/use-vault';

interface AppStats {
  app: { id: string; name: string; discountPercent: number; totalUsers: number };
  last30Days: {
    totalRequests: number;
    totalAmountCents: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    uniqueUsers: number;
  };
}

export default function AppDetail() {
  const params = useParams();
  const appId = params.id as string;
  const { token, isLoggedIn } = useVaultToken();
  const [stats, setStats] = useState<AppStats | null>(null);

  useEffect(() => {
    if (!token) return;
    vaultFetch(`/developer/apps/${appId}/stats`, token)
      .then(r => r.json())
      .then(data => setStats(data as AppStats))
      .catch(() => {});
  }, [token, appId]);

  if (!isLoggedIn) {
    return <div style={{ padding: '48px', color: '#71717a' }}>Sign in at <a href="/developer" style={{ color: '#0ea5e9' }}>/developer</a> first</div>;
  }

  if (!stats) {
    return <div style={{ padding: '48px', color: '#71717a' }}>Loading...</div>;
  }

  const s = stats.last30Days;

  return (
    <div>
      <a href="/developer" style={{ color: '#71717a', textDecoration: 'none', fontSize: '14px' }}>&larr; Dashboard</a>

      <div style={{ marginTop: '16px', marginBottom: '32px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '4px' }}>{stats.app.name}</h1>
        <code style={{ background: 'rgba(255,255,255,0.06)', padding: '2px 8px', borderRadius: '4px', fontSize: '12px', color: '#71717a' }}>{appId}</code>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px', marginBottom: '32px' }}>
        {[
          { label: 'Unique Users', value: s.uniqueUsers.toLocaleString() },
          { label: 'Total Requests', value: s.totalRequests.toLocaleString() },
          { label: 'Input Tokens', value: formatTokens(s.totalInputTokens) },
          { label: 'Output Tokens', value: formatTokens(s.totalOutputTokens) },
          { label: 'Total Revenue', value: `$${(s.totalAmountCents / 100).toFixed(2)}` },
          { label: 'Discount Rate', value: `${stats.app.discountPercent}%` },
        ].map(stat => (
          <div key={stat.label} style={{
            background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '10px', padding: '16px',
          }}>
            <div style={{ fontSize: '11px', color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>{stat.label}</div>
            <div style={{ fontSize: '22px', fontWeight: 700 }}>{stat.value}</div>
          </div>
        ))}
      </div>

      <p style={{ fontSize: '13px', color: '#52525b' }}>Stats for the last 30 days</p>
    </div>
  );
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
