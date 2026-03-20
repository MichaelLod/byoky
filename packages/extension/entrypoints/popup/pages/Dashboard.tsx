import { useWalletStore } from '../store';
import { PROVIDERS, giftBudgetPercent, giftBudgetRemaining, isGiftExpired } from '@byoky/core';

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

export function Dashboard() {
  const { credentials, gifts, giftedCredentials, navigate, lock, removeCredential, revokeGift, removeGiftedCredential } =
    useWalletStore();

  const activeGifts = gifts.filter((g) => g.active && !isGiftExpired(g));
  const activeGiftedCreds = giftedCredentials.filter((gc) => !isGiftExpired(gc));

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h2 className="page-title" style={{ marginBottom: 0 }}>Credentials</h2>
        <button className="text-link" onClick={() => lock()}>
          Lock
        </button>
      </div>

      {credentials.length === 0 && activeGiftedCreds.length === 0 ? (
        <div className="empty-state">
          <p>No API keys or tokens yet.</p>
          <button
            className="btn btn-primary"
            style={{ width: 'auto' }}
            onClick={() => navigate('add-credential')}
          >
            Add credential
          </button>
        </div>
      ) : (
        <>
          {credentials.map((cred) => {
            const provider = PROVIDERS[cred.providerId];
            return (
              <div key={cred.id} className="card">
                <div className="card-header">
                  <div>
                    <span className="card-title">{cred.label}</span>
                    <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                      <span className="badge badge-provider">
                        {provider?.name ?? cred.providerId}
                      </span>
                      <span className="badge badge-method">
                        {cred.authMethod === 'oauth' ? 'Setup Token' : 'API Key'}
                      </span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                      className="btn btn-sm"
                      style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                      onClick={() => navigate('create-gift')}
                      title="Gift tokens"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 12v10H4V12" />
                        <path d="M2 7h20v5H2z" />
                        <path d="M12 22V7" />
                        <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" />
                        <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" />
                      </svg>
                      Gift
                    </button>
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => removeCredential(cred.id)}
                    >
                      Remove
                    </button>
                  </div>
                </div>
                <div className="card-subtitle" style={{ marginTop: '8px' }}>
                  Added {new Date(cred.createdAt).toLocaleDateString()}
                </div>
              </div>
            );
          })}

          {/* Gifted credentials (received from others) */}
          {activeGiftedCreds.length > 0 && (
            <>
              <div className="gift-section-label">Received Gifts</div>
              {activeGiftedCreds.map((gc) => {
                const pct = giftBudgetPercent(gc);
                const remaining = giftBudgetRemaining(gc);
                return (
                  <div key={gc.id} className="card gift-card">
                    <div className="card-header">
                      <div>
                        <span className="card-title">
                          {gc.providerName}
                        </span>
                        <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                          <span className="badge badge-gift">Gift</span>
                          <span className="badge badge-provider">
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
                    <div className="gift-budget">
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
                    <div className="card-subtitle" style={{ marginTop: '6px' }}>
                      Expires {new Date(gc.expiresAt).toLocaleDateString()}
                    </div>
                  </div>
                );
              })}
            </>
          )}

          {/* Active gifts created by this user */}
          {activeGifts.length > 0 && (
            <>
              <div className="gift-section-label">Sent Gifts</div>
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
                    <div className="card-subtitle" style={{ marginTop: '6px' }}>
                      Expires {new Date(g.expiresAt).toLocaleDateString()}
                    </div>
                  </div>
                );
              })}
            </>
          )}

          <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
            <button
              className="btn btn-secondary"
              onClick={() => navigate('add-credential')}
            >
              Add credential
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => navigate('redeem-gift')}
            >
              Redeem gift
            </button>
          </div>
        </>
      )}
    </div>
  );
}
