import { useState } from 'react';
import { useWalletStore } from '../store';
import {
  PROVIDERS,
  DEFAULT_GROUP_ID,
  resolveRoute,
  type Credential,
  type CredentialMeta,
  type Group,
  type PendingApproval,
} from '@byoky/core';
import { Raven } from '../components/Raven';
import { FormError } from '../components/FormError';
import { describeOrigin } from '../utils/origin';

/**
 * The providers a request lists, as far as they can be shown, once each (the
 * session the background approves has one entry per provider). The list
 * comes from the web page as sent, so it may not be an array of { id }
 * objects, and may name a provider twice: it is required if either says so.
 */
function requestedProviderList(providers: unknown): { id: string; required: boolean }[] {
  if (!Array.isArray(providers)) return [];
  const byId = new Map<string, { id: string; required: boolean }>();
  for (const p of providers) {
    if (typeof p !== 'object' || p === null) continue;
    const { id: rawId, required } = p as { id?: unknown; required?: unknown };
    const id = String(rawId);
    const seen = byId.get(id);
    if (seen) seen.required ||= required === true;
    else byId.set(id, { id, required: required === true });
  }
  return [...byId.values()];
}

function providerName(id: string): string {
  return Object.prototype.hasOwnProperty.call(PROVIDERS, id) ? PROVIDERS[id].name : id;
}

type Route =
  | { kind: 'direct' }
  | { kind: 'translated'; via: string }
  | { kind: 'routed'; via: string }
  | { kind: 'none' };

/**
 * Which key will serve `providerId` once approved: core resolveRoute, the
 * rule the background routes the session by (resolveSessionProviders),
 * including its check that the key belongs to the provider the request is
 * sent to.
 */
function routeFor(providerId: string, group: Group | undefined, credentials: CredentialMeta[]): Route {
  // The resolvers read only id, providerId, createdAt and lastUsedAt.
  const route = resolveRoute(providerId, group, credentials as unknown as Credential[]);
  const destination = route?.translation?.dstProviderId ?? route?.swap?.dstProviderId ?? providerId;
  if (!route || route.credential.providerId !== destination) return { kind: 'none' };
  if (route.translation) return { kind: 'translated', via: route.translation.dstProviderId };
  if (route.swap) return { kind: 'routed', via: route.swap.dstProviderId };
  return { kind: 'direct' };
}

function routeLabel(route: Route): string {
  switch (route.kind) {
    case 'direct': return 'Key ready';
    case 'translated': return `Uses your ${providerName(route.via)} key (translated)`;
    case 'routed': return `Routed to ${providerName(route.via)}`;
    case 'none': return 'No key';
  }
}

export function ApprovalRequest() {
  const { pendingApprovals, error, navigate } = useWalletStore();

  if (pendingApprovals.length === 0) {
    // Reached when approving fails and nothing else is queued: keep the
    // error on screen, with a way back (this page has no nav).
    return (
      <div>
        <h2 className="page-title">Connection Request</h2>
        {error && <FormError>{error}</FormError>}
        <div className="empty-state">
          <p>No pending requests.</p>
          <button className="btn btn-secondary" style={{ marginTop: '12px' }} onClick={() => navigate('dashboard')}>
            Back to wallet
          </button>
        </div>
      </div>
    );
  }

  // Keyed by request, so each one starts with "Trust this site" unticked:
  // a tick given to one origin must not carry over to the next in the queue.
  return (
    <ApprovalCard
      key={pendingApprovals[0].id}
      approval={pendingApprovals[0]}
      queued={pendingApprovals.length - 1}
    />
  );
}

function ApprovalCard({ approval, queued }: { approval: PendingApproval; queued: number }) {
  const { credentials, groups, appGroups, error, approveConnect, rejectConnect } = useWalletStore();
  const [trust, setTrust] = useState(false);
  // Host and port, since trust is granted per full origin.
  const origin = describeOrigin(approval.appOrigin);

  // Show which providers the app is requesting. An app that names none gets
  // every provider the wallet holds a key for, once each however many keys.
  const listed = requestedProviderList(approval.providers);
  const requestedProviders =
    listed.length > 0
      ? listed
      : [...new Set(credentials.map((c) => c.providerId))].map((id) => ({ id, required: false }));
  // A new origin joins the default group; a stale binding falls back to it.
  const group =
    groups.find((g) => g.id === (appGroups[approval.appOrigin] ?? DEFAULT_GROUP_ID)) ??
    groups.find((g) => g.id === DEFAULT_GROUP_ID);

  return (
    <div className="approval-page">
      <div className="approval-hero">
        <Raven state="alert" view="bust" size={104} />
        <div>
          <div className="status-line">Incoming connection</div>
          <h2 className="page-title">Connection Request</h2>
        </div>
      </div>

      {error && <FormError>{error}</FormError>}

      <div className="approval-card">
        <div className="approval-origin">{origin.label}</div>
        {origin.insecure && (
          <span className="result-tag alarm" title="This page loads over plain http, so anyone on the network can pose as it.">
            Not secure
          </span>
        )}
        <div className="approval-subtitle">wants to connect to your wallet</div>
      </div>

      <div className="approval-section">
        <div className="approval-section-label">Requesting access to:</div>
        <div className="approval-providers">
          {requestedProviders.map((p, i) => {
            // An app asking for a provider you hold no key for may still be
            // served, and billed, on another key: say which.
            const route = routeFor(p.id, group, credentials);
            const tone = route.kind === 'direct' ? 'ready' : route.kind === 'none' ? 'missing' : 'routed';
            return (
              <div key={`${i}:${p.id}`} className="approval-provider-row">
                <span>{providerName(p.id)}</span>
                <span className={`result-tag ${tone}${p.required ? ' required' : ''}`}>
                  {routeLabel(route)}
                  {p.required && ' · required'}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {origin.insecure ? (
        // The background refuses to trust these too.
        <p className="approval-trust-note">
          Sites on plain http can&apos;t be trusted to connect without asking:
          anyone on the network can pose as them.
        </p>
      ) : (
        <label className="approval-trust">
          <input
            type="checkbox"
            checked={trust}
            onChange={(e) => setTrust(e.target.checked)}
          />
          <span>Trust this site (auto-approve future connections)</span>
        </label>
      )}

      <div className="approval-actions">
        <button
          className="btn btn-secondary"
          onClick={() => rejectConnect(approval.id)}
        >
          Reject
        </button>
        <button
          className="btn btn-primary"
          onClick={() => approveConnect(approval.id, trust && !origin.insecure)}
        >
          Approve
        </button>
      </div>

      <div className="approval-full-origin">{approval.appOrigin}</div>

      {queued > 0 && (
        <div className="approval-queue">
          +{queued} more pending
        </div>
      )}
    </div>
  );
}
