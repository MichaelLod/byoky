import { useState } from 'react';
import { useWalletStore } from '../store';
import { PROVIDERS, type RequestLogEntry } from '@byoky/core';

type TimeRange = '24h' | '7d' | '30d' | 'all';

function filterByTime(log: RequestLogEntry[], range: TimeRange): RequestLogEntry[] {
  if (range === 'all') return log;
  const now = Date.now();
  const ms = range === '24h' ? 86400000 : range === '7d' ? 604800000 : 2592000000;
  return log.filter((e) => now - e.timestamp < ms);
}

function formatTokens(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

interface ProviderStats {
  providerId: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  models: Map<string, { requests: number; inputTokens: number; outputTokens: number }>;
}

interface AppStats {
  origin: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  providers: Set<string>;
}

function computeStats(entries: RequestLogEntry[]) {
  const byProvider = new Map<string, ProviderStats>();
  const byApp = new Map<string, AppStats>();
  let totalInput = 0;
  let totalOutput = 0;
  let totalRequests = 0;

  for (const entry of entries) {
    if (entry.status >= 400) continue;
    totalRequests++;

    const input = entry.inputTokens ?? 0;
    const output = entry.outputTokens ?? 0;
    totalInput += input;
    totalOutput += output;

    // Provider stats
    let pStats = byProvider.get(entry.providerId);
    if (!pStats) {
      pStats = { providerId: entry.providerId, requests: 0, inputTokens: 0, outputTokens: 0, models: new Map() };
      byProvider.set(entry.providerId, pStats);
    }
    pStats.requests++;
    pStats.inputTokens += input;
    pStats.outputTokens += output;

    if (entry.model) {
      let mStats = pStats.models.get(entry.model);
      if (!mStats) {
        mStats = { requests: 0, inputTokens: 0, outputTokens: 0 };
        pStats.models.set(entry.model, mStats);
      }
      mStats.requests++;
      mStats.inputTokens += input;
      mStats.outputTokens += output;
    }

    // App stats
    let aStats = byApp.get(entry.appOrigin);
    if (!aStats) {
      aStats = { origin: entry.appOrigin, requests: 0, inputTokens: 0, outputTokens: 0, providers: new Set() };
      byApp.set(entry.appOrigin, aStats);
    }
    aStats.requests++;
    aStats.inputTokens += input;
    aStats.outputTokens += output;
    aStats.providers.add(entry.providerId);
  }

  return {
    totalInput,
    totalOutput,
    totalRequests,
    byProvider: [...byProvider.values()].sort((a, b) => b.outputTokens + b.inputTokens - a.outputTokens - a.inputTokens),
    byApp: [...byApp.values()].sort((a, b) => b.outputTokens + b.inputTokens - a.outputTokens - a.inputTokens),
  };
}

function formatHostname(origin: string): string {
  try {
    return new URL(origin).hostname;
  } catch {
    return origin;
  }
}

export function Usage() {
  const { requestLog } = useWalletStore();
  const [range, setRange] = useState<TimeRange>('7d');

  const filtered = filterByTime(requestLog, range);
  const stats = computeStats(filtered);
  const hasTokenData = stats.totalInput > 0 || stats.totalOutput > 0;

  return (
    <div>
      <h2 className="page-title">Usage</h2>

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

      {/* Totals */}
      <div className="usage-totals">
        <div className="usage-stat-card">
          <div className="usage-stat-value">{stats.totalRequests}</div>
          <div className="usage-stat-label">Requests</div>
        </div>
        <div className="usage-stat-card">
          <div className="usage-stat-value">{formatTokens(stats.totalInput)}</div>
          <div className="usage-stat-label">Input tokens</div>
        </div>
        <div className="usage-stat-card">
          <div className="usage-stat-value">{formatTokens(stats.totalOutput)}</div>
          <div className="usage-stat-label">Output tokens</div>
        </div>
      </div>

      {stats.totalRequests === 0 ? (
        <div className="empty-state">
          <p>No usage data for this period.</p>
        </div>
      ) : (
        <>
          {/* By Provider */}
          <h3 className="usage-section-title">By Provider</h3>
          {stats.byProvider.map((p) => {
            const provider = PROVIDERS[p.providerId];
            return (
              <div key={p.providerId} className="card usage-card">
                <div className="card-header" style={{ marginBottom: hasTokenData ? '8px' : '0' }}>
                  <div>
                    <span className="card-title">{provider?.name ?? p.providerId}</span>
                    <div className="card-subtitle">
                      {p.requests} request{p.requests !== 1 ? 's' : ''}
                    </div>
                  </div>
                  {hasTokenData && (
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '14px', fontWeight: 600 }}>
                        {formatTokens(p.inputTokens + p.outputTokens)}
                      </div>
                      <div className="card-subtitle">tokens</div>
                    </div>
                  )}
                </div>
                {hasTokenData && (p.inputTokens > 0 || p.outputTokens > 0) && (
                  <div className="usage-bar-container">
                    <div className="usage-bar">
                      <div
                        className="usage-bar-input"
                        style={{ flex: p.inputTokens }}
                      />
                      <div
                        className="usage-bar-output"
                        style={{ flex: p.outputTokens }}
                      />
                    </div>
                    <div className="usage-bar-legend">
                      <span><span className="legend-dot input" /> {formatTokens(p.inputTokens)} in</span>
                      <span><span className="legend-dot output" /> {formatTokens(p.outputTokens)} out</span>
                    </div>
                  </div>
                )}
                {p.models.size > 0 && (
                  <div className="usage-models">
                    {[...p.models.entries()].map(([model, m]) => (
                      <div key={model} className="usage-model-row">
                        <span className="usage-model-name">{model}</span>
                        <span className="usage-model-tokens">
                          {formatTokens(m.inputTokens + m.outputTokens)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* By App */}
          <h3 className="usage-section-title">By App</h3>
          {stats.byApp.map((a) => (
            <div key={a.origin} className="card usage-card">
              <div className="card-header" style={{ marginBottom: '4px' }}>
                <div style={{ minWidth: 0 }}>
                  <span className="card-title" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {formatHostname(a.origin)}
                  </span>
                  <div className="card-subtitle">
                    {a.requests} request{a.requests !== 1 ? 's' : ''}
                    {' · '}
                    {[...a.providers].map((id) => PROVIDERS[id]?.name ?? id).join(', ')}
                  </div>
                </div>
                {hasTokenData && (
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: '14px', fontWeight: 600 }}>
                      {formatTokens(a.inputTokens + a.outputTokens)}
                    </div>
                    <div className="card-subtitle">tokens</div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
