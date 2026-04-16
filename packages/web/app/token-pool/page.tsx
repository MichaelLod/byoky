'use client';

import { useState, useEffect, useCallback } from 'react';
import { isExtensionInstalled, encodeQr, qrToSvg } from '@byoky/sdk';

const MARKETPLACE_API = process.env.NEXT_PUBLIC_MARKETPLACE_URL ?? 'https://marketplace.byoky.com';

const CHROME_STORE = 'https://chromewebstore.google.com/detail/byoky/igjohldpldlahcjmefdhlnbcpldlgmon';
const FIREFOX_STORE = 'https://addons.mozilla.org/en-US/firefox/addon/byoky/';
const IOS_STORE = 'https://apps.apple.com/app/byoky/id6760779919';

function extensionStoreUrl(): string {
  if (typeof navigator === 'undefined') return CHROME_STORE;
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('firefox')) return FIREFOX_STORE;
  if (ua.includes('safari') && !ua.includes('chrome')) return IOS_STORE;
  return CHROME_STORE;
}

function stageGiftInExtension(giftLink: string): Promise<boolean> {
  if (typeof window === 'undefined' || !isExtensionInstalled()) return Promise.resolve(false);
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timeout = setTimeout(() => {
      channel.port1.onmessage = null;
      resolve(false);
    }, 3000);
    channel.port1.onmessage = (event) => {
      clearTimeout(timeout);
      const payload = (event.data as { payload?: { ok?: boolean } } | undefined)?.payload;
      resolve(payload?.ok === true);
    };
    window.postMessage(
      {
        type: 'BYOKY_STAGE_GIFT',
        requestId:
          typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? crypto.randomUUID()
            : String(Math.random()),
        giftLink,
      },
      window.location.origin,
      [channel.port2],
    );
  });
}

type RedeemResult =
  | { status: 'sent-to-extension'; giftLink: string }
  | { status: 'show-qr'; giftLink: string };

const PROVIDER_ICONS: Record<string, string> = {
  anthropic: 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/claude.svg',
  openai: 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/openai.svg',
  gemini: 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/gemini.svg',
  google: 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/gemini.svg',
  mistral: 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/mistral.svg',
  xai: 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/grok.svg',
  grok: 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/grok.svg',
  deepseek: 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/deepseek.svg',
  cohere: 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/cohere.svg',
  groq: 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/groq.svg',
  perplexity: 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/perplexity.svg',
  together: 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/together.svg',
  fireworks: 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/fireworks.svg',
  openrouter: 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/openrouter.svg',
  azure: 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/azureai.svg',
  ollama: 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/ollama.svg',
  bedrock: 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/bedrock.svg',
  lmstudio: 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/lmstudio.svg',
  vertexai: 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/vertexai.svg',
  'hugging-face': 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/huggingface.svg',
  huggingface: 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/huggingface.svg',
  replicate: 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/replicate.svg',
};

function ProviderLogo({ providerId, size = 28 }: { providerId: string; size?: number }) {
  const key = providerId.toLowerCase().replace(/[\s_]/g, '-');
  const icon = PROVIDER_ICONS[key] || PROVIDER_ICONS[key.split('-')[0]];
  if (!icon) {
    return (
      <span style={{
        width: size, height: size, borderRadius: 8,
        background: 'var(--bg-elevated)', display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        fontSize: size * 0.45, fontWeight: 700, color: 'var(--text-muted)', flexShrink: 0,
      }}>
        {providerId.charAt(0).toUpperCase()}
      </span>
    );
  }
  return <img src={icon} alt={providerId} width={size} height={size} style={{ flexShrink: 0 }} />;
}

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
  unlisted?: boolean;
}

function timeUntil(ts: number): string {
  const diff = ts - Date.now();
  if (diff <= 0) return 'Expired';
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 1) return `${Math.ceil(diff / 60_000)}m left`;
  if (hours < 24) return `${hours}h left`;
  return `${Math.floor(hours / 24)}d left`;
}

