import { useState, useMemo, useRef, useEffect, type KeyboardEvent } from 'react';
import { useWalletStore } from '../store';
import {
  PROVIDERS,
  type RequestLogEntry,
  type CredentialMeta,
} from '@byoky/core';
import { RetiredFeaturesNotice } from '../components/RetiredFeaturesNotice';
import { ProviderIcon } from '../components/ProviderIcon';

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
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

export function Dashboard() {
  const { credentials, requestLog, lock, removeCredential } = useWalletStore();
  const usageByProvider = useMemo(() => computeUsageByProvider(requestLog), [requestLog]);
  const [statsCredentialId, setStatsCredentialId] = useState<string | null>(null);

  return (
    <div>
      <RetiredFeaturesNotice />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h2 className="page-title" style={{ marginBottom: 0 }}>Credentials</h2>
        <button className="text-link bracket-link" onClick={() => lock()}>
          Lock
        </button>
      </div>

      {credentials.length === 0 ? (
        <div className="empty-state">
          <p>No API keys or tokens yet.</p>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '8px' }}>
            Tap the + button to add a credential. Apps you connect use it through the wallet and never see the key.
          </p>
        </div>
      ) : (
        credentials.map((cred) => (
          <CredentialCard
            key={cred.id}
            cred={cred}
            usage={usageByProvider.get(cred.providerId)}
            onOpenStats={() => setStatsCredentialId(cred.id)}
            onRemove={() => removeCredential(cred.id)}
          />
        ))
      )}

      {statsCredentialId && (
        <StatsSheet
          credentialId={statsCredentialId}
          credentials={credentials}
          requestLog={requestLog}
          onClose={() => setStatsCredentialId(null)}
        />
      )}
    </div>
  );
}

interface CredentialCardProps {
  cred: CredentialMeta;
  usage: ProviderUsage | undefined;
  onOpenStats: () => void;
  onRemove: () => void;
}

function CredentialCard({ cred, usage, onOpenStats, onRemove }: CredentialCardProps) {
  const { renameCredential } = useWalletStore();
  const provider = PROVIDERS[cred.providerId];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(cred.label);
  // Removing a key asks first, inline: popups can't rely on window.confirm
  // (Firefox doesn't show dialogs from extension popups).
  const [confirmingRemove, setConfirmingRemove] = useState(false);
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
            onClick={() => setConfirmingRemove(true)}
          >
            Remove
          </button>
        </div>
      </div>
      {confirmingRemove && (
        <div className="card-subtitle" style={{ marginTop: '8px' }} onClick={(e) => e.stopPropagation()}>
          <div style={{ marginBottom: '6px' }}>
            Remove {cred.label}? Apps using this key lose access to it. This can't be undone unless you
            have a backup that includes it.
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button className="btn btn-secondary btn-sm" onClick={() => setConfirmingRemove(false)}>
              Cancel
            </button>
            <button className="btn btn-danger btn-sm" onClick={onRemove}>
              Remove
            </button>
          </div>
        </div>
      )}
      <div className="credential-meta">
        <span className="badge badge-provider">
          {provider?.name ?? cred.providerId}
        </span>
        <span className="badge badge-method">
          {cred.authMethod === 'oauth' ? 'Setup Token' : 'API Key'}
        </span>
        <span className="credential-added">
          Added {new Date(cred.createdAt).toLocaleDateString()}
        </span>
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
  credentialId: string;
  credentials: CredentialMeta[];
  requestLog: RequestLogEntry[];
  onClose: () => void;
}

function StatsSheet({ credentialId, credentials, requestLog, onClose }: StatsSheetProps) {
  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const cred = credentials.find((c) => c.id === credentialId);
  const title = cred?.label ?? 'Stats';

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
        <div className="modal-body">
          {cred && <CredentialStats cred={cred} requestLog={requestLog} />}
        </div>
      </div>
    </div>
  );
}

function CredentialStats({ cred, requestLog }: { cred: CredentialMeta; requestLog: RequestLogEntry[] }) {
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
                  <span className="card-title mono" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }}>
                    {formatHostname(a.origin)}
                  </span>
                  <div className="card-subtitle">{a.requests} request{a.requests !== 1 ? 's' : ''}</div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div className="mono" style={{ fontSize: '14px', fontWeight: 500 }}>{formatTokens(a.inputTokens + a.outputTokens)}</div>
                  <div className="card-subtitle">tokens</div>
                </div>
              </div>
            </div>
          ))}
        </>
      )}
    </>
  );
}
