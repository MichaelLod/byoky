import { useState, useRef, type FormEvent } from 'react';
import { useWalletStore } from '../store';
import {
  checkPasswordStrength,
  MIN_PASSWORD_LENGTH,
} from '@byoky/core';
import { PasswordMeter } from '../components/PasswordMeter';

async function sendInternal(action: string, payload?: unknown): Promise<Record<string, unknown>> {
  return browser.runtime.sendMessage({
    type: 'BYOKY_INTERNAL',
    action,
    payload,
  }) as Promise<Record<string, unknown>>;
}

export function Settings() {
  const { credentials, navigate, lock, resetWallet, loading } = useWalletStore();
  const [modal, setModal] = useState<'export' | 'import' | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  if (modal === 'export') {
    return <ExportModal onClose={() => setModal(null)} />;
  }

  if (modal === 'import') {
    return <ImportModal onClose={() => setModal(null)} />;
  }

  return (
    <div>
      <h2 className="page-title">Settings</h2>

      <div className="settings-section">
        <h3>Backup</h3>
        <div className="settings-actions">
          <button
            className="btn btn-secondary"
            onClick={() => setModal('export')}
            disabled={credentials.length === 0}
          >
            Export backup
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => setModal('import')}
          >
            Import backup
          </button>
        </div>
        <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px' }}>
          {credentials.length === 0
            ? 'Add credentials before exporting.'
            : 'Keys live only on this device. Export an encrypted .byoky file to back them up or move them to another device.'}
        </p>
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
          <button
            className="btn btn-secondary"
            style={{ borderColor: 'var(--error, #ef4444)', color: 'var(--error, #ef4444)' }}
            onClick={() => setConfirmReset(true)}
            disabled={loading}
          >
            Reset Wallet
          </button>
        </div>
        <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px' }}>
          Reset wallet clears all keys on this device. This cannot be undone.
        </p>
      </div>

      <button
        className="btn btn-secondary"
        style={{ marginTop: '8px' }}
        onClick={() => navigate('dashboard')}
      >
        Back
      </button>

      {confirmReset && (
        <ConfirmResetModal
          onCancel={() => setConfirmReset(false)}
          onConfirm={async () => {
            await resetWallet();
            setConfirmReset(false);
          }}
        />
      )}

    </div>
  );
}

function ConfirmResetModal({
  onCancel, onConfirm,
}: {
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

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
        <h3 style={{ margin: '0 0 8px', color: 'var(--error, #ef4444)', fontSize: '15px' }}>Reset Wallet?</h3>
        <p style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.5, margin: '0 0 16px' }}>
          All keys on this device will be permanently deleted. This cannot be undone.
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
            {busy ? 'Working...' : 'Reset'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ExportModal({ onClose }: { onClose: () => void }) {
  // Re-entered wallet password. Lives only in this form and is sent once in
  // the export request; the background checks it against the stored hash.
  const [currentPassword, setCurrentPassword] = useState('');
  const [exportPassword, setExportPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);

  const strength = checkPasswordStrength(exportPassword);

  async function handleExport(e: FormEvent) {
    e.preventDefault();
    setError('');

    if (!currentPassword) {
      setError('Enter your wallet password');
      return;
    }
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
      const exportResult = await sendInternal('exportVault', { exportPassword, currentPassword });
      if (exportResult.error) throw new Error(exportResult.error as string);

      // Download as .byoky file
      const blob = new Blob([exportResult.encryptedVault as string], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `byoky-backup-${new Date().toISOString().slice(0, 10)}.byoky`;
      a.click();
      URL.revokeObjectURL(url);

      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCurrentPassword('');
      setExporting(false);
    }
  }

  return (
    <div>
      <h2 className="page-title">Export backup</h2>
      <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '12px' }}>
        Confirm your wallet password, then choose a password to encrypt the
        backup file. You&apos;ll need the export password to import it later,
        on this device or another one.
      </p>

      {error && <div className="error">{error}</div>}

      <form onSubmit={handleExport}>
        <div className="form-group">
          <label htmlFor="export-current-pw">Wallet password</label>
          <input
            id="export-current-pw"
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder="The password you unlock Byoky with"
            autoComplete="current-password"
            autoFocus
          />
        </div>

        <div className="form-group">
          <label htmlFor="export-pw">Export password</label>
          <input
            id="export-pw"
            type="password"
            value={exportPassword}
            onChange={(e) => setExportPassword(e.target.value)}
            placeholder="At least 12 characters"
            autoComplete="new-password"
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
            disabled={exporting || !currentPassword || exportPassword.length < MIN_PASSWORD_LENGTH || strength.score < 2}
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
  const [summary, setSummary] = useState<{ added: number; duplicates: number; rejected: number } | null>(null);
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
      const skipped = (importResult.skipped as number) ?? 0;
      const rejected = (importResult.rejected as number) ?? 0;
      setSummary({
        added: (importResult.count as number) ?? 0,
        duplicates: skipped - rejected,
        rejected,
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setImporting(false);
    }
  }

  if (summary) {
    return (
      <div>
        <h2 className="page-title">Import backup</h2>
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
          {summary.added === 0
            ? 'No new credentials found in the file.'
            : `Added ${summary.added} credential${summary.added !== 1 ? 's' : ''}.`}
          {summary.duplicates > 0 && ` ${summary.duplicates} already in your wallet ${summary.duplicates !== 1 ? 'were' : 'was'} skipped.`}
          {summary.rejected > 0 && ` ${summary.rejected} unsupported or unsafe ${summary.rejected !== 1 ? 'entries were' : 'entry was'} skipped.`}
        </p>
        <button type="button" className="btn btn-primary" style={{ width: '100%' }} onClick={onClose}>
          Done
        </button>
      </div>
    );
  }

  return (
    <div>
      <h2 className="page-title">Import backup</h2>
      <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '12px' }}>
        Import a .byoky backup file. Its credentials are added to your wallet;
        keys you already have stay as they are, and duplicates are skipped.
      </p>

      {error && <div className="error">{error}</div>}

      <form onSubmit={handleImport}>
        <div className="form-group">
          <label>Backup file</label>
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

        <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
          <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            style={{ flex: 1 }}
            disabled={importing || !fileData || !importPassword}
          >
            {importing ? 'Importing...' : 'Import'}
          </button>
        </div>
      </form>
    </div>
  );
}