type GiftStatus = 'online' | 'unavailable' | 'removed' | 'expired';

function deriveGiftStatus(gift: Gift, variant: 'active' | 'expired' | 'removed'): GiftStatus {
  if (variant === 'removed' || gift.unlisted) return 'removed';
  if (variant === 'expired') return 'expired';
  return gift.online ? 'online' : 'unavailable';
}

const STATUS_STYLES: Record<GiftStatus, { bg: string; color: string; label: string }> = {
  online: { bg: 'rgba(52,211,153,0.12)', color: '#34d399', label: 'Online' },
  unavailable: { bg: 'rgba(244,63,94,0.1)', color: '#f43f5e', label: 'Unavailable' },
  removed: { bg: 'rgba(85,85,95,0.15)', color: '#6b7280', label: 'Removed' },
  expired: { bg: 'rgba(85,85,95,0.15)', color: '#999', label: 'Expired' },
};

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

/* ── Mock data for local dev ── */
const MOCK_GIFTS: Gift[] = [
  { id: '1', providerId: 'anthropic', gifterName: 'Marino', relayUrl: '', tokenBudget: 500000, tokensUsed: 120000, tokensRemaining: 380000, expiresAt: Date.now() + 86400000 * 3, listedAt: Date.now() - 3600000, lastSeenAt: Date.now(), online: true },
  { id: '2', providerId: 'openai', gifterName: 'Michael', relayUrl: '', tokenBudget: 1000000, tokensUsed: 250000, tokensRemaining: 750000, expiresAt: Date.now() + 86400000 * 7, listedAt: Date.now() - 7200000, lastSeenAt: Date.now(), online: true },
  { id: '3', providerId: 'gemini', gifterName: 'Alex', relayUrl: '', tokenBudget: 200000, tokensUsed: 50000, tokensRemaining: 150000, expiresAt: Date.now() + 86400000 * 2, listedAt: Date.now() - 1800000, lastSeenAt: Date.now() - 300000, online: true },
  { id: '4', providerId: 'mistral', gifterName: 'Nikita', relayUrl: '', tokenBudget: 300000, tokensUsed: 280000, tokensRemaining: 20000, expiresAt: Date.now() + 86400000, listedAt: Date.now() - 14400000, lastSeenAt: Date.now() - 600000, online: false },
  { id: '5', providerId: 'groq', gifterName: 'Sarah', relayUrl: '', tokenBudget: 800000, tokensUsed: 100000, tokensRemaining: 700000, expiresAt: Date.now() + 86400000 * 5, listedAt: Date.now() - 900000, lastSeenAt: Date.now(), online: true },
  { id: '6', providerId: 'deepseek', gifterName: 'James', relayUrl: '', tokenBudget: 400000, tokensUsed: 390000, tokensRemaining: 10000, expiresAt: Date.now() - 3600000, listedAt: Date.now() - 86400000, lastSeenAt: Date.now() - 86400000, online: false },
];

