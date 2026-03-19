import { useState, useEffect, type FormEvent } from 'react';
import { useWalletStore } from '../store';
import { PROVIDERS } from '@byoky/core';

const providerOptions = Object.values(PROVIDERS);

async function checkBridge(): Promise<boolean> {
  try {
    const result = await browser.runtime.sendMessage({
      type: 'BYOKY_INTERNAL',
      action: 'checkBridge',
    });
    return result?.available ?? false;
  } catch {
    return false;
  }
}

export function AddCredential() {
  const { addApiKey, addSetupToken, startOAuth, navigate, error, loading } = useWalletStore();
  const [providerId, setProviderId] = useState('anthropic');
  const [authMethod, setAuthMethod] = useState<'api_key' | 'oauth'>('api_key');
  const [label, setLabel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [bridgeOnline, setBridgeOnline] = useState<boolean | null>(null);

  const provider = PROVIDERS[providerId];
  const supportsOAuth = provider?.authMethods.includes('oauth');
  const hasOAuthConfig = !!provider?.oauthConfig;

  useEffect(() => {
    if (authMethod === 'oauth' && !hasOAuthConfig) {
      checkBridge().then(setBridgeOnline);
    }
  }, [authMethod, hasOAuthConfig]);

  function handleProviderChange(id: string) {
    setProviderId(id);
    const p = PROVIDERS[id];
    if (!p?.authMethods.includes('oauth')) {
      setAuthMethod('api_key');
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!label.trim()) return;

    if (authMethod === 'oauth') {
      if (hasOAuthConfig) {
        startOAuth(providerId, label.trim());
      } else {
        if (!apiKey.trim()) return;
        addSetupToken(providerId, label.trim(), apiKey.trim());
      }
    } else {
      if (!apiKey.trim()) return;
      addApiKey(providerId, label.trim(), apiKey.trim());
    }
  }

  const apiKeyHints: Record<string, string> = {
    anthropic: 'console.anthropic.com',
    openai: 'platform.openai.com',
    gemini: 'aistudio.google.com',
    mistral: 'console.mistral.ai',
    cohere: 'dashboard.cohere.com',
    xai: 'console.x.ai',
    deepseek: 'platform.deepseek.com',
    perplexity: 'docs.perplexity.ai',
    groq: 'console.groq.com',
    together: 'api.together.ai',
    fireworks: 'fireworks.ai/account',
    replicate: 'replicate.com/account',
    openrouter: 'openrouter.ai/keys',
    huggingface: 'huggingface.co/settings/tokens',
    azure_openai: 'portal.azure.com',
  };
  const apiKeyHint = apiKeyHints[providerId] ?? 'your provider console';

  return (
    <div>
      <h2 className="page-title">Add Credential</h2>
      <p className="page-subtitle">
        Add a credential for {provider?.name ?? 'an LLM provider'}.
      </p>

      {error && <div className="error">{error}</div>}

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="provider">Provider</label>
          <select
            id="provider"
            value={providerId}
            onChange={(e) => handleProviderChange(e.target.value)}
          >
            {providerOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        {supportsOAuth && (
          <div className="form-group">
            <label>Auth method</label>
            <div className="auth-method-toggle">
              <button
                type="button"
                className={`auth-toggle-btn ${authMethod === 'api_key' ? 'active' : ''}`}
                onClick={() => setAuthMethod('api_key')}
              >
                API Key
              </button>
              <button
                type="button"
                className={`auth-toggle-btn ${authMethod === 'oauth' ? 'active' : ''}`}
                onClick={() => setAuthMethod('oauth')}
              >
                Setup Token
              </button>
            </div>
            <p className="form-hint">
              {authMethod === 'api_key'
                ? 'Pay-per-use. Get one from your provider console.'
                : 'Uses your Claude Pro/Max subscription credits.'}
            </p>
          </div>
        )}

        <div className="form-group">
          <label htmlFor="label">Label</label>
          <input
            id="label"
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder='e.g., "Personal" or "Work"'
          />
        </div>

        {authMethod === 'api_key' ? (
          <div className="form-group">
            <label htmlFor="apiKey">API Key</label>
            <textarea
              id="apiKey"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={
                providerId === 'anthropic' ? 'sk-ant-api03-...'
                : providerId === 'openai' ? 'sk-...'
                : providerId === 'huggingface' ? 'hf_...'
                : providerId === 'replicate' ? 'r8_...'
                : 'Your API key'
              }
              rows={3}
            />
            <p className="form-hint">
              Get your API key from{' '}
              <a
                href={`https://${apiKeyHint}`}
                target="_blank"
                rel="noopener noreferrer"
                className="hint-link"
              >
                {apiKeyHint}
              </a>
            </p>
          </div>
        ) : hasOAuthConfig ? (
          <div className="oauth-info">
            <p>You'll be redirected to {provider?.name} to authorize access.</p>
          </div>
        ) : (
          <div className="form-group">
            <label htmlFor="apiKey">Setup Token</label>
            <textarea
              id="apiKey"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-ant-oat01-..."
              rows={3}
            />
            <div className="oauth-info" style={{ marginTop: '8px' }}>
              <p style={{ marginBottom: '6px', fontWeight: 500, color: 'var(--text)' }}>
                How to get a setup token:
              </p>
              <ol className="setup-steps">
                <li>Open your terminal</li>
                <li>
                  Run <code>claude setup-token</code>
                </li>
                <li>Copy the token and paste it above</li>
              </ol>
              <p style={{ marginTop: '8px', fontSize: '11px', color: 'var(--text-muted)' }}>
                Requires Claude Code CLI and an active Claude Pro or Max subscription.
              </p>
            </div>
            {bridgeOnline === false && (
              <div className="warning-note" style={{ marginTop: '10px' }}>
                <strong>Byoky Bridge required.</strong> Setup tokens route through
                Claude Code CLI via the bridge. Install it:
                <code style={{ display: 'block', marginTop: '6px' }}>
                  npm i -g @byoky/bridge && byoky-bridge install
                </code>
              </div>
            )}
            {bridgeOnline === true && (
              <>
                <div className="bridge-status online" style={{ marginTop: '10px' }}>
                  Bridge connected
                </div>
                <p style={{ marginTop: '8px', fontSize: '11px', color: 'var(--text-muted)', lineHeight: '1.5' }}>
                  <strong style={{ color: 'var(--text-secondary)' }}>Security note:</strong> Setup
                  tokens are decrypted and sent to the local Byoky Bridge process
                  via native messaging to authenticate with Claude Code CLI.
                  The token is held in memory only and never written to disk.
                </p>
              </>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => navigate('dashboard')}
          >
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {authMethod === 'oauth' && hasOAuthConfig
              ? `Sign in with ${provider?.name}`
              : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}
