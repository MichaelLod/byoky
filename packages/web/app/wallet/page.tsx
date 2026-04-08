'use client';

import { useState, useEffect } from 'react';
import { useVaultToken, vaultFetch } from './use-vault';

interface Balance {
  amountCents: number;
  currency: string;
  autoTopUp: boolean;
}

interface Transaction {
  id: string;
  type: string;
  amountCents: number;
  providerId?: string;
  model?: string;
  createdAt: number;
}

interface PaymentMethod {
  id: string;
  last4: string;
  brand: string;
  isDefault: boolean;
}

export default function WalletDashboard() {
  const { token, login, logout, isLoggedIn } = useVaultToken();
  const [balance, setBalance] = useState<Balance | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) return;
    Promise.all([
      vaultFetch('/billing/balance', token).then(r => r.json()),
      vaultFetch('/billing/transactions?limit=20', token).then(r => r.json()),
      vaultFetch('/billing/payment-methods', token).then(r => r.json()),
    ]).then(([bal, txns, pms]) => {
      setBalance(bal as Balance);
      setTransactions(((txns as { transactions: Transaction[] }).transactions) ?? []);
      setPaymentMethods(((pms as { paymentMethods: PaymentMethod[] }).paymentMethods) ?? []);
    }).catch(() => {});
  }, [token]);

  if (!isLoggedIn) {
    return (
      <div style={pageStyle}>
        <div style={{ maxWidth: '380px', margin: '0 auto' }}>
          <h1 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '8px', textAlign: 'center' }}>Wallet</h1>
          <p style={{ color: '#71717a', textAlign: 'center', marginBottom: '24px' }}>Sign in to manage your Byoky wallet</p>
          {error && <div style={{ color: '#ef4444', fontSize: '13px', marginBottom: '12px', textAlign: 'center' }}>{error}</div>}
          <form onSubmit={async (e) => {
            e.preventDefault();
            const ok = await login(username, password);
            if (!ok) setError('Invalid credentials');
          }}>
            <input type="text" placeholder="Username" value={username} onChange={e => setUsername(e.target.value)} style={inputStyle} />
            <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} style={{ ...inputStyle, marginTop: '8px' }} />
            <button type="submit" style={{ ...btnStyle, marginTop: '12px', width: '100%' }}>Sign In</button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div style={pageStyle}>
      <div style={{ maxWidth: '640px', margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          <h1 style={{ fontSize: '24px', fontWeight: 700 }}>Wallet</h1>
          <button onClick={logout} style={{ background: 'none', border: 'none', color: '#71717a', cursor: 'pointer', fontSize: '13px' }}>Sign out</button>
        </div>

        {/* Balance card */}
        <div style={{
          background: 'linear-gradient(135deg, #0ea5e9 0%, #6366f1 100%)',
          borderRadius: '16px', padding: '24px', color: '#fff', marginBottom: '16px',
        }}>
          <div style={{ fontSize: '12px', opacity: 0.8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Balance</div>
          <div style={{ fontSize: '36px', fontWeight: 700 }}>${((balance?.amountCents ?? 0) / 100).toFixed(2)}</div>
          {balance?.autoTopUp && <div style={{ fontSize: '12px', opacity: 0.7, marginTop: '4px' }}>Auto top-up enabled</div>}
          <div style={{ marginTop: '12px', display: 'flex', gap: '8px' }}>
            <a href="/wallet/add-card" style={{ ...btnSmall, background: 'rgba(255,255,255,0.2)', color: '#fff' }}>Add card</a>
          </div>
        </div>

        {/* Payment methods */}
        {paymentMethods.length > 0 && (
          <div style={{ marginBottom: '24px' }}>
            <h3 style={sectionTitle}>Payment Methods</h3>
            {paymentMethods.map(pm => (
              <div key={pm.id} style={cardStyle}>
                <span>{pm.brand.charAt(0).toUpperCase() + pm.brand.slice(1)} ****{pm.last4}</span>
                {pm.isDefault && <span style={{ fontSize: '11px', color: '#0ea5e9', marginLeft: '8px' }}>Default</span>}
              </div>
            ))}
          </div>
        )}

        {/* Transactions */}
        <h3 style={sectionTitle}>Recent Transactions</h3>
        {transactions.length === 0 ? (
          <p style={{ color: '#52525b', fontSize: '14px' }}>No transactions yet</p>
        ) : (
          transactions.map(txn => (
            <div key={txn.id} style={{ ...cardStyle, display: 'flex', justifyContent: 'space-between' }}>
              <div>
                <span style={{ fontSize: '13px', fontWeight: 500 }}>
                  {txn.type === 'topup' ? 'Top up' : txn.type === 'refund' ? 'Refund' : txn.providerId ?? 'Charge'}
                </span>
                {txn.model && <span style={{ fontSize: '11px', color: '#52525b', marginLeft: '6px' }}>{txn.model}</span>}
                <div style={{ fontSize: '11px', color: '#52525b' }}>{new Date(txn.createdAt).toLocaleString()}</div>
              </div>
              <span style={{ fontWeight: 600, color: txn.type === 'charge' ? '#e4e4e7' : '#22c55e' }}>
                {txn.type === 'charge' ? '-' : '+'}${(txn.amountCents / 100).toFixed(2)}
              </span>
            </div>
          ))
        )}

        <div style={{ marginTop: '32px', display: 'flex', gap: '12px' }}>
          <a href="/marketplace" style={{ color: '#0ea5e9', fontSize: '14px', textDecoration: 'none' }}>Browse Apps</a>
          <a href="/developer" style={{ color: '#71717a', fontSize: '14px', textDecoration: 'none' }}>Developer Portal</a>
        </div>
      </div>
    </div>
  );
}

const pageStyle: React.CSSProperties = {
  minHeight: '100vh', background: '#09090b', color: '#e4e4e7', padding: '48px 24px',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
};
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)',
  background: '#18181b', color: '#e4e4e7', fontSize: '14px', outline: 'none', boxSizing: 'border-box',
};
const btnStyle: React.CSSProperties = {
  padding: '10px 20px', borderRadius: '10px', background: '#0ea5e9', color: '#fff',
  border: 'none', fontSize: '14px', fontWeight: 600, cursor: 'pointer',
};
const btnSmall: React.CSSProperties = {
  padding: '6px 14px', borderRadius: '8px', border: 'none', fontSize: '12px',
  fontWeight: 500, cursor: 'pointer', textDecoration: 'none', display: 'inline-block',
};
const cardStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: '10px', padding: '12px 16px', marginBottom: '6px',
};
const sectionTitle: React.CSSProperties = {
  fontSize: '13px', fontWeight: 600, color: '#71717a', textTransform: 'uppercase',
  letterSpacing: '0.04em', marginBottom: '8px',
};
