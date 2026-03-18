interface Props {
  onConnect: () => void;
}

export function ConnectWallet({ onConnect }: Props) {
  return (
    <div className="connect-page">
      <div className="connect-card">
        <div className="connect-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            <path d="M9 12l2 2 4-4" />
          </svg>
        </div>
        <h2>Connect your byoky wallet</h2>
        <p>
          This demo app uses the byoky SDK to chat with AI models using your own
          API keys. Your keys never leave the byoky extension.
        </p>
        <button className="btn btn-primary btn-lg" onClick={onConnect}>
          Connect Wallet
        </button>
        <div className="connect-features">
          <div className="connect-feature">
            <span className="feature-check">&#10003;</span>
            Keys stay encrypted in the extension
          </div>
          <div className="connect-feature">
            <span className="feature-check">&#10003;</span>
            This app never sees your API keys
          </div>
          <div className="connect-feature">
            <span className="feature-check">&#10003;</span>
            Revoke access anytime from the wallet
          </div>
        </div>
      </div>

      <div className="connect-install">
        <p>
          Don&apos;t have byoky?{' '}
          <a href="https://byoky.com" target="_blank" rel="noopener noreferrer">
            Install the extension
          </a>
        </p>
      </div>
    </div>
  );
}
