import { useWalletStore } from '../store';
import { PROVIDERS } from '@byoky/core';

export function Dashboard() {
  const { credentials, navigate, lock, removeCredential } = useWalletStore();

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h2 className="page-title" style={{ marginBottom: 0 }}>Credentials</h2>
        <button className="text-link" onClick={() => lock()}>
          Lock
        </button>
      </div>

      {credentials.length === 0 ? (
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
                  <span className="card-title">{cred.label}</span>
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={() => removeCredential(cred.id)}
                  >
                    Remove
                  </button>
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
              </div>
            );
          })}

          <button
            className="btn btn-secondary"
            style={{ marginTop: '8px' }}
            onClick={() => navigate('add-credential')}
          >
            Add credential
          </button>
        </>
      )}
    </div>
  );
}
