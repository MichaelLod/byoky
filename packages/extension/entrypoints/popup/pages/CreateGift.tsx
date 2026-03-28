import { useState, type FormEvent } from 'react';
import { useWalletStore } from '../store';
import { PROVIDERS, giftLinkToUrl } from '@byoky/core';

const EXPIRY_OPTIONS = [
  { label: '1 hour', ms: 60 * 60 * 1000 },
  { label: '24 hours', ms: 24 * 60 * 60 * 1000 },
  { label: '7 days', ms: 7 * 24 * 60 * 60 * 1000 },
  { label: '30 days', ms: 30 * 24 * 60 * 60 * 1000 },
];

const BUDGET_PRESETS = [10_000, 50_000, 100_000, 500_000, 1_000_000];

export function CreateGift() {
  const { credentials, createGift, navigate, error, cloudVaultEnabled } = useWalletStore();
  const [credentialId, setCredentialId] = useState(credentials[0]?.id ?? '');
  const [maxTokens, setMaxTokens] = useState(100_000);
  const [expiryMs, setExpiryMs] = useState(EXPIRY_OPTIONS[1].ms);
  const [relayUrl, setRelayUrl] = useState('wss://relay.byoky.com');
  const [giftLink, setGiftLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Sync credentialId when credentials load after mount
  if (!credentialId && credentials.length > 0) {
    setCredentialId(credentials[0].id);
  }

  const selectedCred = credentials.find((c) => c.id === credentialId);
  const provider = selectedCred ? PROVIDERS[selectedCred.providerId] : null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!selectedCred) return;
    setSubmitting(true);
    const encoded = await createGift(
      credentialId,
      selectedCred.providerId,
      selectedCred.label,
      maxTokens,
      expiryMs,
      relayUrl,
    );
    setSubmitting(false);
    if (encoded) {
      setGiftLink(giftLinkToUrl(encoded));
    }
  }

  async function copyLink() {
    if (!giftLink) return;
    await navigator.clipboard.writeText(giftLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function shareLink() {
    if (!giftLink) return;
    const text = `I'm sharing ${formatTokens(maxTokens)} tokens of ${provider?.name ?? selectedCred?.providerId} with you via Byoky!`;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Byoky Gift', text, url: giftLink });
        return;
      } catch {
        // Fall through to copy
      }
    }
    await copyLink();
  }

  function formatTokens(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
    return String(n);
  }

  if (giftLink) {
    return (
      <div>
        <h2 className="page-title">Gift Created</h2>
        <div className="gift-success">
          <div className="gift-success-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 12v10H4V12" />
              <path d="M2 7h20v5H2z" />
              <path d="M12 22V7" />
              <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" />
              <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" />
            </svg>
          </div>
          <p className="gift-success-label">
            {formatTokens(maxTokens)} tokens via {provider?.name ?? selectedCred?.providerId}
          </p>
          <div className="gift-link-box">
            <code className="gift-link-text">{giftLink}</code>
          </div>
          <div className="gift-share-actions">
            <button className="btn btn-primary" onClick={shareLink}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="18" cy="5" r="3" />
                <circle cx="6" cy="12" r="3" />
                <circle cx="18" cy="19" r="3" />
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
              </svg>
              Share Gift
            </button>
            <button className="btn btn-secondary" onClick={copyLink}>
              {copied ? 'Copied!' : 'Copy Link'}
            </button>
          </div>
          <p className="gift-hint">
            Share this link with the recipient. They can redeem it in their Byoky wallet.
            Your API key never leaves your extension.
          </p>
        </div>
        <button
          className="btn btn-secondary"
          style={{ marginTop: '12px' }}
          onClick={() => navigate('gifts')}
        >
          Done
        </button>
      </div>
    );
  }

  return (
    <div>
      <h2 className="page-title">Gift Tokens</h2>
      <p className="page-subtitle">
        Share token access without sharing your API key.
        Requests are relayed through your extension.
      </p>

      {error && <div className="error">{error}</div>}

      {credentials.length === 0 ? (
        <div className="empty-state">
          <p>Add a credential first before gifting tokens.</p>
          <button
            className="btn btn-primary"
            style={{ width: 'auto' }}
            onClick={() => navigate('add-credential')}
          >
            Add credential
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="gift-credential">Credential</label>
            <select
              id="gift-credential"
              value={credentialId}
              onChange={(e) => setCredentialId(e.target.value)}
            >
              {credentials.map((c) => {
                const p = PROVIDERS[c.providerId];
                return (
                  <option key={c.id} value={c.id}>
                    {c.label} ({p?.name ?? c.providerId})
                  </option>
                );
              })}
            </select>
          </div>

          <div className="form-group">
            <label>Token budget</label>
            <div className="gift-budget-presets">
              {BUDGET_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className={`gift-preset-btn ${maxTokens === preset ? 'active' : ''}`}
                  onClick={() => setMaxTokens(preset)}
                >
                  {formatTokens(preset)}
                </button>
              ))}
            </div>
            <input
              type="number"
              value={maxTokens}
              onChange={(e) => setMaxTokens(Math.max(1, parseInt(e.target.value) || 0))}
              min={1}
              style={{ marginTop: '8px' }}
            />
            <p className="form-hint">
              Maximum tokens the recipient can use.
            </p>
          </div>

          <div className="form-group">
            <label htmlFor="gift-expiry">Expires in</label>
            <select
              id="gift-expiry"
              value={expiryMs}
              onChange={(e) => setExpiryMs(Number(e.target.value))}
            >
              {EXPIRY_OPTIONS.map((opt) => (
                <option key={opt.ms} value={opt.ms}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="gift-relay">Relay server</label>
            <input
              id="gift-relay"
              type="text"
              value={relayUrl}
              onChange={(e) => setRelayUrl(e.target.value)}
              placeholder="wss://relay.byoky.com"
            />
            <p className="form-hint">
              WebSocket relay that connects sender and recipient.
              Self-host or use the default.
            </p>
          </div>

          <div className="gift-security-note">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              <path d="M9 12l2 2 4-4" />
            </svg>
            <span>
              Your API key never leaves your extension. All requests from the recipient
              are relayed through your wallet and proxied to the provider.
            </span>
          </div>

          {selectedCred?.authMethod === 'oauth' && (
            <div className="warning-box">
              <strong>Browser and Bridge must stay online.</strong> This credential
              is a setup token that requires the Byoky Bridge. Gift recipients can
              only use this gift while your browser is running, the extension is
              active, and the Bridge is installed — even with Cloud Vault enabled.
            </div>
          )}

          {cloudVaultEnabled && selectedCred?.authMethod !== 'oauth' && (
            <div className="info-box">
              <strong>Cloud Vault fallback enabled.</strong> When your browser
              is closed, the vault server will handle gift requests automatically.
            </div>
          )}

          {!cloudVaultEnabled && selectedCred?.authMethod !== 'oauth' && (
            <div className="warning-box">
              <strong>Device must stay online.</strong> Since Cloud Vault is off,
              gift recipients can only use this gift while your browser is running
              and this extension is active.
            </div>
          )}

          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => navigate('gifts')}
            >
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={submitting || !credentialId}>
              {submitting ? 'Creating...' : 'Create Gift'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
