import { useState, useEffect, type FormEvent } from 'react';
import { useWalletStore } from '../store';
import { formatBalance } from '@byoky/core';

const PRESETS = [100, 500, 1000, 2000]; // cents
const WEB_URL = 'http://localhost:3001'; // TODO: make configurable

async function sendInternal(action: string, payload?: unknown): Promise<Record<string, unknown>> {
  return browser.runtime.sendMessage({
    type: 'BYOKY_INTERNAL',
    action,
    payload,
  }) as Promise<Record<string, unknown>>;
}

export function AddFunds() {
  const { balance, paymentMethods, topUp, navigate, error, fetchPaymentMethods, fetchBalance } = useWalletStore();
  const [amount, setAmount] = useState(500);
  const [custom, setCustom] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const hasCard = paymentMethods.length > 0;

  useEffect(() => {
    fetchPaymentMethods();
    fetchBalance();
  }, [fetchPaymentMethods, fetchBalance]);

  async function openAddCard() {
    // Get vault token from background
    const result = await sendInternal('getVaultToken');
    const token = result.token as string | null;
    if (!token) {
      // Not connected to vault — prompt to set up
      navigate('settings');
      return;
    }
    // Open card collection page in new tab
    const url = `${WEB_URL}/wallet/add-card#token=${encodeURIComponent(token)}`;
    window.open(url, '_blank');

    // Poll for payment method to appear (user adding card in other tab)
    const poll = setInterval(async () => {
      await fetchPaymentMethods();
      const current = useWalletStore.getState().paymentMethods;
      if (current.length > 0) {
        clearInterval(poll);
      }
    }, 2000);

    // Stop polling after 5 minutes
    setTimeout(() => clearInterval(poll), 5 * 60 * 1000);
  }

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

      {/* No card yet — prompt to add one */}
      {!hasCard && (
        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
            Add a payment method to start funding your wallet.
          </p>
          <button className="btn btn-primary" onClick={openAddCard}>
            Add Card
          </button>
          <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '12px' }}>
            Secured by Stripe. Byoky never sees your full card details.
          </p>
        </div>
      )}

      {/* Has card — show top-up form */}
      {hasCard && !success && (
        <form onSubmit={handleSubmit}>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '12px' }}>
            Charging: {paymentMethods[0].brand} ****{paymentMethods[0].last4}
            <button
              type="button"
              className="text-link"
              style={{ marginLeft: '8px', fontSize: '12px' }}
              onClick={openAddCard}
            >
              Change
            </button>
          </div>

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

      {success && (
        <div style={{ textAlign: 'center', padding: '24px 0' }}>
          <div style={{ fontSize: '32px', marginBottom: '8px' }}>&#10003;</div>
          <div style={{ fontSize: '15px', fontWeight: 600 }}>
            {formatBalance(custom ? Math.round(parseFloat(custom) * 100) : amount)} added
          </div>
        </div>
      )}
    </div>
  );
}
