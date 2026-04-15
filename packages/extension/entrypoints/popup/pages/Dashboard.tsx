import { useState, useMemo, useRef, useEffect, type KeyboardEvent } from 'react';
import { useWalletStore } from '../store';
import {
  PROVIDERS,
  isGiftExpired,
  giftBudgetRemaining,
  giftBudgetPercent,
  type RequestLogEntry,
  type CredentialMeta,
} from '@byoky/core';
import { OfflineUpgradeBanner } from '../components/OfflineUpgradeBanner';

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

interface ProviderUsage {
  requests: number;
  inputTokens: number;
  outputTokens: number;
}

// Aggregate the last 7 days of successful requests per provider. Per-credential
// granularity isn't possible (request log only carries providerId, not a
// credentialId), so multiple credentials of the same provider share these
// numbers — acceptable for an at-a-glance card.
function computeUsageByProvider(log: RequestLogEntry[]): Map<string, ProviderUsage> {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const byProvider = new Map<string, ProviderUsage>();
  for (const entry of log) {
    if (entry.timestamp < cutoff) continue;
    if (entry.status >= 400) continue;
    const usage = byProvider.get(entry.providerId) ?? { requests: 0, inputTokens: 0, outputTokens: 0 };
    usage.requests++;
    usage.inputTokens += entry.inputTokens ?? 0;
    usage.outputTokens += entry.outputTokens ?? 0;
    byProvider.set(entry.providerId, usage);
  }
  return byProvider;
}

