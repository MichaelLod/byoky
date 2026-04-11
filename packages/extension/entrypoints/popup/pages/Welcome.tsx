import { useWalletStore } from '../store';

export function Welcome() {
  const { navigate, continueOffline } = useWalletStore();

  return (
    <div className="center-page">
      <div className="logo-large">Byoky</div>
      <div className="tagline">Bring Your Own Key</div>

      <p
        style={{
          fontSize: '13px',
          color: 'var(--text-secondary)',
          textAlign: 'center',
          margin: '24px 0 20px',
          lineHeight: 1.5,
        }}
      >
        Your encrypted wallet for AI API keys.
        <br />
        Sync across devices, end-to-end encrypted.
      </p>

      <button
        type="button"
        className="btn btn-primary"
        style={{ width: '100%', marginBottom: '12px' }}
        onClick={() => navigate('vault-auth')}
      >
        Get Started
      </button>

      <button
        type="button"
        className="text-link"
        style={{
          display: 'block',
          width: '100%',
          fontSize: '12px',
          color: 'var(--text-muted)',
          textAlign: 'center',
          padding: '8px',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
        }}
        onClick={() => continueOffline()}
      >
        Continue in offline mode
      </button>
    </div>
  );
}
