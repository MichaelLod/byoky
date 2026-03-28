import { useState, useRef, type FormEvent } from 'react';
import { useWalletStore } from '../store';
import {
  checkPasswordStrength,
  MIN_PASSWORD_LENGTH,
} from '@byoky/core';

async function sendInternal(action: string, payload?: unknown): Promise<Record<string, unknown>> {
  return browser.runtime.sendMessage({
    type: 'BYOKY_INTERNAL',
    action,
    payload,
  }) as Promise<Record<string, unknown>>;
}
import { PasswordMeter } from '../components/PasswordMeter';

export function Settings() {
  const {
    credentials, navigate, lock,
    cloudVaultEnabled, cloudVaultUsername, cloudVaultTokenExpired, cloudVaultPendingCount,
    disableCloudVault,
  } = useWalletStore();
  const [modal, setModal] = useState<'export' | 'import' | 'cloud-vault' | 'cloud-vault-relogin' | null>(null);

  if (modal === 'export') {
    return <ExportModal onClose={() => setModal(null)} />;
  }

  if (modal === 'import') {
    return <ImportModal onClose={() => setModal(null)} />;
  }

  if (modal === 'cloud-vault') {
    return <CloudVaultModal onClose={() => setModal(null)} />;
  }

  if (modal === 'cloud-vault-relogin') {
    return <CloudVaultReloginModal onClose={() => setModal(null)} />;
  }

  return (
    <div>
      <h2 className="page-title">Settings</h2>

      <div className="settings-section">
        <h3>Vault</h3>
        <div className="settings-actions">
          <button
            className="btn btn-secondary"
            onClick={() => setModal('export')}
            disabled={credentials.length === 0}
          >
            Export Vault
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => setModal('import')}
          >
            Import Vault
          </button>
        </div>
        {credentials.length === 0 && (
          <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px' }}>
            Add credentials before exporting.
          </p>
        )}
      </div>

      <div className="settings-section">
        <h3>Cloud Vault</h3>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
            Sync credentials to the cloud
          </span>
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={cloudVaultEnabled}
              onChange={() => {
                if (cloudVaultEnabled) {
                  disableCloudVault();
                } else {
                  setModal('cloud-vault');
                }
              }}
            />
            <span className="toggle-slider" />
          </label>
        </div>
        {cloudVaultEnabled && (
          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            <p style={{ margin: '0 0 4px' }}>Synced as {cloudVaultUsername}</p>
            {cloudVaultTokenExpired && (
              <div className="warning-box" style={{ marginTop: '8px' }}>
                <strong>Session expired</strong> — your credentials are safe but
                new changes won&apos;t sync until you re-login.
                <button
                  className="btn btn-secondary"
                  style={{ marginTop: '8px', width: '100%', fontSize: '12px' }}
                  onClick={() => setModal('cloud-vault-relogin')}
                >
                  Re-login
                </button>
              </div>
            )}
            {!cloudVaultTokenExpired && cloudVaultPendingCount > 0 && (
              <p style={{ color: 'var(--accent)', margin: '4px 0 0' }}>
                {cloudVaultPendingCount} credential{cloudVaultPendingCount !== 1 ? 's' : ''} pending sync
              </p>
            )}
          </div>
        )}
        {!cloudVaultEnabled && (
          <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
            Websites can use your keys even when this device is offline.
          </p>
        )}
      </div>

      <div className="settings-section">
        <h3>Security</h3>
        <div className="settings-actions">
          <button className="btn btn-secondary" onClick={() => lock()}>
            Lock Wallet
          </button>
        </div>
      </div>

      <button
        className="btn btn-secondary"
        style={{ marginTop: '8px' }}
        onClick={() => navigate('dashboard')}
      >
        Back
      </button>

    </div>
  );
}

