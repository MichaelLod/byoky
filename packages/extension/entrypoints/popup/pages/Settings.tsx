import { useState, useRef, type FormEvent } from 'react';
import { useWalletStore, getSessionPasswordForExport } from '../store';
import {
  encrypt,
  decrypt,
  checkPasswordStrength,
  MIN_PASSWORD_LENGTH,
} from '@byoky/core';
import { PasswordMeter } from '../components/PasswordMeter';

const VAULT_VERSION = 1;

interface VaultExport {
  version: number;
  exportedAt: number;
  credentials: unknown[];
}

export function Settings() {
  const { credentials, navigate, lock } = useWalletStore();
  const [modal, setModal] = useState<'export' | 'import' | null>(null);

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

      {modal === 'export' && <ExportModal onClose={() => setModal(null)} />}
      {modal === 'import' && <ImportModal onClose={() => setModal(null)} />}
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
      // Get raw credentials from storage
      const data = await browser.storage.local.get('credentials');
      const rawCredentials = (data.credentials ?? []) as unknown[];

      // Re-encrypt each credential with the export password
      const sessionPw = await getSessionPasswordForExport();
      const reEncrypted = await Promise.all(
        rawCredentials.map(async (cred: unknown) => {
          const c = cred as Record<string, unknown>;
          const result = { ...c };

          if (c.encryptedKey && typeof c.encryptedKey === 'string') {
            const plainKey = await decrypt(c.encryptedKey, sessionPw);
            result.encryptedKey = await encrypt(plainKey, exportPassword);
          }
          if (c.encryptedAccessToken && typeof c.encryptedAccessToken === 'string') {
            const plainToken = await decrypt(c.encryptedAccessToken, sessionPw);
            result.encryptedAccessToken = await encrypt(plainToken, exportPassword);
          }

          return result;
        }),
      );

      const vault: VaultExport = {
        version: VAULT_VERSION,
        exportedAt: Date.now(),
        credentials: reEncrypted,
      };

      // Encrypt the entire vault JSON with the export password
      const vaultJson = JSON.stringify(vault);
      const encryptedVault = await encrypt(vaultJson, exportPassword);

      // Download as .byoky file
      const blob = new Blob([encryptedVault], { type: 'application/octet-stream' });
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
    <div className="export-modal-overlay" onClick={onClose}>
      <div className="export-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Export Vault</h3>
        <p>
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

          <div className="export-modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={exporting || exportPassword.length < MIN_PASSWORD_LENGTH || strength.score < 2}
            >
              {exporting ? 'Exporting...' : 'Export'}
            </button>
          </div>
        </form>
      </div>
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
      // Decrypt the vault file
      let vaultJson: string;
      try {
        vaultJson = await decrypt(fileData.trim(), importPassword);
      } catch {
        setError('Wrong password or corrupted file');
        setImporting(false);
        return;
      }

      const vault = JSON.parse(vaultJson) as VaultExport;
      if (!vault.version || !vault.credentials) {
        setError('Invalid vault file format');
        setImporting(false);
        return;
      }

      // Re-encrypt each credential with the current session password
      const sessionPw = await getSessionPasswordForExport();
      const reEncrypted = await Promise.all(
        vault.credentials.map(async (cred: unknown) => {
          const c = cred as Record<string, unknown>;
          const result = { ...c, id: crypto.randomUUID() }; // new IDs to avoid conflicts

          if (c.encryptedKey && typeof c.encryptedKey === 'string') {
            const plainKey = await decrypt(c.encryptedKey, importPassword);
            result.encryptedKey = await encrypt(plainKey, sessionPw);
          }
          if (c.encryptedAccessToken && typeof c.encryptedAccessToken === 'string') {
            const plainToken = await decrypt(c.encryptedAccessToken, importPassword);
            result.encryptedAccessToken = await encrypt(plainToken, sessionPw);
          }

          return result;
        }),
      );

      // Replace vault
      await browser.storage.local.set({ credentials: reEncrypted });
      await refreshData();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="export-modal-overlay" onClick={onClose}>
      <div className="export-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Import Vault</h3>
        <p>
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

          <div className="export-modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={importing || !fileData || !importPassword || !confirmed}
            >
              {importing ? 'Importing...' : 'Import'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
