import { useEffect, useState } from 'react';
import { useWalletStore } from '../store';
import { formatBalance } from '@byoky/core';
import { BalanceCard } from '../components/BalanceCard';

function formatDate(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' +
    d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function BalancePage() {
  const { balance, transactions, navigate, fetchBalance, fetchTransactions, updateAutoTopUp } = useWalletStore();
  const [autoTopUpAmount, setAutoTopUpAmount] = useState('5');
  const [autoTopUpThreshold, setAutoTopUpThreshold] = useState('1');

  useEffect(() => {
    fetchBalance();
    fetchTransactions();
  }, [fetchBalance, fetchTransactions]);

  useEffect(() => {
    if (balance) {
      setAutoTopUpAmount(String(balance.autoTopUpAmountCents / 100));
      setAutoTopUpThreshold(String(balance.autoTopUpThresholdCents / 100));
    }
  }, [balance]);

  return (
    <div>
      <BalanceCard
        balance={balance}
        onAddFunds={() => navigate('add-funds')}
        onViewDetails={() => {}}
      />

      {/* Auto top-up settings */}
      <div className="card" style={{ marginTop: '12px' }}>
        <div className="card-header">
          <span className="card-title" style={{ fontSize: '13px' }}>Auto Top-Up</span>
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={balance?.autoTopUp ?? false}
              onChange={(e) => updateAutoTopUp(e.target.checked)}
            />
            <span className="toggle-slider" />
          </label>
        </div>
        {balance?.autoTopUp && (
          <div style={{ marginTop: '10px', display: 'flex', gap: '8px', fontSize: '12px', color: 'var(--text-secondary)' }}>
            <div>
              <label>Add ${autoTopUpAmount} when below ${autoTopUpThreshold}</label>
              <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
                <select
                  value={autoTopUpAmount}
                  onChange={(e) => {
                    setAutoTopUpAmount(e.target.value);
                    updateAutoTopUp(true, Number(e.target.value) * 100, Number(autoTopUpThreshold) * 100);
                  }}
                  style={{ fontSize: '12px', padding: '4px', borderRadius: '6px', background: 'var(--bg-secondary)', color: 'var(--text)', border: '1px solid var(--border)' }}
                >
                  {[1, 2, 5, 10, 20, 50].map((v) => (
                    <option key={v} value={v}>${v}</option>
                  ))}
                </select>
                <span style={{ alignSelf: 'center' }}>when below</span>
                <select
                  value={autoTopUpThreshold}
                  onChange={(e) => {
                    setAutoTopUpThreshold(e.target.value);
                    updateAutoTopUp(true, Number(autoTopUpAmount) * 100, Number(e.target.value) * 100);
                  }}
                  style={{ fontSize: '12px', padding: '4px', borderRadius: '6px', background: 'var(--bg-secondary)', color: 'var(--text)', border: '1px solid var(--border)' }}
                >
                  {[0.5, 1, 2, 5].map((v) => (
                    <option key={v} value={v}>${v}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Payment methods link */}
      <button
        className="btn btn-secondary"
        style={{ marginTop: '8px', width: '100%' }}
        onClick={() => navigate('payment-methods')}
      >
        Manage payment methods
      </button>

      {/* Transaction history */}
      <h3 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: '20px', marginBottom: '8px' }}>
        Recent Transactions
      </h3>

      {transactions.length === 0 ? (
        <div className="empty-state">
          <p>No transactions yet.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          {transactions.slice(0, 30).map((txn) => (
            <div
              key={txn.id}
              className="card"
              style={{ padding: '10px 12px' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <span style={{ fontSize: '13px', fontWeight: 500 }}>
                    {txn.type === 'topup' ? 'Top up' : txn.type === 'refund' ? 'Refund' : txn.providerId ?? 'Charge'}
                  </span>
                  {txn.model && (
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: '6px' }}>
                      {txn.model}
                    </span>
                  )}
                </div>
                <span style={{
                  fontSize: '13px',
                  fontWeight: 600,
                  color: txn.type === 'topup' ? '#22c55e' : txn.type === 'refund' ? '#22c55e' : 'var(--text)',
                }}>
                  {txn.type === 'charge' ? '-' : '+'}{formatBalance(txn.amountCents)}
                </span>
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                {formatDate(txn.createdAt)}
                {txn.inputTokens != null && (
                  <span> &middot; {txn.inputTokens + (txn.outputTokens ?? 0)} tokens</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