export function Dashboard() {
  const {
    credentials, giftedCredentials, giftPreferences, giftPeerOnline, requestLog,
    navigate, lock, removeCredential, removeGiftedCredential,
    setGiftPreference, cloudVaultEnabled, disableCloudVault,
  } = useWalletStore();
  const activeGifts = giftedCredentials.filter((gc) => !isGiftExpired(gc));
  const ownProviderIds = new Set(credentials.map((c) => c.providerId));
  const hasAny = credentials.length > 0 || activeGifts.length > 0;
  const usageByProvider = useMemo(() => computeUsageByProvider(requestLog), [requestLog]);

  const [expandedId, setExpandedId] = useState<string | null>(null);

  function toggleExpand(id: string) {
    setExpandedId((prev) => (prev === id ? null : id));
  }

  return (
    <div>
      <OfflineUpgradeBanner />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h2 className="page-title" style={{ marginBottom: 0 }}>Credentials</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '12px', color: cloudVaultEnabled ? 'var(--accent)' : 'var(--text-muted)' }}>Cloud Sync</span>
          <label className="toggle-switch" title={cloudVaultEnabled ? 'Cloud Sync on' : 'Cloud Sync off'}>
            <input
              type="checkbox"
              checked={cloudVaultEnabled}
              onChange={() => {
                if (cloudVaultEnabled) {
                  disableCloudVault();
                } else {
                  navigate('settings');
                }
              }}
            />
            <span className="toggle-slider" />
          </label>
          <button className="text-link" onClick={() => lock()}>
            Lock
          </button>
        </div>
      </div>

      {!hasAny ? (
        <div className="empty-state">
          <p>No API keys, tokens, or gifts yet.</p>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '8px' }}>
            Tap the + button to add a credential or redeem a gift.
          </p>
        </div>
      ) : (
        <>
          {credentials.map((cred) => (
            <CredentialCard
              key={cred.id}
              cred={cred}
              usage={usageByProvider.get(cred.providerId)}
              expanded={expandedId === cred.id}
              onToggle={() => toggleExpand(cred.id)}
              onRemove={() => removeCredential(cred.id)}
            />
          ))}

          {activeGifts.map((gc) => {
            const pct = giftBudgetPercent(gc);
            const remaining = giftBudgetRemaining(gc);
            const hasOwnKey = ownProviderIds.has(gc.providerId);
            const isPreferred = giftPreferences[gc.providerId] === gc.giftId;
            const onlineState = giftPeerOnline[gc.giftId];
            const dotClass = onlineState === true
              ? 'status-dot success'
              : onlineState === false
                ? 'status-dot error'
                : 'status-dot warning';
            const dotTitle = onlineState === true
              ? 'Sender online — gift can be used'
              : onlineState === false
                ? 'Sender offline — gift will fail until sender reconnects'
                : 'Checking sender status…';
            return (
              <div key={gc.id} className="card gift-card">
                <div className="card-header">
                  <span className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span className={dotClass} title={dotTitle} />
                    {gc.providerName}
                  </span>
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={() => removeGiftedCredential(gc.id)}
                  >
                    Remove
                  </button>
                </div>
                <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
                  <span className="badge badge-provider">
                    {PROVIDERS[gc.providerId]?.name ?? gc.providerId}
                  </span>
                  <span className="badge badge-gift">Gift · from {gc.senderLabel}</span>
                </div>
                <div className="gift-budget" style={{ marginTop: '8px' }}>
                  <div className="gift-budget-text">
                    <span>{formatTokens(remaining)} remaining</span>
                    <span className="gift-budget-total">/ {formatTokens(gc.maxTokens)}</span>
                  </div>
                  <div className="allowance-bar">
                    <div
                      className={`allowance-bar-fill ${pct >= 90 ? 'over' : ''}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
                {hasOwnKey && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px', cursor: 'pointer', fontSize: '12px', color: 'var(--text-secondary)' }}>
                    <input
                      type="checkbox"
                      checked={isPreferred}
                      onChange={() => setGiftPreference(gc.providerId, isPreferred ? null : gc.giftId)}
                      style={{ margin: 0 }}
                    />
                    Use instead of own key
                  </label>
                )}
                <div className="card-subtitle" style={{ marginTop: '6px' }}>
                  Expires in {formatExpiry(gc.expiresAt)}
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

interface CredentialCardProps {
  cred: CredentialMeta;
  usage: ProviderUsage | undefined;
  expanded: boolean;
  onToggle: () => void;
  onRemove: () => void;
}

function CredentialCard({ cred, usage, expanded, onToggle, onRemove }: CredentialCardProps) {
  const { renameCredential } = useWalletStore();
  const provider = PROVIDERS[cred.providerId];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(cred.label);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  useEffect(() => {
    if (!editing) setDraft(cred.label);
  }, [cred.label, editing]);

  async function commit() {
    const next = draft.trim();
    setEditing(false);
    if (!next || next === cred.label) {
      setDraft(cred.label);
      return;
    }
    const ok = await renameCredential(cred.id, next);
    if (!ok) setDraft(cred.label);
  }

  function cancel() {
    setEditing(false);
    setDraft(cred.label);
  }

  function handleKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    }
  }

  function startEdit(e: React.MouseEvent) {
    e.stopPropagation();
    setEditing(true);
  }

  return (
    <div
      className={`card credential-card ${expanded ? 'expanded' : ''}`}
      onClick={editing ? undefined : onToggle}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (editing) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggle();
        }
      }}
    >
      <div className="card-header">
        {editing ? (
          <input
            ref={inputRef}
            className="credential-label-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={handleKey}
            onClick={(e) => e.stopPropagation()}
            maxLength={60}
          />
        ) : (
          <span className="card-title">{cred.label}</span>
        )}
        <div className="card-actions" onClick={(e) => e.stopPropagation()}>
          <button
            className="icon-btn"
            onClick={startEdit}
            title="Rename"
            aria-label="Rename credential"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
            </svg>
          </button>
          <button
            className="btn btn-danger btn-sm"
            onClick={onRemove}
          >
            Remove
          </button>
        </div>
      </div>
      <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
        <span className="badge badge-provider">
          {provider?.name ?? cred.providerId}
        </span>
        <span className="badge badge-method">
          {cred.authMethod === 'oauth' ? 'Setup Token' : 'API Key'}
        </span>
      </div>
      <div className="card-subtitle" style={{ marginTop: '8px' }}>
        Added {new Date(cred.createdAt).toLocaleDateString()}
      </div>

      <div className={`credential-usage ${expanded ? 'open' : ''}`}>
        <div className="credential-usage-inner">
          {usage && usage.requests > 0 ? (
            <>
              <div className="usage-mini-label">Last 7 days</div>
              <div className="usage-mini-grid">
                <div>
                  <div className="usage-mini-value">{usage.requests}</div>
                  <div className="usage-mini-tag">requests</div>
                </div>
                <div>
                  <div className="usage-mini-value">{formatTokens(usage.inputTokens)}</div>
                  <div className="usage-mini-tag">input</div>
                </div>
                <div>
                  <div className="usage-mini-value">{formatTokens(usage.outputTokens)}</div>
                  <div className="usage-mini-tag">output</div>
                </div>
              </div>
            </>
          ) : (
            <div className="usage-mini-empty">No usage in the last 7 days.</div>
          )}
        </div>
      </div>
    </div>
  );
}
