import { useState, type FormEvent } from 'react';
import { useWalletStore } from '../store';
import { PROVIDERS } from '@byoky/core';

const providerOptions = Object.values(PROVIDERS);

export function AddCredential() {
  const { addApiKey, navigate, error } = useWalletStore();
  const [providerId, setProviderId] = useState('anthropic');
  const [label, setLabel] = useState('');
  const [apiKey, setApiKey] = useState('');

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!apiKey.trim() || !label.trim()) return;
    addApiKey(providerId, label.trim(), apiKey.trim());
  }

  return (
    <div>
      <h2 className="page-title">Add Credential</h2>
      <p className="page-subtitle">Add an API key for an LLM provider.</p>

      {error && <div className="error">{error}</div>}

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="provider">Provider</label>
          <select
            id="provider"
            value={providerId}
            onChange={(e) => setProviderId(e.target.value)}
          >
            {providerOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

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

        <div className="form-group">
          <label htmlFor="apiKey">API Key</label>
          <textarea
            id="apiKey"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-..."
            rows={3}
          />
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => navigate('dashboard')}
          >
            Cancel
          </button>
          <button type="submit" className="btn btn-primary">
            Save
          </button>
        </div>
      </form>
    </div>
  );
}
