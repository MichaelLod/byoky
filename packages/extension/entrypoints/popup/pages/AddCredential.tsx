import { useState, useEffect, type FormEvent } from 'react';
import { useWalletStore } from '../store';
import { PROVIDERS } from '@byoky/core';
import { ProviderIcon } from '../components/ProviderIcon';

const providerOptions = Object.values(PROVIDERS);

async function checkBridge(): Promise<boolean> {
  try {
    const result = await browser.runtime.sendMessage({
      type: 'BYOKY_INTERNAL',
      action: 'checkBridge',
    }) as Record<string, unknown> | undefined;
    return (result?.available as boolean) ?? false;
  } catch {
    return false;
  }
}

const LOCAL_PROVIDER_DEFAULT_BASE_URL: Record<string, string> = {
  ollama: 'http://localhost:11434',
  lm_studio: 'http://localhost:1234',
};

export function AddCredential() {
  const { addApiKey, addSetupToken, closeModal, error, loading, clearError } = useWalletStore();
  const [providerId, setProviderId] = useState('anthropic');
  const [authMethod, setAuthMethod] = useState<'api_key' | 'oauth'>('api_key');
  const [label, setLabel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [bridgeOnline, setBridgeOnline] = useState<boolean | null>(null);

  const provider = PROVIDERS[providerId];
  const supportsOAuth = provider?.authMethods.includes('oauth');
  const isLocalProvider = providerId === 'ollama' || providerId === 'lm_studio';
  const requiresBaseUrl = provider?.requiresCustomBaseUrl === true;

  useEffect(() => {
    if (authMethod === 'oauth') {
      checkBridge().then(setBridgeOnline);
    }
  }, [authMethod]);

  function handleProviderChange(id: string) {
    setProviderId(id);
    clearError();
    const p = PROVIDERS[id];
    if (!p?.authMethods.includes('oauth')) {
      setAuthMethod('api_key');
    }
    // Swap in the new provider's loopback default (or clear the field), but
    // keep a URL the user typed themselves.
    if (!baseUrl || Object.values(LOCAL_PROVIDER_DEFAULT_BASE_URL).includes(baseUrl)) {
      setBaseUrl(LOCAL_PROVIDER_DEFAULT_BASE_URL[id] ?? '');
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!label.trim()) return;

    const cleanKey = apiKey.replace(/\s+/g, '');
    const cleanBaseUrl = baseUrl.trim().replace(/\/$/, '');

    if (requiresBaseUrl && !cleanBaseUrl) return;

    if (authMethod === 'oauth') {
      if (!cleanKey) return;
      addSetupToken(providerId, label.trim(), cleanKey);
    } else {
      // Local providers run unauthenticated — allow an empty key.
      if (!isLocalProvider && !cleanKey) return;
      addApiKey(providerId, label.trim(), cleanKey, cleanBaseUrl || undefined);
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
    openrouter: 'openrouter.ai/keys',
    azure_openai: 'portal.azure.com',
  };
  const apiKeyHint = apiKeyHints[providerId] ?? 'your provider console';

  return (
    <div>
      <p className="page-subtitle">
        Add a credential for {provider?.name ?? 'an LLM provider'}.
      </p>

      {error && <div className="error">{error}</div>}

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="provider">Provider</label>
          <div className="provider-field">
            <div className="provider-icon-box">
              <ProviderIcon providerId={providerId} size={22} />
            </div>
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

        {requiresBaseUrl && (
          <>
            <div className="form-group">
              <label htmlFor="baseUrl">
                {providerId === 'azure_openai' ? 'Endpoint URL' : 'Server URL'}
              </label>
              <input
                id="baseUrl"
                type="text"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder={
                  LOCAL_PROVIDER_DEFAULT_BASE_URL[providerId] ??
                  (providerId === 'azure_openai'
                    ? 'https://your-resource.openai.azure.com'
                    : '')
                }
              />
              <p className="form-hint">
                {providerId === 'ollama'
                  ? 'Where your Ollama server is running. Make sure `ollama serve` is active.'
                  : providerId === 'lm_studio'
                  ? 'Where your LM Studio server is running. Start the "Local Server" in LM Studio.'
                  : 'Your Azure OpenAI resource endpoint.'}
              </p>
            </div>
            {isLocalProvider && (
              <div className="warning-note" style={{ marginTop: '10px', marginBottom: '12px' }}>
                <strong>The server must be running.</strong> The wallet calls it
                directly, so this credential only works while it's up.{' '}
                {providerId === 'ollama' ? (
                  <>
                    Ollama also has to allow this extension's origin:
                    <code style={{ display: 'block', marginTop: '6px', wordBreak: 'break-all' }}>
                      OLLAMA_ORIGINS={window.location.origin} ollama serve
                    </code>
                  </>
                ) : (
                  <>Turn on CORS in LM Studio's server settings (or run <code>lms server start --cors</code>).</>
                )}
              </div>
            )}
          </>
        )}

        {authMethod === 'api_key' ? (
          <div className="form-group">
            <label htmlFor="apiKey">
              API Key{isLocalProvider ? ' (optional)' : ''}
            </label>
            <textarea
              id="apiKey"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={
                providerId === 'anthropic' ? 'sk-ant-api03-...'
                : providerId === 'openai' ? 'sk-...'
                : isLocalProvider ? 'Leave blank if your server has no auth'
                : 'Your API key'
              }
              rows={isLocalProvider ? 2 : 3}
            />
            {!isLocalProvider && (
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
            )}
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
            <div className="warning-note" style={{ marginTop: '10px' }}>
              <strong>Online only.</strong> Setup tokens proxy through this
              extension and the local Byoky Bridge. If the browser or bridge
              isn't running, apps using this credential will get 401.
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
            onClick={closeModal}
          >
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            Save
          </button>
        </div>
      </form>
    </div>
  );
}