function ExportModal({ onClose }: { onClose: () => void }) {
  const [exportPassword, setExportPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);

  const strength = checkPasswordStrength(exportPassword);

  async function handleExport(e: FormEvent) {
    e.preventDefault();
    setError('');

    if (exportPassword.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
      return;
    }
    if (strength.score < 2) {
      setError('Password is too weak');
      return;
    }
    if (exportPassword !== confirm) {
      setError('Passwords do not match');
      return;
    }

    setExporting(true);
    try {
      const exportResult = await sendInternal('exportVault', { exportPassword });
      if (exportResult.error) throw new Error(exportResult.error as string);

      // Download as .byoky file
      const blob = new Blob([exportResult.encryptedVault as string], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `byoky-vault-${new Date().toISOString().slice(0, 10)}.byoky`;
      a.click();
      URL.revokeObjectURL(url);

      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div>
      <h2 className="page-title">Export Vault</h2>
      <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '12px' }}>
        Choose a password to encrypt your backup file. You&apos;ll need this
        password to import it later.
      </p>

      {error && <div className="error">{error}</div>}

      <form onSubmit={handleExport}>
        <div className="form-group">
          <label htmlFor="export-pw">Export password</label>
          <input
            id="export-pw"
            type="password"
            value={exportPassword}
            onChange={(e) => setExportPassword(e.target.value)}
            placeholder="At least 12 characters"
            autoFocus
          />
          {exportPassword.length > 0 && <PasswordMeter strength={strength} />}
        </div>

        <div className="form-group">
          <label htmlFor="export-confirm">Confirm password</label>
          <input
            id="export-confirm"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Repeat password"
          />
        </div>

        <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
          <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            style={{ flex: 1 }}
            disabled={exporting || exportPassword.length < MIN_PASSWORD_LENGTH || strength.score < 2}
          >
            {exporting ? 'Exporting...' : 'Export'}
          </button>
        </div>
      </form>
    </div>
  );
}

function ImportModal({ onClose }: { onClose: () => void }) {
  const { refreshData } = useWalletStore();
  const [importPassword, setImportPassword] = useState('');
  const [fileData, setFileData] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const MAX_IMPORT_SIZE = 10 * 1024 * 1024; // 10MB
    if (file.size > MAX_IMPORT_SIZE) {
      setError('File too large (max 10MB)');
      return;
    }
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = () => {
      setFileData(reader.result as string);
    };
    reader.readAsText(file);
  }

  async function handleImport(e: FormEvent) {
    e.preventDefault();
    setError('');

    if (!fileData) {
      setError('Please select a .byoky file');
      return;
    }
    if (!importPassword) {
      setError('Enter the export password');
      return;
    }
    if (!confirmed) {
      setError('Please confirm you want to replace your vault');
      return;
    }

    setImporting(true);
    try {
      const importResult = await sendInternal('importVault', {
        encryptedVault: fileData,
        importPassword,
      });
      if (importResult.error) {
        setError(importResult.error as string);
        setImporting(false);
        return;
      }
      await refreshData();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div>
      <h2 className="page-title">Import Vault</h2>
      <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '12px' }}>
        Import a .byoky backup file. This will <strong>replace</strong> all
        existing credentials.
      </p>

      {error && <div className="error">{error}</div>}

      <form onSubmit={handleImport}>
        <div className="form-group">
          <label>Vault file</label>
          <input
            ref={fileRef}
            type="file"
            accept=".byoky"
            onChange={handleFileSelect}
            style={{ display: 'none' }}
          />
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => fileRef.current?.click()}
            style={{ width: '100%', fontSize: '13px' }}
          >
            {fileName || 'Choose .byoky file'}
          </button>
        </div>

        <div className="form-group">
          <label htmlFor="import-pw">Export password</label>
          <input
            id="import-pw"
            type="password"
            value={importPassword}
            onChange={(e) => setImportPassword(e.target.value)}
            placeholder="Password used during export"
          />
        </div>

        <div className="warning-box">
          <strong>Warning:</strong> Importing will replace all existing
          credentials in your wallet. This cannot be undone.
        </div>

        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            marginTop: '12px',
            fontSize: '12px',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          I understand this will replace my vault
        </label>

        <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
          <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            style={{ flex: 1 }}
            disabled={importing || !fileData || !importPassword || !confirmed}
          >
            {importing ? 'Importing...' : 'Import'}
          </button>
        </div>
      </form>
    </div>
  );
}

