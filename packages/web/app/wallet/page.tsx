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
      <div style={{ maxWidth: '640px', margin: '0 auto', padding: '32px 24px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: 700, textAlign: 'center', marginBottom: '8px' }}>Your AI Wallet</h1>
        <p style={{ color: 'var(--text-secondary)', textAlign: 'center', marginBottom: '32px' }}>
          One balance. Every AI app. No API keys needed.
        </p>

        {/* Mockup preview */}
        <div style={{ maxWidth: '420px', margin: '0 auto 32px', pointerEvents: 'none', opacity: 0.85 }}>
          {/* Balance card mockup */}
          <div style={{
            background: 'linear-gradient(135deg, var(--teal) 0%, #e91e90 100%)',
            borderRadius: '16px', padding: '24px', color: '#fff', marginBottom: '12px',
          }}>
            <div style={{ fontSize: '12px', opacity: 0.8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Balance</div>
            <div style={{ fontSize: '36px', fontWeight: 700 }}>$12.50</div>
            <div style={{ fontSize: '12px', opacity: 0.7, marginTop: '4px' }}>Auto top-up enabled</div>
          </div>

          {/* Connected apps mockup */}
          <div style={{ marginBottom: '12px' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '6px' }}>Connected Apps</div>
            {['DemoChat', 'CodeAssist', 'WriterAI'].map((app) => (
              <div key={app} style={{
                background: 'var(--bg-surface)', border: '1px solid var(--border)',
                borderRadius: '10px', padding: '10px 14px', marginBottom: '4px',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{
                    width: '28px', height: '28px', borderRadius: '8px',
                    background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '12px', fontWeight: 700, color: 'var(--teal)',
                  }}>{app[0]}</div>
                  <span style={{ fontSize: '13px', fontWeight: 500 }}>{app}</span>
                </div>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>$0.03 today</span>
              </div>
            ))}
          </div>

          {/* Recent transactions mockup */}
          <div>
            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '6px' }}>Recent</div>
            {[
              { label: 'Gemini', amount: '-$0.01', color: 'var(--text)' },
              { label: 'Top up', amount: '+$5.00', color: 'var(--green)' },
              { label: 'Anthropic', amount: '-$0.02', color: 'var(--text)' },
            ].map((txn, i) => (
              <div key={i} style={{
                background: 'var(--bg-surface)', border: '1px solid var(--border)',
                borderRadius: '10px', padding: '10px 14px', marginBottom: '4px',
                display: 'flex', justifyContent: 'space-between',
              }}>
                <span style={{ fontSize: '13px' }}>{txn.label}</span>
                <span style={{ fontSize: '13px', fontWeight: 600, color: txn.color }}>{txn.amount}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Login */}
        <div style={{ maxWidth: '380px', margin: '0 auto' }}>
          <p style={{ color: 'var(--text-secondary)', textAlign: 'center', marginBottom: '16px', fontSize: '14px' }}>Sign in to access your wallet</p>
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
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', textAlign: 'center', marginTop: '12px' }}>
            Don&apos;t have an account? Click &ldquo;Pay with Byoky&rdquo; on any integrated app to create one.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '640px', margin: '0 auto', padding: '32px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 700 }}>Wallet</h1>
        <button onClick={logout} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '13px' }}>Sign out</button>
      </div>

      {/* Balance card */}
      <div style={{
        background: 'linear-gradient(135deg, var(--teal) 0%, #e91e90 100%)',
        borderRadius: '16px', padding: '24px', color: '#fff', marginBottom: '16px',
      }}>
        <div style={{ fontSize: '12px', opacity: 0.8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Balance</div>
        <div style={{ fontSize: '36px', fontWeight: 700 }}>${((balance?.amountCents ?? 0) / 100).toFixed(2)}</div>
        {balance?.autoTopUp && <div style={{ fontSize: '12px', opacity: 0.7, marginTop: '4px' }}>Auto top-up enabled</div>}
        <div style={{ marginTop: '12px', display: 'flex', gap: '8px' }}>
          <a href="/wallet/add-card" style={{
            padding: '6px 14px', borderRadius: '8px', border: 'none', fontSize: '12px',
            fontWeight: 500, cursor: 'pointer', textDecoration: 'none', display: 'inline-block',
            background: 'rgba(255,255,255,0.2)', color: '#fff',
          }}>Add card</a>
        </div>
      </div>

      {/* Payment methods */}
      {paymentMethods.length > 0 && (
        <div style={{ marginBottom: '24px' }}>
          <h3 style={sectionTitle}>Payment Methods</h3>
          {paymentMethods.map(pm => (
            <div key={pm.id} style={cardStyle}>
              <span>{pm.brand.charAt(0).toUpperCase() + pm.brand.slice(1)} ****{pm.last4}</span>
              {pm.isDefault && <span style={{ fontSize: '11px', color: 'var(--teal)', marginLeft: '8px' }}>Default</span>}
            </div>
          ))}
        </div>
      )}

      {/* Transactions */}
      <h3 style={sectionTitle}>Recent Transactions</h3>
      {transactions.length === 0 ? (
        <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>No transactions yet</p>
      ) : (
        transactions.map(txn => (
          <div key={txn.id} style={{ ...cardStyle, display: 'flex', justifyContent: 'space-between' }}>
            <div>
              <span style={{ fontSize: '13px', fontWeight: 500 }}>
                {txn.type === 'topup' ? 'Top up' : txn.type === 'refund' ? 'Refund' : txn.providerId ?? 'Charge'}
              </span>
              {txn.model && <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: '6px' }}>{txn.model}</span>}
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{new Date(txn.createdAt).toLocaleString()}</div>
            </div>
            <span style={{ fontWeight: 600, color: txn.type === 'charge' ? 'var(--text)' : 'var(--green)' }}>
              {txn.type === 'charge' ? '-' : '+'}${(txn.amountCents / 100).toFixed(2)}
            </span>
          </div>
        ))
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid var(--border)',
  background: 'var(--bg-surface)', color: 'var(--text)', fontSize: '14px', outline: 'none', boxSizing: 'border-box',
};
const btnStyle: React.CSSProperties = {
  padding: '10px 20px', borderRadius: '10px', background: 'var(--teal)', color: '#fff',
  border: 'none', fontSize: '14px', fontWeight: 600, cursor: 'pointer',
};
const cardStyle: React.CSSProperties = {
  background: 'var(--bg-surface)', border: '1px solid var(--border)',
  borderRadius: '10px', padding: '12px 16px', marginBottom: '6px',
};
const sectionTitle: React.CSSProperties = {
  fontSize: '13px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase',
  letterSpacing: '0.04em', marginBottom: '8px',
};
