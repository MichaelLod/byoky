import { useState } from 'react';
import { useWalletStore } from '../store';
import { PROVIDERS, type PendingApproval } from '@byoky/core';
import { Raven } from '../components/Raven';
import { describeOrigin } from '../utils/origin';

/**
 * The providers a request lists, as far as they can be shown. The list comes
 * from the web page as sent, so it may not be an array of { id } objects.
 */
function requestedProviderList(providers: unknown): { id: string; required: boolean }[] {
  if (!Array.isArray(providers)) return [];
  return providers
    .filter((p): p is { id?: unknown; required?: unknown } => typeof p === 'object' && p !== null)
    .map((p) => ({ id: String(p.id), required: p.required === true }));
}

function providerName(id: string): string {
  return Object.prototype.hasOwnProperty.call(PROVIDERS, id) ? PROVIDERS[id].name : id;
}

export function ApprovalRequest() {
  const { pendingApprovals } = useWalletStore();

  if (pendingApprovals.length === 0) {
    return (
      <div>
        <h2 className="page-title">Connection Request</h2>
        <div className="empty-state">
          <p>No pending requests.</p>
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
  const { credentials, approveConnect, rejectConnect } = useWalletStore();
  const [trust, setTrust] = useState(false);
  // Host and port, since trust is granted per full origin.
  const origin = describeOrigin(approval.appOrigin);

  // Show which providers the app is requesting
  const listed = requestedProviderList(approval.providers);
  const requestedProviders =
    listed.length > 0
      ? listed
      : credentials.map((c) => ({ id: c.providerId, required: false }));

  return (
    <div className="approval-page">
      <div className="approval-hero">
        <Raven state="alert" view="bust" size={104} />
        <div>
          <div className="status-line">Incoming connection</div>
          <h2 className="page-title">Connection Request</h2>
        </div>
      </div>

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
            const hasCred = credentials.some((c) => c.providerId === p.id);
            return (
              <div key={`${i}:${p.id}`} className="approval-provider-row">
                <span>{providerName(p.id)}</span>
                <span className={`result-tag ${hasCred ? 'ready' : 'missing'}${p.required ? ' required' : ''}`}>
                  {hasCred ? 'Key ready' : 'No key'}
                  {p.required && ' · required'}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <label className="approval-trust">
        <input
          type="checkbox"
          checked={trust}
          onChange={(e) => setTrust(e.target.checked)}
        />
        <span>Trust this site (auto-approve future connections)</span>
      </label>

      <div className="approval-actions">
        <button
          className="btn btn-secondary"
          onClick={() => rejectConnect(approval.id)}
        >
          Reject
        </button>
        <button
          className="btn btn-primary"
          onClick={() => approveConnect(approval.id, trust)}
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
