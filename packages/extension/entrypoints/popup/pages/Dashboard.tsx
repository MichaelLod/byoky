import { useState, useMemo, useRef, useEffect, type KeyboardEvent } from 'react';
import { useWalletStore } from '../store';
import {
  PROVIDERS,
  type RequestLogEntry,
  type CredentialMeta,
} from '@byoky/core';
import { RetiredFeaturesNotice } from '../components/RetiredFeaturesNotice';
import { TrustResetNotice } from '../components/TrustResetNotice';
import { LimitsHoldNotice } from '../components/LimitsHoldNotice';
import { ProviderIcon } from '../components/ProviderIcon';
import { Modal } from '../components/Modal';
import { describeOrigin } from '../utils/origin';

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

interface Usage {
  requests: number;
  inputTokens: number;
  outputTokens: number;
}

/** credentialId: the key that served the request, recorded by the background (WP-A F033). */
type LogEntry = RequestLogEntry & { credentialId?: string };

type Attribution = { credentialId: string } | { sharedBy: string } | null;

/**
 * Which key served a request. Entries name it; entries logged before that
 * only name the provider (the one actually called, under translation), which
 * pins them to a key only when the wallet holds one key of that provider.
 * Otherwise they are shared by all of that provider's keys. null: the key is
 * gone.
 */
function attribute(entry: LogEntry, credentials: CredentialMeta[]): Attribution {
  if (entry.credentialId) {
    return credentials.some((c) => c.id === entry.credentialId) ? { credentialId: entry.credentialId } : null;
  }
  const provider = entry.actualProviderId ?? entry.providerId;
  const keys = credentials.filter((c) => c.providerId === provider);
  if (keys.length === 1) return { credentialId: keys[0].id };
  return keys.length > 1 ? { sharedBy: provider } : null;
}

function addTo(map: Map<string, Usage>, key: string, entry: LogEntry) {
  const usage = map.get(key) ?? { requests: 0, inputTokens: 0, outputTokens: 0 };
  usage.requests++;
  usage.inputTokens += entry.inputTokens ?? 0;
  usage.outputTokens += entry.outputTokens ?? 0;
  map.set(key, usage);
}

// Last 7 days of successful requests, per key, plus the older-style entries
// that can only be told apart by provider.
function computeUsageByCredential(log: LogEntry[], credentials: CredentialMeta[]) {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const byCredential = new Map<string, Usage>();
  const sharedByProvider = new Map<string, Usage>();
  for (const entry of log) {
    if (entry.timestamp < cutoff) continue;
    if (entry.status >= 400) continue;
    const who = attribute(entry, credentials);
    if (!who) continue;
    if ('credentialId' in who) addTo(byCredential, who.credentialId, entry);
    else addTo(sharedByProvider, who.sharedBy, entry);
  }
  return { byCredential, sharedByProvider };
}

