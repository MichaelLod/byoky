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
      <div style={{ maxWidth: '900px', margin: '0 auto', padding: '48px 24px' }}>
        <h1 style={{ fontSize: '32px', fontWeight: 800, textAlign: 'center', marginBottom: '6px', letterSpacing: '-0.02em' }}>
          Stop overpaying for AI.
        </h1>
        <p style={{ color: 'var(--text-secondary)', textAlign: 'center', fontSize: '16px', maxWidth: '520px', margin: '0 auto 40px' }}>
          One wallet replaces 5 subscriptions. Pay only for what you use — across every AI app. Save 50% or more.
        </p>

        <div style={{ display: 'flex', gap: '32px', alignItems: 'stretch' }}>
          {/* Left: mockup */}
          <div style={{
            width: '280px', flexShrink: 0,
            background: 'var(--bg-surface)', border: '1px solid var(--border)',
            borderRadius: '16px', padding: '16px',
            pointerEvents: 'none',
            boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
          }}>
            <div style={{
              background: 'linear-gradient(135deg, var(--teal) 0%, #e91e90 100%)',
              borderRadius: '12px', padding: '16px', color: '#fff', marginBottom: '12px',
            }}>
              <div style={{ fontSize: '10px', opacity: 0.8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Balance</div>
              <div style={{ fontSize: '24px', fontWeight: 700 }}>$12.50</div>
              <div style={{ fontSize: '10px', opacity: 0.7, marginTop: '2px' }}>Auto top-up enabled</div>
            </div>
            <div style={{ fontSize: '9px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '4px' }}>Connected Apps</div>
            {['DemoChat', 'CodeAssist', 'WriterAI'].map((app) => (
              <div key={app} style={{
                background: 'var(--bg-card)', border: '1px solid var(--border)',
                borderRadius: '8px', padding: '8px 10px', marginBottom: '3px',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{
                    width: '22px', height: '22px', borderRadius: '6px',
                    background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '10px', fontWeight: 700, color: 'var(--teal)',
                  }}>{app[0]}</div>
                  <span style={{ fontSize: '11px', fontWeight: 500 }}>{app}</span>
                </div>
                <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>$0.03</span>
              </div>
            ))}
            <div style={{ fontSize: '9px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: '10px', marginBottom: '4px' }}>Recent</div>
            {[
              { label: 'Gemini', amount: '-$0.01', color: 'var(--text)' },
              { label: 'Top up', amount: '+$5.00', color: 'var(--green)' },
            ].map((txn, i) => (
              <div key={i} style={{
                background: 'var(--bg-card)', border: '1px solid var(--border)',
                borderRadius: '8px', padding: '8px 10px', marginBottom: '3px',
                display: 'flex', justifyContent: 'space-between',
              }}>
                <span style={{ fontSize: '11px' }}>{txn.label}</span>
                <span style={{ fontSize: '11px', fontWeight: 600, color: txn.color }}>{txn.amount}</span>
              </div>
            ))}
          </div>

          {/* Right: get started */}
          <div style={{ flex: 1 }}>
            <div style={{
              background: 'var(--bg-card)', border: '1px solid var(--border)',
              borderRadius: '20px', padding: '32px',
              boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
              height: '100%', display: 'flex', flexDirection: 'column',
            }}>
              <h2 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '6px' }}>Get your wallet</h2>
              <p style={{ color: 'var(--text-secondary)', marginBottom: '20px', fontSize: '13px', lineHeight: 1.6 }}>
                Choose how you want to manage your AI spending.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '20px', flex: 1 }}>
                <a href="https://chromewebstore.google.com/detail/byoky/igjohldpldlahcjmefdhlnbcpldlgmon" target="_blank" rel="noopener noreferrer" style={optionStyle}>
                  <svg width="20" height="20" viewBox="0 0 48 48" style={{ flexShrink: 0 }}><circle cx="24" cy="24" r="22" fill="#fff" stroke="#ddd" strokeWidth="1"/><path d="M24 8a16 16 0 0 1 13.86 8H24v0z" fill="#EA4335"/><path d="M37.86 16A16 16 0 0 1 24 40l6.93-12z" fill="#FBBC05"/><path d="M24 40A16 16 0 0 1 10.14 16l6.93 12z" fill="#34A853"/><path d="M10.14 16A16 16 0 0 1 24 8v8z" fill="#4285F4"/><circle cx="24" cy="24" r="6" fill="#fff"/><circle cx="24" cy="24" r="4" fill="#4285F4"/></svg>
                  <div><div style={{ fontWeight: 600, fontSize: '13px' }}>Chrome Extension</div><div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Local encryption. Keys on your device.</div></div>
                </a>
                <a href="https://addons.mozilla.org/en-US/firefox/addon/byoky/" target="_blank" rel="noopener noreferrer" style={optionStyle}>
                  <svg width="20" height="20" viewBox="0 0 48 48" style={{ flexShrink: 0 }}><circle cx="24" cy="24" r="22" fill="#fff" stroke="#ddd" strokeWidth="1"/><path d="M38 18c-1-4-4-7-8-9 2 2 3 5 3 7 0 3-2 6-5 7-4 1-7-1-7-1s1 5 6 6c4 1 8-1 10-4 1-1 1-3 1-6z" fill="#FF4F00"/><path d="M14 30c-1-3 0-6 2-9 1-2 3-3 5-4-2 2-3 4-2 7 0 2 2 4 4 5 3 1 6 0 7-2-1 3-4 6-8 6-3 1-6-1-8-3z" fill="#FF9500"/></svg>
                  <div><div style={{ fontWeight: 600, fontSize: '13px' }}>Firefox Extension</div><div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Same security. Works on Firefox.</div></div>
                </a>
                <a href="/wallet/connect" style={{ ...optionStyle, border: '2px solid var(--teal)' }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--teal)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                  <div style={{ flex: 1 }}><div style={{ fontWeight: 600, fontSize: '13px' }}>Online Wallet <span style={{ fontSize: '10px', color: 'var(--teal)', fontWeight: 700, marginLeft: '4px' }}>No install</span></div><div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Any browser. No extension needed.</div></div>
                </a>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', margin: '0 0 16px' }}>
                <div style={{ flex: 1, height: '1px', background: 'var(--border)' }} />
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>already have an account?</span>
                <div style={{ flex: 1, height: '1px', background: 'var(--border)' }} />
              </div>

              {error && <div style={{ color: '#ef4444', fontSize: '13px', marginBottom: '10px', padding: '8px 12px', background: 'rgba(239,68,68,0.06)', borderRadius: '8px' }}>{error}</div>}
              <form onSubmit={async (e) => { e.preventDefault(); const ok = await login(username, password); if (!ok) setError('Invalid credentials'); }}>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input type="text" placeholder="Username" value={username} onChange={e => setUsername(e.target.value)} style={{ ...inputStyle, flex: 1 }} />
                  <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} style={{ ...inputStyle, flex: 1 }} />
                </div>
                <button type="submit" style={{ ...btnStyle, marginTop: '10px', width: '100%' }}>Sign In</button>
              </form>
            </div>
          </div>
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
const optionStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '12px',
  padding: '12px 14px', borderRadius: '10px',
  background: 'var(--bg-surface)', border: '1px solid var(--border)',
  textDecoration: 'none', color: 'var(--text)',
  transition: 'border-color 0.2s',
};
const sectionTitle: React.CSSProperties = {
  fontSize: '13px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase',
  letterSpacing: '0.04em', marginBottom: '8px',
};
