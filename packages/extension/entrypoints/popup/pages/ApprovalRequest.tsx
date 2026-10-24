import { useState } from 'react';
import { useWalletStore } from '../store';
import { PROVIDERS } from '@byoky/core';

function formatHostname(origin: string): string {
  try {
    return new URL(origin).hostname;
  } catch {
    return origin;
  }
}

export function ApprovalRequest() {
  const { pendingApprovals, credentials, approveConnect, rejectConnect } =
    useWalletStore();
  const [trust, setTrust] = useState(false);

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

  const approval = pendingApprovals[0];
  const hostname = formatHostname(approval.appOrigin);

  // Show which providers the app is requesting
  const requestedProviders =
    approval.providers.length > 0
      ? approval.providers
      : credentials.map((c) => ({ id: c.providerId, required: false }));

  return (
    <div>
      <h2 className="page-title">Connection Request</h2>

      <div className="approval-card">
        <div className="approval-icon">
          {hostname.charAt(0).toUpperCase()}
        </div>
        <div className="approval-origin">{hostname}</div>
        <div className="approval-subtitle">wants to connect to your wallet</div>
      </div>

      <div className="approval-section">
        <div className="approval-section-label">Requesting access to:</div>
        <div className="approval-providers">
          {requestedProviders.map((p) => {
            const provider = PROVIDERS[p.id];
            const hasCred = credentials.some((c) => c.providerId === p.id);
            return (
              <div key={p.id} className="approval-provider-row">
                <span className="badge badge-provider">
                  {provider?.name ?? p.id}
                </span>
                {!hasCred && (
                  <span className="approval-no-cred">no key added</span>
                )}
                {p.required && hasCred && (
                  <span className="approval-required">required</span>
                )}
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

      {pendingApprovals.length > 1 && (
        <div className="approval-queue">
          +{pendingApprovals.length - 1} more pending
        </div>
      )}
    </div>
  );
}
