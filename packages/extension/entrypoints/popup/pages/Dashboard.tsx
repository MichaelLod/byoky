import { useState, useMemo, useRef, useEffect, type KeyboardEvent } from 'react';
import { useWalletStore } from '../store';
import {
  PROVIDERS,
  isGiftExpired,
  giftBudgetRemaining,
  giftBudgetPercent,
  type RequestLogEntry,
  type CredentialMeta,
  type Gift,
  type GiftedCredential,
} from '@byoky/core';
import { OfflineUpgradeBanner } from '../components/OfflineUpgradeBanner';
import { ProviderIcon } from '../components/ProviderIcon';

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

function formatHostname(origin: string): string {
  try {
    return new URL(origin).hostname;
  } catch {
    return origin;
  }
}

interface ProviderUsage {
  requests: number;
  inputTokens: number;
  outputTokens: number;
}

// Aggregate last 7 days of successful requests per provider. Per-credential
// granularity isn't possible (request log carries providerId only), so
// multiple credentials of the same provider share these numbers.
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

type StatsTarget =
  | { kind: 'credential'; credentialId: string }
  | { kind: 'gift'; giftedId: string };

export function Dashboard() {
  const {
    credentials, gifts, giftedCredentials, giftPreferences, giftPeerOnline, requestLog,
    navigate, lock, removeCredential, removeGiftedCredential,
    setGiftPreference, cloudVaultEnabled, disableCloudVault,
  } = useWalletStore();
  const activeGifts = giftedCredentials.filter((gc) => !isGiftExpired(gc));
  const ownProviderIds = new Set(credentials.map((c) => c.providerId));
  const hasAny = credentials.length > 0 || activeGifts.length > 0;
  const usageByProvider = useMemo(() => computeUsageByProvider(requestLog), [requestLog]);
  const giftedByCredential = useMemo(() => {
    const map = new Map<string, { count: number; used: number }>();
    for (const g of gifts) {
      const entry = map.get(g.credentialId) ?? { count: 0, used: 0 };
      entry.count++;
      entry.used += g.usedTokens;
      map.set(g.credentialId, entry);
    }
    return map;
  }, [gifts]);

  const [stats, setStats] = useState<StatsTarget | null>(null);

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
                  if (confirm('Turn off Cloud Sync? Your keys stay on this device and remain on the server under your account — sign back in anytime to restore sync.')) {
                    disableCloudVault();
                  }
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
              gifted={giftedByCredential.get(cred.id)}
              onOpenStats={() => setStats({ kind: 'credential', credentialId: cred.id })}
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
              <div
                key={gc.id}
                className="card gift-card tappable"
                role="button"
                tabIndex={0}
                onClick={() => setStats({ kind: 'gift', giftedId: gc.id })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setStats({ kind: 'gift', giftedId: gc.id });
                  }
                }}
              >
                <div className="card-header">
                  <div className="credential-card-heading">
                    <div className="provider-icon-box provider-icon-box-sm">
                      <ProviderIcon providerId={gc.providerId} size={18} />
                    </div>
                    <span className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span className={dotClass} title={dotTitle} />
                      {gc.providerName}
                    </span>
                  </div>
                  <div className="card-actions" onClick={(e) => e.stopPropagation()}>
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => removeGiftedCredential(gc.id)}
                    >
                      Remove
                    </button>
                  </div>
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
                  <label
                    style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px', cursor: 'pointer', fontSize: '12px', color: 'var(--text-secondary)' }}
                    onClick={(e) => e.stopPropagation()}
                  >
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

      {stats && (
        <StatsSheet
          target={stats}
          credentials={credentials}
          gifts={gifts}
          giftedCredentials={giftedCredentials}
          requestLog={requestLog}
          giftPeerOnline={giftPeerOnline}
          onClose={() => setStats(null)}
        />
      )}
    </div>
  );
}

interface CredentialCardProps {
  cred: CredentialMeta;
  usage: ProviderUsage | undefined;
  gifted: { count: number; used: number } | undefined;
  onOpenStats: () => void;
  onRemove: () => void;
}

function CredentialCard({ cred, usage, gifted, onOpenStats, onRemove }: CredentialCardProps) {
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

  const hasUsage = usage && usage.requests > 0;
  const hasGifted = gifted && gifted.used > 0;

  return (
    <div
      className="card credential-card tappable"
      onClick={editing ? undefined : onOpenStats}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (editing) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpenStats();
        }
      }}
    >
      <div className="card-header">
        <div className="credential-card-heading">
          <div className="provider-icon-box provider-icon-box-sm">
            <ProviderIcon providerId={cred.providerId} size={18} />
          </div>
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
        </div>
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

      <div className="credential-usage-open">
        <div className="usage-mini-label">Last 7 days</div>
        <div className="usage-mini-grid">
          <div>
            <div className="usage-mini-value">{hasUsage ? usage!.requests : 0}</div>
            <div className="usage-mini-tag">requests</div>
          </div>
          <div>
            <div className="usage-mini-value">{formatTokens(hasUsage ? usage!.inputTokens : 0)}</div>
            <div className="usage-mini-tag">input</div>
          </div>
          <div>
            <div className="usage-mini-value">{formatTokens(hasUsage ? usage!.outputTokens : 0)}</div>
            <div className="usage-mini-tag">output</div>
          </div>
        </div>
        <div className="credential-gifted-row">
          <span className="usage-mini-tag">Spent on gifts</span>
          <span className="credential-gifted-value">
            {hasGifted ? `${formatTokens(gifted!.used)} · ${gifted!.count} gift${gifted!.count !== 1 ? 's' : ''}` : 'None'}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Stats bottom sheet ──────────────────────────────────────────────