function CloudVaultModal({ onClose }: { onClose: () => void }) {
  const { enableCloudVault, loading, error, clearError } = useWalletStore();
  const [step, setStep] = useState<'warning' | 'auth'>('warning');
  const [understood, setUnderstood] = useState(false);
  const [isSignup, setIsSignup] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const strength = checkPasswordStrength(password);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    clearError();

    if (!username || !password) return;
    if (isSignup && password.length < MIN_PASSWORD_LENGTH) return;
    if (isSignup && strength.score < 2) return;

    await enableCloudVault(username, password, isSignup);
    if (!useWalletStore.getState().error) {
      onClose();
    }
  }

  return (
    <div>
      <h2 className="page-title">
        {step === 'warning' ? 'Cloud Vault' : isSignup ? 'Create Vault Account' : 'Login to Vault'}
      </h2>

      {step === 'warning' ? (
        <>
          <div className="warning-box">
            <p style={{ margin: '0 0 8px' }}>
              <strong>Your keys will leave this device.</strong>
            </p>
            <p style={{ margin: '0 0 8px' }}>
              When Cloud Vault is enabled, your API keys are sent to
              vault.byoky.com over an encrypted connection and stored with
              AES-256-GCM encryption using a key derived from your vault
              password.
            </p>
            <p style={{ margin: 0 }}>
              This means websites can use your credentials even when this device
              is offline — but your keys will be stored on a remote server.
            </p>
          </div>

          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              marginTop: '12px',
              fontSize: '12px',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={understood}
              onChange={(e) => setUnderstood(e.target.checked)}
            />
            I understand my keys will be stored on a remote server
          </label>

          <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
            <button className="btn btn-secondary" style={{ flex: 1 }} onClick={onClose}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              style={{ flex: 1 }}
              disabled={!understood}
              onClick={() => setStep('auth')}
            >
              Continue
            </button>
          </div>
        </>
      ) : (
        <>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
            <button
              type="button"
              className={`btn ${isSignup ? 'btn-primary' : 'btn-secondary'}`}
              style={{ flex: 1, fontSize: '12px' }}
              onClick={() => { setIsSignup(true); clearError(); }}
            >
              Sign Up
            </button>
            <button
              type="button"
              className={`btn ${!isSignup ? 'btn-primary' : 'btn-secondary'}`}
              style={{ flex: 1, fontSize: '12px' }}
              onClick={() => { setIsSignup(false); clearError(); }}
            >
              Login
            </button>
          </div>

          {error && <div className="error">{error}</div>}

          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="vault-username">Username</label>
              <input
                id="vault-username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Choose a username"
                autoComplete="username"
                autoFocus
              />
            </div>

            <div className="form-group">
              <label htmlFor="vault-pw">Password</label>
              <input
                id="vault-pw"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={isSignup ? 'At least 12 characters' : 'Your vault password'}
              />
              {isSignup && password.length > 0 && <PasswordMeter strength={strength} />}
            </div>

            <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
              <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={onClose}>
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                style={{ flex: 1 }}
                disabled={
                  loading ||
                  !username ||
                  !password ||
                  (isSignup && (password.length < MIN_PASSWORD_LENGTH || strength.score < 2))
                }
              >
                {loading ? 'Connecting...' : isSignup ? 'Sign Up' : 'Login'}
              </button>
            </div>
          </form>
        </>
      )}
    </div>
  );
}

function CloudVaultReloginModal({ onClose }: { onClose: () => void }) {
  const { cloudVaultUsername, reloginCloudVault, loading, error, clearError } = useWalletStore();
  const [password, setPassword] = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    clearError();
    if (!password) return;
    await reloginCloudVault(password);
    if (!useWalletStore.getState().error) {
      onClose();
    }
  }

  return (
    <div>
      <h2 className="page-title">Re-login to Cloud Vault</h2>
      <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '12px' }}>
        Your session has expired. Enter your vault password to reconnect.
      </p>

      {error && <div className="error">{error}</div>}

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="relogin-username">Username</label>
          <input
            id="relogin-username"
            type="text"
            value={cloudVaultUsername ?? ''}
            disabled
          />
        </div>

        <div className="form-group">
          <label htmlFor="relogin-pw">Password</label>
          <input
            id="relogin-pw"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Your vault password"
            autoFocus
          />
        </div>

        <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
          <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            style={{ flex: 1 }}
            disabled={loading || !password}
          >
            {loading ? 'Logging in...' : 'Login'}
          </button>
        </div>
      </form>
    </div>
  );
}
