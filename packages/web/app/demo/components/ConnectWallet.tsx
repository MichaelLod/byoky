interface Props {
  onConnect: () => void;
  onMobileConnect: () => void;
  pairingCode: string | null;
  isPairing: boolean;
  onCancelPairing: () => void;
  hasExtension: boolean;
}

export function ConnectWallet({ onConnect, onMobileConnect, pairingCode, isPairing, onCancelPairing, hasExtension }: Props) {
  if (isPairing && pairingCode) {
    return (
      <div className="connect-page">
        <div className="connect-card">
          <div className="connect-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
              <line x1="12" y1="18" x2="12.01" y2="18" />
            </svg>
          </div>
          <h2>Scan with Byoky App</h2>
          <p>
            Open the Byoky app on your phone, go to the <strong>Pair</strong> tab,
            and scan this QR code or paste the code below.
          </p>

          <div className="pairing-qr">
            <QRCode value={pairingCode} size={200} />
          </div>

          <div className="pairing-code-box">
            <code className="pairing-code">{pairingCode.slice(0, 20)}...{pairingCode.slice(-10)}</code>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => navigator.clipboard.writeText(pairingCode)}
            >
              Copy
            </button>
          </div>

          <div className="pairing-status">
            <span className="pairing-spinner" />
            Waiting for phone...
          </div>

          <button className="btn btn-ghost" onClick={onCancelPairing}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (isPairing) {
    return (
      <div className="connect-page">
        <div className="connect-card">
          <div className="pairing-status">
            <span className="pairing-spinner" />
            Connecting to relay...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="connect-page">
      <div className="connect-card">
        <div className="connect-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            <path d="M9 12l2 2 4-4" />
          </svg>
        </div>
        <h2>Connect your Byoky wallet</h2>
        <p>
          This demo app uses the Byoky SDK to chat with AI models using your own
          API keys. Your keys never leave your device.
        </p>

        {hasExtension ? (
          <button className="btn btn-primary btn-lg" onClick={onConnect}>
            Connect Wallet
          </button>
        ) : (
          <div className="connect-options">
            <button className="btn btn-primary btn-lg" onClick={onMobileConnect}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
                <line x1="12" y1="18" x2="12.01" y2="18" />
              </svg>
              Connect with Phone
            </button>
            <button className="btn btn-secondary btn-lg" onClick={onConnect}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                <line x1="8" y1="21" x2="16" y2="21" />
                <line x1="12" y1="17" x2="12" y2="21" />
              </svg>
              Use Browser Extension
            </button>
          </div>
        )}

        <div className="connect-features">
          <div className="connect-feature">
            <span className="feature-check">&#10003;</span>
            Keys stay encrypted in your wallet
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
          Don&apos;t have Byoky?{' '}
          <a href="https://byoky.com" target="_blank" rel="noopener noreferrer">
            Get the app or extension
          </a>
        </p>
      </div>
    </div>
  );
}

/** Simple QR code generator using SVG — no dependencies. */
function QRCode({ value, size = 200 }: { value: string; size?: number }) {
  // Use a Canvas-free QR approach: encode as a data URL for an external QR API
  // For a real app you'd use a library, but this avoids adding dependencies
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(value)}&bgcolor=1c1c22&color=f5f5f7&format=svg`;

  return (
    <img
      src={qrUrl}
      alt="QR Code"
      width={size}
      height={size}
      style={{ borderRadius: 12, background: '#1c1c22' }}
    />
  );
}