export function Dashboard() {
  const { credentials, requestLog, lock, removeCredential } = useWalletStore();
  const usage = useMemo(() => computeUsageByCredential(requestLog, credentials), [requestLog, credentials]);
  const [statsCredentialId, setStatsCredentialId] = useState<string | null>(null);

  return (
    <div>
      <LimitsHoldNotice />
      <TrustResetNotice />
      <RetiredFeaturesNotice />
      <div className="page-title-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h2 className="page-title" style={{ marginBottom: 0 }}>Credentials</h2>
        <button className="text-link bracket-link" onClick={() => lock()}>
          Lock
        </button>
      </div>

      {credentials.length === 0 ? (
        <div className="empty-state">
          <p>No API keys or tokens yet.</p>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '8px' }}>
            Use the + button to add a credential. Apps you connect use it through the wallet and never see the key.
          </p>
        </div>
      ) : (
        credentials.map((cred) => (
          <CredentialCard
            key={cred.id}
            cred={cred}
            usage={usage.byCredential.get(cred.id)}
            shared={usage.sharedByProvider.get(cred.providerId)}
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
  /** This key's own usage. */
  usage: Usage | undefined;
  /** Earlier usage that can't be told apart among this provider's keys. */
  shared: Usage | undefined;
  onOpenStats: () => void;
  onRemove: () => void;
}

function CredentialCard({ cred, usage, shared, onOpenStats, onRemove }: CredentialCardProps) {
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

  // The whole card opens the usage sheet for the mouse. Keyboard and screen
  // reader users get the usage button below; the card itself is no button,
  // so Rename and Remove inside it work from the keyboard.
  return (
    <div
      className="card credential-card tappable"
      onClick={editing ? undefined : onOpenStats}
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
              aria-label={`Rename ${cred.label}`}
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
      {/* Safari can't add one, but a backup from Chrome or Firefox can bring one in. */}
      {import.meta.env.SAFARI && cred.authMethod === 'oauth' && (
        <div className="warning-note" style={{ marginTop: '8px' }}>
          Setup tokens need the Byoky Bridge, which works with Chrome and Firefox on a computer.
          Requests with this one fail in Safari; use an Anthropic API key here.
        </div>
      )}

      <button
        type="button"
        className="credential-usage-open"
        aria-label={`View usage for ${cred.label}`}
        onClick={(e) => {
          e.stopPropagation();
          if (!editing) onOpenStats();
        }}
      >
        <span className="usage-mini-label">Last 7 days</span>
        <span className="usage-mini-grid">
          <span>
            <span className="usage-mini-value">{hasUsage ? usage!.requests : 0}</span>
            <span className="usage-mini-tag">requests</span>
          </span>
          <span>
            <span className="usage-mini-value">{formatTokens(hasUsage ? usage!.inputTokens : 0)}</span>
            <span className="usage-mini-tag">input</span>
          </span>
          <span>
            <span className="usage-mini-value">{formatTokens(hasUsage ? usage!.outputTokens : 0)}</span>
            <span className="usage-mini-tag">output</span>
          </span>
        </span>
        {shared && shared.requests > 0 && (
          <span className="usage-mini-shared">
            +{shared.requests} earlier, all {provider?.name ?? cred.providerId} keys
          </span>
        )}
      </button>
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
  const cred = credentials.find((c) => c.id === credentialId);
  const title = cred?.label ?? 'Stats';

  return (
    <Modal title={title} onClose={onClose}>
      {cred && <CredentialStats cred={cred} credentials={credentials} requestLog={requestLog} />}
    </Modal>
  );
}

function CredentialStats({ cred, credentials, requestLog }: {
  cred: CredentialMeta;
  credentials: CredentialMeta[];
  requestLog: LogEntry[];
}) {
  const [range, setRange] = useState<TimeRange>('7d');
  const provider = PROVIDERS[cred.providerId];
  const { filtered, sharedCount } = useMemo(() => {
    const mine: LogEntry[] = [];
    let shared = 0;
    for (const e of filterByTime(requestLog, range)) {
      if (e.status >= 400) continue;
      const who = attribute(e, credentials);
      if (!who) continue;
      if ('credentialId' in who) {
        if (who.credentialId === cred.id) mine.push(e);
      } else if (who.sharedBy === cred.providerId) {
        shared++;
      }
    }
    return { filtered: mine, sharedCount: shared };
  }, [requestLog, range, cred.id, cred.providerId, credentials]);

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
        {provider?.name ?? cred.providerId} · this key only
      </p>
      {sharedCount > 0 && (
        <p className="card-subtitle" style={{ marginBottom: '12px' }}>
          Not counted: {sharedCount} earlier {sharedCount === 1 ? 'request' : 'requests'}, shared by
          all {provider?.name ?? cred.providerId} keys.
        </p>
      )}

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
                  <span className="card-title mono" title={a.origin} style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }}>
                    {describeOrigin(a.origin).label}
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