export default function Marketplace() {
  const [active, setActive] = useState<Gift[]>([]);
  const [expired, setExpired] = useState<Gift[]>([]);
  const [removed, setRemoved] = useState<Gift[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [redeeming, setRedeeming] = useState<string | null>(null);
  const [redeemResult, setRedeemResult] = useState<RedeemResult | null>(null);
  const [hasExtension, setHasExtension] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setHasExtension(isExtensionInstalled());
    const t = setTimeout(() => setHasExtension(isExtensionInstalled()), 500);
    return () => clearTimeout(t);
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${MARKETPLACE_API}/gifts`);
      if (!res.ok) throw new Error('Failed to load gifts');
      const data = await res.json();
      const a = data.active ?? [];
      const e = data.expired ?? [];
      const r = data.removed ?? [];
      // Fall back to mock data if API returns empty (local dev)
      if (a.length === 0 && e.length === 0 && r.length === 0) {
        setActive(MOCK_GIFTS.filter(g => g.expiresAt > Date.now()));
        setExpired(MOCK_GIFTS.filter(g => g.expiresAt <= Date.now()));
        setRemoved([]);
      } else {
        setActive(a);
        setExpired(e);
        setRemoved(r);
      }
      setError(null);
    } catch {
      // API unreachable — use mock data
      setActive(MOCK_GIFTS.filter(g => g.expiresAt > Date.now()));
      setExpired(MOCK_GIFTS.filter(g => g.expiresAt <= Date.now()));
      setRemoved([]);
      setError(null);
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
    setCopied(false);
    try {
      const res = await fetch(`${MARKETPLACE_API}/gifts/${id}/redeem`);
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || 'Failed to redeem');
        return;
      }
      const data = await res.json();
      const giftLink = data.giftLink as string;

      if (hasExtension) {
        const ok = await stageGiftInExtension(giftLink);
        setRedeemResult({ status: ok ? 'sent-to-extension' : 'show-qr', giftLink });
      } else {
        setRedeemResult({ status: 'show-qr', giftLink });
      }
    } finally {
      setRedeeming(null);
    }
  }

  async function copyGiftLink(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard may be blocked; user can select text manually */
    }
  }

  const totalTokens = active.reduce((sum, g) => sum + g.tokensRemaining, 0);
  const uniqueProviders = new Set(active.map(g => g.providerId)).size;
  const onlineCount = active.filter(g => g.online).length;

  return (
    <div className="mp-container">
      {/* ── Hero ── */}
      <div className="mp-hero">
        <div className="mp-hero-icon">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#FF4F00" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 12v10H4V12" /><path d="M2 7h20v5H2z" /><path d="M12 22V7" />
            <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" />
            <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" />
          </svg>
        </div>
        <h1>Token Pool</h1>
        <p className="mp-hero-sub">Free AI tokens from the community. Grab what you need, give back when you can.</p>

        {/* ── Stats ── */}
        <div className="mp-stats">
          <div className="mp-stat">
            <span className="mp-stat-value">{formatTokens(totalTokens)}</span>
            <span className="mp-stat-label">Tokens available</span>
          </div>
          <div className="mp-stat">
            <span className="mp-stat-value">{onlineCount}</span>
            <span className="mp-stat-label">Gifts online</span>
          </div>
          <div className="mp-stat">
            <span className="mp-stat-value">{uniqueProviders}</span>
            <span className="mp-stat-label">Providers</span>
          </div>
        </div>
      </div>

      {/* ── Redeem result modal ── */}
      {redeemResult && (
        <RedeemModal
          result={redeemResult}
          copied={copied}
          onCopy={() => copyGiftLink(redeemResult.giftLink)}
          onClose={() => setRedeemResult(null)}
        />
      )}

      {loading && <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 40 }}>Loading...</p>}

      {/* ── Active gifts ── */}
      {!loading && active.length > 0 && (
        <div className="mp-section">
          <h2 className="mp-section-title">
            <span className="mp-section-dot mp-dot-green" />
            Available now <span style={{ color: '#FF4F00', fontWeight: 800 }}>{active.length}</span>
          </h2>
          <div className="mp-grid">
            {active.map((gift) => (
              <GiftCard key={gift.id} gift={gift} onRedeem={handleRedeem} redeeming={redeeming === gift.id} />
            ))}
          </div>
        </div>
      )}

      {/* ── No longer available (expired + removed) ── */}
      {!loading && (expired.length > 0 || removed.length > 0) && (
        <div className="mp-section" style={{ opacity: 0.5 }}>
          <h2 className="mp-section-title" style={{ color: 'var(--text-muted)' }}>
            <span className="mp-section-dot" style={{ background: '#999' }} />
            No longer available
          </h2>
          <div className="mp-grid">
            {removed.map((gift) => (
              <GiftCard key={gift.id} gift={gift} variant="removed" />
            ))}
            {expired.map((gift) => (
              <GiftCard key={gift.id} gift={gift} variant="expired" />
            ))}
          </div>
        </div>
      )}

      {/* ── Empty state ── */}
      {!loading && active.length === 0 && expired.length === 0 && removed.length === 0 && (
        <div className="mp-empty">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}>
            <path d="M20 12v10H4V12" /><path d="M2 7h20v5H2z" /><path d="M12 22V7" />
            <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" />
            <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" />
          </svg>
          <p style={{ fontSize: 18, marginBottom: 4, marginTop: 16 }}>No gifts listed yet</p>
          <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>Be the first to share tokens with the community!</p>
        </div>
      )}

      <style>{`
        .mp-container {
          max-width: 860px;
          margin: 0 auto;
          padding: 120px 24px 80px;
        }

        /* ── Hero ── */
        .mp-hero {
          text-align: center;
          margin-bottom: 32px;
        }
        .mp-hero-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 48px;
          height: 48px;
          border-radius: 12px;
          background: rgba(255, 79, 0, 0.08);
          border: 1px solid rgba(255, 79, 0, 0.15);
          margin-bottom: 14px;
        }
        .mp-hero-icon svg { width: 24px; height: 24px; }
        .mp-hero h1 {
          font-size: 28px;
          font-weight: 800;
          letter-spacing: -0.02em;
          margin: 0 0 6px;
        }
        .mp-hero-sub {
          font-size: 14px;
          color: var(--text-secondary);
          margin: 0 0 20px;
          max-width: 480px;
          margin-left: auto;
          margin-right: auto;
        }

        /* ── Stats ── */
        .mp-stats {
          display: flex;
          justify-content: center;
          gap: 16px;
        }
        .mp-stat {
          background: var(--bg-card, #fff);
          border: 1px solid var(--border, #e5e5e5);
          border-radius: 12px;
          padding: 14px 24px;
          text-align: center;
          min-width: 120px;
        }
        .mp-stat-value {
          display: block;
          font-size: 22px;
          font-weight: 800;
          letter-spacing: -0.02em;
          color: #FF4F00;
        }
        .mp-stat-label {
          display: block;
          font-size: 12px;
          font-weight: 600;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin-top: 4px;
        }

        /* ── Section titles ── */
        .mp-section { margin-bottom: 40px; }
        .mp-section-title {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 16px;
          font-weight: 700;
          margin-bottom: 16px;
        }
        .mp-section-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .mp-dot-green { background: #34d399; box-shadow: 0 0 8px rgba(52, 211, 153, 0.4); }

        /* ── Grid ── */
        .mp-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 14px;
        }

        /* ── Gift Card ── */
        .mp-card {
          background: var(--bg-card, #fff);
          border: 1px solid var(--border, #e5e5e5);
          border-radius: 16px;
          padding: 20px;
          transition: all 0.2s;
          position: relative;
          overflow: hidden;
        }
        .mp-card:hover {
          border-color: rgba(255, 79, 0, 0.3);
          box-shadow: 0 4px 20px rgba(255, 79, 0, 0.06);
          transform: translateY(-1px);
        }
        .mp-card-header {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 14px;
        }
        .mp-card-provider-icon {
          width: 44px;
          height: 44px;
          border-radius: 12px;
          background: var(--bg-elevated, #f5f5f4);
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .mp-card-info { flex: 1; min-width: 0; }
        .mp-card-provider {
          font-size: 16px;
          font-weight: 700;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .mp-card-status {
          font-size: 10px;
          padding: 2px 8px;
          border-radius: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.03em;
        }
        .mp-card-gifter {
          font-size: 13px;
          color: var(--text-muted);
          margin-top: 2px;
        }
        .mp-card-tokens {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          margin-bottom: 8px;
        }
        .mp-card-remaining {
          font-size: 22px;
          font-weight: 800;
          letter-spacing: -0.02em;
        }
        .mp-card-budget {
          font-size: 13px;
          color: var(--text-muted);
        }
        .mp-card-bar {
          height: 6px;
          border-radius: 3px;
          background: var(--bg-elevated, #f5f5f4);
          overflow: hidden;
          margin-bottom: 14px;
        }
        .mp-card-bar-fill {
          height: 100%;
          border-radius: 3px;
          transition: width 0.3s;
        }
        .mp-card-meta {
          display: flex;
          justify-content: space-between;
          font-size: 12px;
          color: var(--text-muted);
        }

        /* ── Buttons ── */
        .mp-btn {
          padding: 10px 20px;
          background: #FF4F00;
          color: #fff;
          border: none;
          border-radius: 10px;
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.2s;
        }
        .mp-btn:hover { background: #e64500; transform: translateY(-1px); }
        .mp-btn:disabled { opacity: 0.4; cursor: not-allowed; transform: none; }
        .mp-btn-muted { background: var(--bg-elevated, #f5f5f4); color: var(--text-secondary); }
        .mp-btn-muted:hover { background: var(--bg-elevated, #e5e5e5); }
        .mp-btn-secondary {
          background: var(--bg-elevated, #f5f5f4);
          color: var(--text, #1a1a1a);
          text-decoration: none;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        .mp-btn-secondary:hover { background: var(--border, #e5e5e5); transform: translateY(-1px); }
        .mp-btn-full {
          width: 100%;
          padding: 12px;
          font-size: 14px;
        }

        /* ── Redeem modal ── */
        .mp-modal-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(20, 20, 22, 0.55);
          backdrop-filter: blur(4px);
          -webkit-backdrop-filter: blur(4px);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
          z-index: 1000;
          animation: mp-fade-in 0.18s ease-out;
        }
        .mp-modal {
          background: var(--bg-card, #fff);
          border: 1px solid var(--border, #e5e5e5);
          border-radius: 18px;
          padding: 28px 24px 22px;
          max-width: 380px;
          width: 100%;
          text-align: center;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.18);
          animation: mp-modal-in 0.22s cubic-bezier(0.16, 1, 0.3, 1);
        }
        @keyframes mp-fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes mp-modal-in {
          from { opacity: 0; transform: translateY(8px) scale(0.98); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        .mp-modal-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 52px;
          height: 52px;
          border-radius: 14px;
          background: rgba(255, 79, 0, 0.08);
          border: 1px solid rgba(255, 79, 0, 0.18);
          margin-bottom: 12px;
        }
        .mp-modal h3 {
          font-size: 18px;
          font-weight: 800;
          letter-spacing: -0.01em;
          margin: 0 0 6px;
        }
        .mp-modal p {
          font-size: 13px;
          color: var(--text-secondary);
          margin: 0 0 18px;
          line-height: 1.5;
        }
        .mp-qr-wrap {
          background: #fff;
          border: 1px solid var(--border, #e5e5e5);
          border-radius: 12px;
          padding: 12px;
          display: inline-flex;
          margin-bottom: 18px;
        }
        .mp-qr-wrap svg { display: block; }
        .mp-modal-actions {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .mp-link-btn {
          background: transparent;
          border: none;
          color: var(--text-muted);
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          padding: 6px 10px;
          border-radius: 6px;
          text-decoration: underline;
          text-underline-offset: 3px;
          transition: color 0.15s;
        }
        .mp-link-btn:hover { color: #FF4F00; }

        /* ── Empty state ── */
        .mp-empty {
          text-align: center;
          padding: 80px 24px;
          color: var(--text-secondary);
        }

        @media (max-width: 640px) {
          .mp-stats { flex-direction: column; gap: 10px; }
          .mp-stat { min-width: auto; padding: 16px 20px; }
          .mp-grid { grid-template-columns: 1fr; }
          .mp-hero h1 { font-size: 28px; }
        }
      `}</style>
    </div>
  );
}

function GiftCard({ gift, variant = 'active', onRedeem, redeeming }: {
  gift: Gift;
  variant?: 'active' | 'expired' | 'removed';
  onRedeem?: (id: string) => void;
  redeeming?: boolean;
}) {
  const status = deriveGiftStatus(gift, variant);
  const pct = gift.tokenBudget > 0 ? ((gift.tokenBudget - gift.tokensUsed) / gift.tokenBudget) * 100 : 0;
  const barColor = status !== 'online' && status !== 'unavailable' ? '#999' : pct > 20 ? '#FF4F00' : '#f43f5e';
  const { bg: statusBg, color: statusColor, label: statusText } = STATUS_STYLES[status];
  const expired = variant === 'expired' || variant === 'removed';

  return (
    <div className="mp-card">
      <div className="mp-card-header">
        <div className="mp-card-provider-icon">
          <ProviderLogo providerId={gift.providerId} size={28} />
        </div>
        <div className="mp-card-info">
          <div className="mp-card-provider">
            {gift.providerId}
            <span className="mp-card-status" style={{ background: statusBg, color: statusColor }}>
              {statusText}
            </span>
          </div>
          <div className="mp-card-gifter">
            Gifted by {gift.gifterName}
          </div>
        </div>
      </div>

      <div className="mp-card-tokens">
        <span className="mp-card-remaining">{formatTokens(gift.tokensRemaining)}</span>
        <span className="mp-card-budget">of {formatTokens(gift.tokenBudget)} tokens</span>
      </div>

      <div className="mp-card-bar">
        <div className="mp-card-bar-fill" style={{ width: `${pct}%`, background: barColor }} />
      </div>

      <div className="mp-card-meta">
        <span>{timeUntil(gift.expiresAt)}</span>
      </div>

      {!expired && onRedeem && (
        <button
          className="mp-btn mp-btn-full"
          onClick={() => onRedeem(gift.id)}
          disabled={redeeming || !gift.online}
          style={{ marginTop: 14 }}
        >
          {redeeming ? 'Getting tokens...' : 'Get Free Tokens'}
        </button>
      )}
    </div>
  );
}

function RedeemModal({
  result,
  copied,
  onCopy,
  onClose,
}: {
  result: RedeemResult;
  copied: boolean;
  onCopy: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="mp-modal-backdrop" onMouseDown={onClose}>
      <div className="mp-modal" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        {result.status === 'sent-to-extension' ? (
          <>
            <div className="mp-modal-icon">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#FF4F00" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </div>
            <h3>Sent to your wallet</h3>
            <p>
              Open your Byoky extension (toolbar icon) to review and accept the gift.
              You&apos;ll see the sender, provider, token budget, and expiry before anything is added.
            </p>
          </>
        ) : (
          <>
            <div className="mp-modal-icon">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#FF4F00" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
                <path d="M14 14h3v3h-3zM20 14h1M14 20h1M17 17h4v4h-4z" />
              </svg>
            </div>
            <h3>Scan with Byoky mobile</h3>
            <p>
              Scan with your phone to receive the gift. No app yet? The page
              will redirect you to the App Store or Play Store.
            </p>
            <div className="mp-qr-wrap">
              <span
                aria-label="Gift QR code"
                dangerouslySetInnerHTML={{
                  __html: qrToSvg(encodeQr(result.giftLink), {
                    size: 220,
                    margin: 2,
                    darkColor: '#1a1a1a',
                    lightColor: '#fff',
                  }),
                }}
              />
            </div>
          </>
        )}

        <div className="mp-modal-actions">
          <button className="mp-btn mp-btn-full" onClick={onClose}>Done</button>
          {result.status === 'show-qr' && (
            <a
              className="mp-btn mp-btn-full mp-btn-secondary"
              href={extensionStoreUrl()}
              target="_blank"
              rel="noopener noreferrer"
            >
              Install the Byoky extension
            </a>
          )}
          <button className="mp-link-btn" onClick={onCopy}>
            {copied ? 'Link copied' : 'Copy gift link instead'}
          </button>
        </div>
      </div>
    </div>
  );
}
