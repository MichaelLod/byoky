import { useState, useRef, useEffect, useCallback, type FormEvent } from 'react';
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
    disableCloudVault, deleteVaultAccount, resetWallet, loading,
  } = useWalletStore();
  const [modal, setModal] = useState<'export' | 'import' | 'cloud-vault' | 'cloud-vault-relogin' | null>(null);
  const [confirm, setConfirm] = useState<'delete-account' | 'reset-wallet' | null>(null);

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

      <div className="settings-section">
        <h3 style={{ color: 'var(--error, #ef4444)' }}>Danger Zone</h3>
        <div className="settings-actions" style={{ flexDirection: 'column', gap: '8px' }}>
          {cloudVaultEnabled && (
            <button
              className="btn btn-secondary"
              style={{ borderColor: 'var(--error, #ef4444)', color: 'var(--error, #ef4444)' }}
              onClick={() => setConfirm('delete-account')}
              disabled={loading}
            >
              Delete Vault Account
            </button>
          )}
          <button
            className="btn btn-secondary"
            style={{ borderColor: 'var(--error, #ef4444)', color: 'var(--error, #ef4444)' }}
            onClick={() => setConfirm('reset-wallet')}
            disabled={loading}
          >
            Reset Wallet
          </button>
        </div>
        <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px' }}>
          {cloudVaultEnabled
            ? 'Delete account removes your vault account and all synced keys from vault.byoky.com. Reset wallet clears only this device.'
            : 'Reset wallet clears all keys on this device. This cannot be undone.'}
        </p>
      </div>

      <button
        className="btn btn-secondary"
        style={{ marginTop: '8px' }}
        onClick={() => navigate('dashboard')}
      >
        Back
      </button>

      {confirm && (
        <ConfirmDestructiveModal
          kind={confirm}
          cloudVaultEnabled={cloudVaultEnabled}
          onCancel={() => setConfirm(null)}
          onConfirm={async () => {
            if (confirm === 'delete-account') {
              await deleteVaultAccount();
            } else {
              await resetWallet();
            }
            setConfirm(null);
          }}
        />
      )}

    </div>
  );
}

function ConfirmDestructiveModal({
  kind, cloudVaultEnabled, onCancel, onConfirm,
}: {
  kind: 'delete-account' | 'reset-wallet';
  cloudVaultEnabled: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  const title = kind === 'delete-account' ? 'Delete Vault Account?' : 'Reset Wallet?';
  const description =
    kind === 'delete-account'
      ? 'Your vault account and all synced keys will be permanently deleted from vault.byoky.com. This device will also be reset. This cannot be undone.'
      : cloudVaultEnabled
      ? 'All keys on this device will be cleared. Your vault account on vault.byoky.com will NOT be deleted — use "Delete Vault Account" for that.'
      : 'All keys on this device will be permanently deleted. This cannot be undone.';

  async function handleConfirm() {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        zIndex: 1000,
      }}
    >
      <div
        style={{
          background: 'var(--bg-card, #1a1a1a)',
          border: '1px solid var(--border, #333)',
          borderRadius: '10px',
          padding: '16px',
          maxWidth: '320px',
          width: '100%',
        }}
      >
        <h3 style={{ margin: '0 0 8px', color: 'var(--error, #ef4444)', fontSize: '15px' }}>{title}</h3>
        <p style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.5, margin: '0 0 16px' }}>
          {description}
        </p>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn"
            style={{
              flex: 1,
              background: 'var(--error, #ef4444)',
              color: 'white',
              border: 'none',
            }}
            onClick={handleConfirm}
            disabled={busy}
          >
            {busy ? 'Working...' : kind === 'delete-account' ? 'Delete' : 'Reset'}
          </button>
        </div>
      </div>
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
        existing credentials and gifts.
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
          credentials and gifts in your wallet. This cannot be undone.
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
  const [isSignup, setIsSignup] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [usernameStatus, setUsernameStatus] = useState<'idle' | 'checking' | 'available' | 'taken' | 'invalid'>('idle');
  const checkTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const strength = checkPasswordStrength(password);

  const checkUsername = useCallback((value: string) => {
    clearTimeout(checkTimer.current);
    const trimmed = value.toLowerCase().trim();
    if (!trimmed || trimmed.length < 3) {
      setUsernameStatus('idle');
      return;
    }
    if (!/^[a-z0-9][a-z0-9_-]{1,28}[a-z0-9]$/.test(trimmed)) {
      setUsernameStatus('invalid');
      return;
    }
    setUsernameStatus('checking');
    checkTimer.current = setTimeout(async () => {
      const result = await sendInternal('cloudVaultCheckUsername', { username: trimmed });
      if (result.available) {
        setUsernameStatus('available');
      } else {
        setUsernameStatus(result.reason === 'invalid' ? 'invalid' : 'taken');
      }
    }, 400);
  }, []);

  useEffect(() => () => clearTimeout(checkTimer.current), []);

  function handleUsernameChange(value: string) {
    setUsername(value);
    if (isSignup) checkUsername(value);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    clearError();

    if (!username || !password) return;
    if (isSignup && password.length < MIN_PASSWORD_LENGTH) return;
    if (isSignup && strength.score < 2) return;
    if (isSignup && usernameStatus === 'taken') return;

    await enableCloudVault(username, password, isSignup);
    if (!useWalletStore.getState().error) {
      onClose();
    }
  }

  return (
    <div>
      <h2 className="page-title">
        {isSignup ? 'Create Vault Account' : 'Login to Vault'}
      </h2>

      <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '0 0 12px', lineHeight: 1.5 }}>
        End-to-end encrypted with your password. We can't read your keys.
      </p>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
        <button
          type="button"
          className={`btn ${isSignup ? 'btn-primary' : 'btn-secondary'}`}
          style={{ flex: 1, fontSize: '12px' }}
          onClick={() => { setIsSignup(true); setUsernameStatus('idle'); clearError(); }}
        >
          Sign Up
        </button>
        <button
          type="button"
          className={`btn ${!isSignup ? 'btn-primary' : 'btn-secondary'}`}
          style={{ flex: 1, fontSize: '12px' }}
          onClick={() => { setIsSignup(false); setUsernameStatus('idle'); clearError(); }}
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
            onChange={(e) => handleUsernameChange(e.target.value)}
            placeholder="Choose a username"
            autoComplete="username"
            autoFocus
          />
          {isSignup && username.length >= 3 && (
            <p style={{
              fontSize: '11px',
              margin: '4px 0 0',
              color: usernameStatus === 'available' ? 'var(--success, #4caf50)'
                : usernameStatus === 'taken' ? 'var(--error, #ef4444)'
                : usernameStatus === 'invalid' ? 'var(--error, #ef4444)'
                : 'var(--text-muted)',
            }}>
              {usernameStatus === 'checking' && 'Checking availability...'}
              {usernameStatus === 'available' && 'Username is available'}
              {usernameStatus === 'taken' && 'Username is already taken'}
              {usernameStatus === 'invalid' && 'Letters, numbers, hyphens, underscores only (3-30 chars)'}
            </p>
          )}
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
              (isSignup && (password.length < MIN_PASSWORD_LENGTH || strength.score < 2)) ||
              (isSignup && (usernameStatus === 'taken' || usernameStatus === 'invalid'))
            }
          >
            {loading ? 'Connecting...' : isSignup ? 'Sign Up' : 'Login'}
          </button>
        </div>
      </form>
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
