import { useState } from 'react';
import { useWalletStore } from '../store';
import {
  PROVIDERS,
  createGiftLink,
  giftLinkToUrl,
  giftBudgetPercent,
  isGiftExpired,
  type Gift,
} from '@byoky/core';

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function formatExpiry(ms: number): string {
  const diff = ms - Date.now();
  if (diff <= 0) return 'Expired';
  const days = Math.floor(diff / (24 * 60 * 60 * 1000));
  const hours = Math.floor((diff % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  if (days > 0) return `${days}d ${hours}h`;
  return `${hours}h`;
}

function getGiftUrl(gift: Gift): string {
  const { encoded } = createGiftLink(gift);
  return giftLinkToUrl(encoded);
}

async function shareGift(gift: Gift) {
  const url = getGiftUrl(gift);
  const provider = PROVIDERS[gift.providerId];
  const text = `I'm sharing ${formatTokens(gift.maxTokens)} tokens of ${provider?.name ?? gift.providerId} with you via Byoky!`;

  if (navigator.share) {
    try {
      await navigator.share({ title: 'Byoky Gift', text, url });
      return true;
    } catch {
      // User cancelled or share failed — fall through to copy
    }
  }

  await navigator.clipboard.writeText(url);
  return false;
}

export function Gifts() {
  const { gifts, giftedCredentials, navigate, revokeGift, removeGiftedCredential } =
    useWalletStore();
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const activeGifts = gifts.filter((g) => g.active && !isGiftExpired(g));
  const expiredGifts = gifts.filter((g) => !g.active || isGiftExpired(g));
  // Active received gifts are shown on the Dashboard alongside credentials.
  // Only expired/revoked received gifts stay here so the user can prune them.
  const expiredReceived = giftedCredentials.filter((gc) => isGiftExpired(gc));

  async function handleShare(gift: Gift) {
    const shared = await shareGift(gift);
    if (!shared) {
      setCopiedId(gift.id);
      setTimeout(() => setCopiedId(null), 2000);
    }
  }

  async function handleCopy(gift: Gift) {
    await navigator.clipboard.writeText(getGiftUrl(gift));
    setCopiedId(gift.id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  return (
    <div>
      <h2 className="page-title">Gifts</h2>
      <p className="page-subtitle">
        Share token access without sharing your API key.
      </p>

      <div className="gift-actions">
        <button className="btn btn-primary" onClick={() => navigate('create-gift')}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 12v10H4V12" />
            <path d="M2 7h20v5H2z" />
            <path d="M12 22V7" />
            <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" />
            <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" />
          </svg>
          Create Gift
        </button>
        <button className="btn btn-secondary" onClick={() => navigate('redeem-gift')}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          Redeem Gift
        </button>
      </div>

      {activeGifts.length === 0 && expiredGifts.length === 0 && expiredReceived.length === 0 && (
        <div className="empty-state" style={{ marginTop: '16px' }}>
          <p>No gifts yet. Create one to share token access with someone.</p>
        </div>
      )}

      {/* Sent gifts */}
      {activeGifts.length > 0 && (
        <>
          <div className="gift-section-label">Sent</div>
          {activeGifts.map((g) => {
            const pct = giftBudgetPercent(g);
            const provider = PROVIDERS[g.providerId];
            return (
              <div key={g.id} className="card gift-card-sent">
                <div className="card-header">
                  <div>
                    <span className="card-title">{g.label}</span>
                    <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                      <span className="badge badge-gift-sent">Sent</span>
                      <span className="badge badge-provider">
                        {provider?.name ?? g.providerId}
                      </span>
                    </div>
                  </div>
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={() => revokeGift(g.id)}
                  >
                    Revoke
                  </button>
                </div>
                <div className="gift-budget">
                  <div className="gift-budget-text">
                    <span>{formatTokens(g.usedTokens)} used</span>
                    <span className="gift-budget-total">/ {formatTokens(g.maxTokens)}</span>
                  </div>
                  <div className="allowance-bar">
                    <div
                      className={`allowance-bar-fill ${pct >= 90 ? 'over' : ''}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px' }}>
                  <span className="card-subtitle">
                    Expires in {formatExpiry(g.expiresAt)}
                  </span>
                  <div className="gift-share-btns">
                    <button
                      className="btn btn-sm btn-ghost"
                      onClick={() => handleCopy(g)}
                      title="Copy link"
                    >
                      {copiedId === g.id ? 'Copied!' : 'Copy'}
                    </button>
                    <button
                      className="btn btn-sm btn-ghost"
                      onClick={() => handleShare(g)}
                      title="Share gift"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="18" cy="5" r="3" />
                        <circle cx="6" cy="12" r="3" />
                        <circle cx="18" cy="19" r="3" />
                        <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                        <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                      </svg>
                      Share
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </>
      )}

      {/* Expired / revoked */}
      {(expiredGifts.length > 0 || expiredReceived.length > 0) && (
        <>
          <div className="gift-section-label" style={{ color: 'var(--text-muted)', opacity: 0.7 }}>
            Expired / Revoked
          </div>
          {expiredGifts.map((g) => {
            const provider = PROVIDERS[g.providerId];
            return (
              <div key={g.id} className="card gift-card-expired">
                <div className="card-header">
                  <div>
                    <span className="card-title" style={{ opacity: 0.5 }}>{g.label}</span>
                    <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                      <span className="badge" style={{ opacity: 0.5 }}>
                        {g.active ? 'Expired' : 'Revoked'}
                      </span>
                      <span className="badge badge-provider" style={{ opacity: 0.5 }}>
                        {provider?.name ?? g.providerId}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          {expiredReceived.map((gc) => (
            <div key={gc.id} className="card gift-card-expired">
              <div className="card-header">
                <div>
                  <span className="card-title" style={{ opacity: 0.5 }}>{gc.providerName}</span>
                  <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                    <span className="badge" style={{ opacity: 0.5 }}>Expired</span>
                    <span className="badge badge-provider" style={{ opacity: 0.5 }}>
                      from {gc.senderLabel}
                    </span>
                  </div>
                </div>
                <button
                  className="btn btn-danger btn-sm"
                  onClick={() => removeGiftedCredential(gc.id)}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
