import { useState, type FormEvent } from 'react';
import { useWalletStore } from '../store';
import { formatBalance } from '@byoky/core';

const PRESETS = [100, 500, 1000, 2000]; // cents

export function AddFunds() {
  const { balance, topUp, navigate, error } = useWalletStore();
  const [amount, setAmount] = useState(500); // $5 default
  const [custom, setCustom] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const cents = custom ? Math.round(parseFloat(custom) * 100) : amount;
    if (cents < 100) return;

    setLoading(true);
    setSuccess(false);
    const ok = await topUp(cents);
    setLoading(false);
    if (ok) {
      setSuccess(true);
      setTimeout(() => navigate('balance'), 1200);
    }
  }

  return (
    <div>
      <button className="text-link" onClick={() => navigate('balance')} style={{ marginBottom: '12px' }}>
        &larr; Back
      </button>
      <h2 className="page-title">Add Funds</h2>

      {balance && (
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
          Current balance: <strong>{formatBalance(balance.amountCents)}</strong>
        </p>
      )}

      {error && <div className="error">{error}</div>}

      {success ? (
        <div style={{ textAlign: 'center', padding: '24px 0' }}>
          <div style={{ fontSize: '32px', marginBottom: '8px' }}>&#10003;</div>
          <div style={{ fontSize: '15px', fontWeight: 600 }}>
            {formatBalance(custom ? Math.round(parseFloat(custom) * 100) : amount)} added
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px', marginBottom: '12px' }}>
            {PRESETS.map((cents) => (
              <button
                key={cents}
                type="button"
                className={`btn ${amount === cents && !custom ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => { setAmount(cents); setCustom(''); }}
              >
                {formatBalance(cents)}
              </button>
            ))}
          </div>

          <div className="form-group">
            <label htmlFor="custom-amount">Custom amount</label>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}>$</span>
              <input
                id="custom-amount"
                type="number"
                min="1"
                max="500"
                step="0.01"
                placeholder="0.00"
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                style={{ paddingLeft: '24px' }}
              />
            </div>
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            disabled={loading || (custom ? parseFloat(custom) < 1 : false)}
          >
            {loading ? 'Processing...' : `Add ${formatBalance(custom ? Math.round(parseFloat(custom) * 100) : amount)}`}
          </button>
        </form>
      )}
    </div>
  );
}
