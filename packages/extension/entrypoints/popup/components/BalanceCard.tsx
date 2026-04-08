import type { Balance } from '@byoky/core';
import { formatBalance } from '@byoky/core';

interface BalanceCardProps {
  balance: Balance | null;
  onAddFunds: () => void;
  onViewDetails: () => void;
}

export function BalanceCard({ balance, onAddFunds, onViewDetails }: BalanceCardProps) {
  const amount = balance?.amountCents ?? 0;
  const isLow = amount < 100; // less than $1

  return (
    <div
      className="card"
      style={{
        background: 'linear-gradient(135deg, var(--accent) 0%, #6366f1 100%)',
        color: '#fff',
        cursor: 'pointer',
        position: 'relative',
        overflow: 'hidden',
      }}
      onClick={onViewDetails}
    >
      <div style={{ position: 'relative', zIndex: 1 }}>
        <div style={{ fontSize: '12px', opacity: 0.8, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Balance
        </div>
        <div style={{ fontSize: '28px', fontWeight: 700, letterSpacing: '-0.02em' }}>
          {formatBalance(amount)}
        </div>
        {balance?.autoTopUp && (
          <div style={{ fontSize: '11px', opacity: 0.7, marginTop: '4px' }}>
            Auto top-up enabled
          </div>
        )}
        {isLow && !balance?.autoTopUp && (
          <div style={{ fontSize: '11px', color: '#fbbf24', marginTop: '4px' }}>
            Low balance
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: '8px', marginTop: '12px', position: 'relative', zIndex: 1 }}>
        <button
          className="btn btn-sm"
          style={{
            background: 'rgba(255,255,255,0.2)',
            color: '#fff',
            border: 'none',
            fontSize: '12px',
            padding: '6px 14px',
          }}
          onClick={(e) => { e.stopPropagation(); onAddFunds(); }}
        >
          Add funds
        </button>
      </div>
    </div>
  );
}