type TimeRange = '24h' | '7d' | '30d' | 'all';

function filterByTime(log: RequestLogEntry[], range: TimeRange): RequestLogEntry[] {
  if (range === 'all') return log;
  const ms = range === '24h' ? 86400000 : range === '7d' ? 604800000 : 2592000000;
  const cutoff = Date.now() - ms;
  return log.filter((e) => e.timestamp >= cutoff);
}

interface StatsSheetProps {
  target: StatsTarget;
  credentials: CredentialMeta[];
  gifts: Gift[];
  giftedCredentials: GiftedCredential[];
  requestLog: RequestLogEntry[];
  giftPeerOnline: Record<string, boolean>;
  onClose: () => void;
}

function StatsSheet({ target, credentials, gifts, giftedCredentials, requestLog, giftPeerOnline, onClose }: StatsSheetProps) {
  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  let title = 'Stats';
  let body: React.ReactNode = null;
  if (target.kind === 'credential') {
    const cred = credentials.find((c) => c.id === target.credentialId);
    if (cred) {
      title = cred.label;
      body = (
        <CredentialStats
          cred={cred}
          gifts={gifts.filter((g) => g.credentialId === cred.id)}
          requestLog={requestLog}
        />
      );
    }
  } else {
    const gc = giftedCredentials.find((g) => g.id === target.giftedId);
    if (gc) {
      title = `Gift from ${gc.senderLabel}`;
      body = <GiftStats gc={gc} online={giftPeerOnline[gc.giftId]} />;
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal-sheet" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-header">
          <span className="modal-title">{title}</span>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="modal-body">{body}</div>
      </div>
    </div>
  );
}

function CredentialStats({ cred, gifts, requestLog }: { cred: CredentialMeta; gifts: Gift[]; requestLog: RequestLogEntry[] }) {
  const [range, setRange] = useState<TimeRange>('7d');
  const provider = PROVIDERS[cred.providerId];
  const filtered = useMemo(
    () => filterByTime(requestLog, range).filter((e) => e.providerId === cred.providerId && e.status < 400),
    [requestLog, range, cred.providerId],
  );

  const byModel = new Map<string, { requests: number; inputTokens: number; outputTokens: number }>();
  const byApp = new Map<string, { origin: string; requests: number; inputTokens: number; outputTokens: number }>();
  let totalInput = 0;
  let totalOutput = 0;
  for (const e of filtered) {
    totalInput += e.inputTokens ?? 0;
    totalOutput += e.outputTokens ?? 0;
    if (e.model) {
      const m = byModel.get(e.model) ?? { requests: 0, inputTokens: 0, outputTokens: 0 };
      m.requests++;
      m.inputTokens += e.inputTokens ?? 0;
      m.outputTokens += e.outputTokens ?? 0;
      byModel.set(e.model, m);
    }
    const a = byApp.get(e.appOrigin) ?? { origin: e.appOrigin, requests: 0, inputTokens: 0, outputTokens: 0 };
    a.requests++;
    a.inputTokens += e.inputTokens ?? 0;
    a.outputTokens += e.outputTokens ?? 0;
    byApp.set(e.appOrigin, a);
  }
  const apps = [...byApp.values()].sort((a, b) => (b.inputTokens + b.outputTokens) - (a.inputTokens + a.outputTokens));
  const models = [...byModel.entries()].sort((a, b) => (b[1].inputTokens + b[1].outputTokens) - (a[1].inputTokens + a[1].outputTokens));
  const giftUsedTotal = gifts.reduce((s, g) => s + g.usedTokens, 0);

  return (
    <>
      <p className="card-subtitle" style={{ marginBottom: '12px' }}>
        {provider?.name ?? cred.providerId} · shared across all credentials of this provider
      </p>

      <div className="usage-range-toggle">
        {(['24h', '7d', '30d', 'all'] as TimeRange[]).map((r) => (
          <button
            key={r}
            className={`usage-range-btn ${range === r ? 'active' : ''}`}
            onClick={() => setRange(r)}
          >
            {r === 'all' ? 'All' : r}
          </button>
        ))}
      </div>

      <div className="usage-totals">
        <div className="usage-stat-card">
          <div className="usage-stat-value">{filtered.length}</div>
          <div className="usage-stat-label">Requests</div>
        </div>
        <div className="usage-stat-card">
          <div className="usage-stat-value">{formatTokens(totalInput)}</div>
          <div className="usage-stat-label">Input tokens</div>
        </div>
        <div className="usage-stat-card">
          <div className="usage-stat-value">{formatTokens(totalOutput)}</div>
          <div className="usage-stat-label">Output tokens</div>
        </div>
      </div>

      {filtered.length === 0 && <div className="empty-state"><p>No usage in this period.</p></div>}

      {models.length > 0 && (
        <>
          <h3 className="usage-section-title">By Model</h3>
          <div className="card usage-card">
            <div className="usage-models" style={{ marginTop: 0, paddingTop: 0, borderTop: 'none' }}>
              {models.map(([model, m]) => (
                <div key={model} className="usage-model-row">
                  <span className="usage-model-name">{model}</span>
                  <span className="usage-model-tokens">{formatTokens(m.inputTokens + m.outputTokens)}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {apps.length > 0 && (
        <>
          <h3 className="usage-section-title">By App</h3>
          {apps.map((a) => (
            <div key={a.origin} className="card usage-card">
              <div className="card-header" style={{ marginBottom: '0' }}>
                <div style={{ minWidth: 0 }}>
                  <span className="card-title" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {formatHostname(a.origin)}
                  </span>
                  <div className="card-subtitle">{a.requests} request{a.requests !== 1 ? 's' : ''}</div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: '14px', fontWeight: 600 }}>{formatTokens(a.inputTokens + a.outputTokens)}</div>
                  <div className="card-subtitle">tokens</div>
                </div>
              </div>
            </div>
          ))}
        </>
      )}

      <h3 className="usage-section-title">Gifts from this credential</h3>
      {gifts.length === 0 ? (
        <div className="empty-state"><p>No gifts created from this credential.</p></div>
      ) : (
        <>
          <p className="card-subtitle" style={{ marginBottom: '8px' }}>
            {formatTokens(giftUsedTotal)} tokens redeemed across {gifts.length} gift{gifts.length !== 1 ? 's' : ''}
          </p>
          {gifts.map((g) => {
            const pct = g.maxTokens > 0 ? Math.min(100, (g.usedTokens / g.maxTokens) * 100) : 0;
            const expired = g.expiresAt <= Date.now() || !g.active;
            return (
              <div key={g.id} className="card usage-card">
                <div className="card-header" style={{ marginBottom: '6px' }}>
                  <span className="card-title">{g.label || 'Unnamed gift'}</span>
                  <span className="card-subtitle">{expired ? 'Inactive' : `Expires in ${formatExpiry(g.expiresAt)}`}</span>
                </div>
                <div className="gift-budget">
                  <div className="gift-budget-text">
                    <span>{formatTokens(g.usedTokens)} used</span>
                    <span className="gift-budget-total">/ {formatTokens(g.maxTokens)}</span>
                  </div>
                  <div className="allowance-bar">
                    <div className={`allowance-bar-fill ${pct >= 90 ? 'over' : ''}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              </div>
            );
          })}
        </>
      )}
    </>
  );
}

function GiftStats({ gc, online }: { gc: GiftedCredential; online: boolean | undefined }) {
  const remaining = giftBudgetRemaining(gc);
  const pct = giftBudgetPercent(gc);
  const provider = PROVIDERS[gc.providerId];
  const status = online === true ? 'Online' : online === false ? 'Offline' : 'Checking…';
  const statusClass = online === true ? 'success' : online === false ? 'error' : 'warning';

  return (
    <>
      <p className="card-subtitle" style={{ marginBottom: '12px' }}>
        {provider?.name ?? gc.providerId} · from {gc.senderLabel}
      </p>

      <div className="usage-totals">
        <div className="usage-stat-card">
          <div className="usage-stat-value">{formatTokens(gc.usedTokens)}</div>
          <div className="usage-stat-label">Used</div>
        </div>
        <div className="usage-stat-card">
          <div className="usage-stat-value">{formatTokens(remaining)}</div>
          <div className="usage-stat-label">Remaining</div>
        </div>
        <div className="usage-stat-card">
          <div className="usage-stat-value">{formatTokens(gc.maxTokens)}</div>
          <div className="usage-stat-label">Budget</div>
        </div>
      </div>

      <div className="gift-budget" style={{ marginTop: '4px', marginBottom: '16px' }}>
        <div className="allowance-bar">
          <div className={`allowance-bar-fill ${pct >= 90 ? 'over' : ''}`} style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="card usage-card">
        <div className="usage-model-row">
          <span className="usage-model-name" style={{ fontFamily: 'inherit', fontSize: '12px' }}>Sender</span>
          <span className="usage-model-tokens" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span className={`status-dot ${statusClass}`} />{status}
          </span>
        </div>
        <div className="usage-model-row">
          <span className="usage-model-name" style={{ fontFamily: 'inherit', fontSize: '12px' }}>Expires</span>
          <span className="usage-model-tokens">{formatExpiry(gc.expiresAt)}</span>
        </div>
        <div className="usage-model-row">
          <span className="usage-model-name" style={{ fontFamily: 'inherit', fontSize: '12px' }}>Received</span>
          <span className="usage-model-tokens">{new Date(gc.createdAt).toLocaleDateString()}</span>
        </div>
      </div>
    </>
  );
}
