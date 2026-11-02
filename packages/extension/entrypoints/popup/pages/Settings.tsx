import { useState, useRef, type FormEvent } from 'react';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { useWalletStore } from '../store';
import {
  checkPasswordStrength,
  MIN_PASSWORD_LENGTH,
} from '@byoky/core';
import { PasswordMeter } from '../components/PasswordMeter';
import { lockedUntilFrom, useLockoutCountdown } from '../hooks/useLockoutCountdown';
import { FormError, LockoutEndedStatus, LockoutError } from '../components/FormError';

async function sendInternal(action: string, payload?: unknown): Promise<Record<string, unknown>> {
  return browser.runtime.sendMessage({
    type: 'BYOKY_INTERNAL',
    action,
    payload,
  }) as Promise<Record<string, unknown>>;
}

export function Settings() {
  const { credentials, navigate, lock, resetWallet, submitting } = useWalletStore();
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
        <p className="settings-note">
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
        <h3 className="danger">Danger Zone</h3>
        <div className="settings-actions">
          <button
            className="btn btn-danger"
            onClick={() => setConfirmReset(true)}
            disabled={submitting}
          >
            Reset Wallet
          </button>
        </div>
        <p className="settings-note">
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
  const dialogRef = useRef<HTMLDivElement | null>(null);
  // Cancel first: the other button wipes the wallet. No Escape mid-reset.
  useDialogFocus(dialogRef, { onEscape: busy ? undefined : onCancel, initialFocus: '[data-initial-focus]' });

  async function handleConfirm() {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dialog-backdrop">
      <div ref={dialogRef} className="dialog" role="alertdialog" aria-modal="true" aria-label="Reset Wallet?" tabIndex={-1}>
        <h3 className="dialog-title danger">Reset Wallet?</h3>
        <p className="dialog-text">
          All keys on this device will be permanently deleted. This cannot be undone.
        </p>
        <div className="dialog-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy} data-initial-focus>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-danger"
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
  const [error, setErrorText] = useState('');
  // The field the error is about: the wallet password (also when the
  // background refuses it), the new export password, or its confirmation.
  const [errorField, setErrorField] = useState<'current' | 'export' | 'confirm'>('current');
  const [exporting, setExporting] = useState(false);
  // Set when a lockout ran out, for screen readers, until the next try.
  const [lockoutEnded, setLockoutEnded] = useState(false);
  // Export re-authentication shares the unlock lockout.
  const { lockedUntil, setLockedUntil } = useWalletStore();
  const lockoutSeconds = useLockoutCountdown(lockedUntil, () => {
    setLockedUntil(null);
    setError('');
    setLockoutEnded(true);
  });
  const lockedOut = lockoutSeconds > 0;
  const hasError = lockedOut || !!error;

  function setError(text: string, field: 'current' | 'export' | 'confirm' = 'current') {
    setErrorText(text);
    setErrorField(field);
  }

  /** Marks the field the error is about, and points it at the error. */
  function fieldError(field: 'current' | 'export' | 'confirm') {
    const invalid = hasError && (lockedOut ? field === 'current' : errorField === field);
    return { 'aria-invalid': invalid, 'aria-describedby': invalid ? 'export-error' : undefined };
  }

  const strength = checkPasswordStrength(exportPassword);

  async function handleExport(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLockoutEnded(false);

    if (!currentPassword) {
      setError('Enter your wallet password');
      return;
    }
    if (exportPassword.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`, 'export');
      return;
    }
    if (strength.score < 2) {
      setError('Password is too weak', 'export');
      return;
    }
    if (exportPassword !== confirm) {
      setError('Passwords do not match', 'confirm');
      return;
    }

    setExporting(true);
    try {
      const exportResult = await sendInternal('exportVault', { exportPassword, currentPassword });
      if (exportResult.error) {
        const until = lockedUntilFrom(exportResult);
        if (until) setLockedUntil(until);
        throw new Error(exportResult.error as string);
      }

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

      {lockedOut
        ? <LockoutError key={lockedUntil} id="export-error" seconds={lockoutSeconds} />
        : error && <FormError id="export-error">{error}</FormError>}
      <LockoutEndedStatus ended={lockoutEnded} />

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
            {...fieldError('current')}
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
            {...fieldError('export')}
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
            {...fieldError('confirm')}
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
            disabled={exporting || lockedOut || !currentPassword || exportPassword.length < MIN_PASSWORD_LENGTH || strength.score < 2}
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
  const [error, setErrorText] = useState('');
  // The file pick or the password: what the error is about.
  const [errorField, setErrorField] = useState<'file' | 'password'>('password');
  const [importing, setImporting] = useState(false);
  const [summary, setSummary] = useState<{ added: number; duplicates: number; rejected: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Only the latest pick may fill in fileData; an earlier, slower read may not.
  const readId = useRef(0);

  function setError(text: string, field: 'file' | 'password' = 'password') {
    setErrorText(text);
    setErrorField(field);
  }

  /** Points the control the error is about at it (and marks the password field). */
  function fieldError(field: 'file' | 'password') {
    const about = !!error && errorField === field;
    return {
      // A button can't be aria-invalid.
      ...(field === 'password' ? { 'aria-invalid': about } : {}),
      'aria-describedby': about ? 'import-error' : undefined,
    };
  }

  // A new pick replaces the old one, also when it is rejected: Import must
  // never send an earlier file under an error about this one.
  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    setError('');
    const input = e.target;
    const file = input.files?.[0];
    if (!file) return;
    const id = ++readId.current;
    setFileData(null);
    const MAX_IMPORT_SIZE = 10 * 1024 * 1024; // 10MB
    if (file.size > MAX_IMPORT_SIZE) {
      setError('File too large (max 10MB)', 'file');
      setFileName('');
      input.value = '';
      return;
    }
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = () => {
      if (id === readId.current) setFileData(reader.result as string);
    };
    reader.onerror = () => {
      if (id !== readId.current) return;
      setError('Could not read the file', 'file');
      setFileName('');
      input.value = '';
    };
    reader.readAsText(file);
  }

  async function handleImport(e: FormEvent) {
    e.preventDefault();
    setError('');

    if (!fileData) {
      setError('Please select a .byoky file', 'file');
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

      {error && <FormError id="import-error">{error}</FormError>}

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
            className="btn btn-secondary btn-file"
            onClick={() => fileRef.current?.click()}
            {...fieldError('file')}
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
            {...fieldError('password')}
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
