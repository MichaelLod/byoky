'use client';

interface AppCardProps {
  id: string;
  name: string;
  description?: string;
  category?: string;
  iconUrl?: string;
  discountPercent: number;
  totalUsers: number;
}

function AppCard({ id, name, description, category, discountPercent, totalUsers }: AppCardProps) {
  return (
    <a
      href={`/marketplace/${id}`}
      style={{
        display: 'block',
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRadius: '12px',
        padding: '20px',
        textDecoration: 'none',
        color: 'inherit',
        transition: 'border-color 0.15s, transform 0.15s',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'rgba(255, 79, 0, 0.3)';
        e.currentTarget.style.transform = 'translateY(-2px)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--border)';
        e.currentTarget.style.transform = 'translateY(0)';
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
        <div style={{
          width: '40px', height: '40px', borderRadius: '10px',
          background: 'linear-gradient(135deg, var(--teal) 0%, #e91e90 100%)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '18px', fontWeight: 700, color: '#fff',
        }}>
          {name.charAt(0).toUpperCase()}
        </div>
        {discountPercent > 0 && (
          <span style={{
            background: 'rgba(34, 197, 94, 0.1)',
            color: '#22c55e',
            padding: '4px 8px',
            borderRadius: '6px',
            fontSize: '11px',
            fontWeight: 700,
          }}>
            {discountPercent}% OFF
          </span>
        )}
      </div>
      <h3 style={{ fontSize: '15px', fontWeight: 600, marginBottom: '4px' }}>{name}</h3>
      {description && (
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '8px', lineHeight: 1.4 }}>
          {description.length > 80 ? description.slice(0, 80) + '...' : description}
        </p>
      )}
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '11px', color: 'var(--text-muted)' }}>
        {category && (
          <span style={{
            background: 'var(--bg-elevated)',
            padding: '2px 8px',
            borderRadius: '4px',
          }}>
            {category}
          </span>
        )}
        <span>{totalUsers.toLocaleString()} users</span>
      </div>
    </a>
  );
}

const CATEGORIES = ['All', 'Chat', 'Coding', 'Writing', 'Image', 'Audio', 'Research', 'Other'];

export default function Marketplace() {
  return (
    <div>
      <div style={{ textAlign: 'center', marginBottom: '32px' }}>
        <h1 style={{ fontSize: '32px', fontWeight: 700, marginBottom: '8px' }}>
          App Marketplace
        </h1>
        <p style={{ color: '#a1a1aa', fontSize: '16px' }}>
          Discover AI apps. One wallet, every app.
        </p>
      </div>

      {/* Category filters */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '24px', flexWrap: 'wrap', justifyContent: 'center' }}>
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            style={{
              padding: '6px 14px', borderRadius: '8px',
              background: cat === 'All' ? 'var(--teal)' : 'var(--bg-elevated)',
              color: cat === 'All' ? '#fff' : '#a1a1aa',
              border: cat === 'All' ? 'none' : '1px solid var(--border)',
              fontSize: '13px', cursor: 'pointer',
            }}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Empty state — shown when no apps yet */}
      <div style={{
        textAlign: 'center',
        padding: '48px 24px',
        background: 'var(--bg-surface)',
        border: '1px dashed var(--border)',
        borderRadius: '12px',
      }}>
        <div style={{ fontSize: '40px', marginBottom: '12px' }}>&#127758;</div>
        <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '8px' }}>Marketplace launching soon</h3>
        <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '20px', maxWidth: '400px', margin: '0 auto 20px' }}>
          Apps are auto-listed when developers integrate the Byoky SDK.
          Be one of the first to list your app.
        </p>
        <a
          href="/developer/setup"
          style={{
            display: 'inline-flex', padding: '10px 20px', borderRadius: '10px',
            background: 'var(--teal)', color: '#fff', textDecoration: 'none',
            fontSize: '14px', fontWeight: 500,
          }}
        >
          List Your App
        </a>
      </div>
    </div>
  );
}
