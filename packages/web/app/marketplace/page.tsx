'use client';

import { useState, useEffect, useCallback } from 'react';

const MARKETPLACE_API = process.env.NEXT_PUBLIC_MARKETPLACE_URL ?? 'https://marketplace.byoky.com';

interface Gift {
  id: string;
  providerId: string;
  gifterName: string;
  relayUrl: string;
  tokenBudget: number;
  tokensUsed: number;
  tokensRemaining: number;
  expiresAt: number;
  listedAt: number;
  lastSeenAt: number;
  online: boolean;
}

function timeUntil(ts: number): string {
  const diff = ts - Date.now();
  if (diff <= 0) return 'Expired';
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 1) return `${Math.ceil(diff / 60_000)}m left`;
  if (hours < 24) return `${hours}h left`;
  return `${Math.floor(hours / 24)}d left`;
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

export default function Marketplace() {
  const [active, setActive] = useState<Gift[]>([]);
  const [expired, setExpired] = useState<Gift[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [redeeming, setRedeeming] = useState<string | null>(null);
  const [redeemLink, setRedeemLink] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${MARKETPLACE_API}/gifts`);
      if (!res.ok) throw new Error('Failed to load gifts');
      const data = await res.json();
      setActive(data.active ?? []);
      setExpired(data.expired ?? []);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 30_000);
    return () => clearInterval(interval);
  }, [load]);

  async function handleRedeem(id: string) {
    setRedeeming(id);
    try {
      const res = await fetch(`${MARKETPLACE_API}/gifts/${id}/redeem`);
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || 'Failed to redeem');
        return;
      }
      const data = await res.json();
      setRedeemLink(data.giftLink);
    } finally {
      setRedeeming(null);
    }
  }

  return (
    <div className="container" style={{ paddingTop: 120, paddingBottom: 80, maxWidth: 800 }}>
      <h1 style={{ fontSize: 32, marginBottom: 8 }}>Token Marketplace</h1>
      <p style={{ color: 'var(--text-secondary)', marginBottom: 32, fontSize: 15 }}>
        Free community token gifts. Redeem and use them with your Byoky wallet.
      </p>

      {redeemLink && (
        <div style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--teal)',
          borderRadius: 12,
          padding: 20,
          marginBottom: 24,
        }}>
          <p style={{ fontWeight: 600, marginBottom: 8 }}>Gift link ready!</p>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
            Open your Byoky wallet &rarr; Gifts &rarr; Redeem Gift &rarr; paste this link:
          </p>
          <code style={{
            display: 'block',
            background: 'var(--bg-elevated)',
            padding: '10px 14px',
            borderRadius: 8,
            fontSize: 12,
            wordBreak: 'break-all',
            color: 'var(--teal-light)',
          }}>
            {redeemLink}
          </code>
          <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
            <button
              onClick={() => { navigator.clipboard.writeText(redeemLink); }}
              style={btnStyle}
            >
              Copy
            </button>
            <button onClick={() => setRedeemLink(null)} style={{ ...btnStyle, background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
              Close
            </button>
          </div>
        </div>
      )}

      {loading && <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 40 }}>Loading...</p>}
      {error && <p style={{ color: '#f43f5e', textAlign: 'center', padding: 40 }}>{error}</p>}

      {!loading && !error && active.length === 0 && expired.length === 0 && (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)' }}>
          <p style={{ fontSize: 18, marginBottom: 8 }}>No gifts listed yet</p>
          <p style={{ fontSize: 14 }}>Be the first to share tokens with the community!</p>
        </div>
      )}

      {active.length > 0 && (
        <>
          <h2 style={{ fontSize: 18, marginBottom: 16 }}>Available ({active.length})</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 40 }}>
            {active.map((gift) => (
              <GiftCard key={gift.id} gift={gift} onRedeem={handleRedeem} redeeming={redeeming === gift.id} />
            ))}
          </div>
        </>
      )}

      {expired.length > 0 && (
        <>
          <h2 style={{ fontSize: 18, marginBottom: 16, color: 'var(--text-muted)' }}>Recently Expired</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, opacity: 0.5 }}>
            {expired.map((gift) => (
              <GiftCard key={gift.id} gift={gift} expired />
            ))}
          </div>
        </>
      )}

      <style>{`
        .gift-card { transition: border-color 0.15s; }
        .gift-card:hover { border-color: var(--border-hover, #2a2a50) !important; }
      `}</style>
    </div>
  );
}

function GiftCard({ gift, expired, onRedeem, redeeming }: {
  gift: Gift;
  expired?: boolean;
  onRedeem?: (id: string) => void;
  redeeming?: boolean;
}) {
  const pct = gift.tokenBudget > 0 ? ((gift.tokenBudget - gift.tokensUsed) / gift.tokenBudget) * 100 : 0;

  return (
    <div className="gift-card" style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      padding: 16,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{
              display: 'inline-block',
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: expired ? '#55555f' : gift.online ? '#34d399' : '#f43f5e',
              flexShrink: 0,
            }} />
            <span style={{ fontWeight: 600, fontSize: 15 }}>{gift.providerId}</span>
            <span style={{
              fontSize: 11,
              padding: '2px 8px',
              borderRadius: 10,
              background: expired ? 'rgba(85,85,95,0.2)' : gift.online ? 'rgba(52,211,153,0.12)' : 'rgba(244,63,94,0.1)',
              color: expired ? '#55555f' : gift.online ? '#34d399' : '#f43f5e',
              fontWeight: 600,
            }}>
              {expired ? 'Expired' : gift.online ? 'Online' : 'Offline'}
            </span>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              by {gift.gifterName}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 13, color: 'var(--text-secondary)' }}>
            <span>{formatTokens(gift.tokensRemaining)} / {formatTokens(gift.tokenBudget)} tokens</span>
            <span>{timeUntil(gift.expiresAt)}</span>
            <span>Listed {timeAgo(gift.listedAt)}</span>
          </div>

          <div style={{
            marginTop: 8,
            height: 4,
            borderRadius: 2,
            background: 'var(--bg-elevated)',
            overflow: 'hidden',
          }}>
            <div style={{
              height: '100%',
              width: `${pct}%`,
              borderRadius: 2,
              background: expired ? '#55555f' : pct > 20 ? '#0ea5e9' : '#f43f5e',
              transition: 'width 0.3s',
            }} />
          </div>
        </div>

        {!expired && onRedeem && (
          <button
            onClick={() => onRedeem(gift.id)}
            disabled={redeeming || !gift.online}
            style={{
              ...btnStyle,
              opacity: !gift.online ? 0.4 : 1,
              cursor: !gift.online ? 'not-allowed' : 'pointer',
            }}
          >
            {redeeming ? '...' : 'Redeem'}
          </button>
        )}
      </div>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  padding: '8px 16px',
  background: '#0ea5e9',
  color: '#fff',
  border: 'none',
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};
