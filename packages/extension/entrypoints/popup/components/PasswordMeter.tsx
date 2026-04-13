import type { PasswordStrength } from '@byoky/core';

const COLORS = ['var(--danger)', '#f97316', '#eab308', '#4ade80', '#22c55e'];

export function PasswordMeter({ strength }: { strength: PasswordStrength }) {
  const isEmpty = (strength as any).score === -1;
  const color = isEmpty ? 'transparent' : COLORS[strength.score];

  return (
    <div className="password-meter" style={{ opacity: isEmpty ? 0 : 1, transition: 'opacity 0.15s' }}>
      <div className="password-meter-bars">
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="password-meter-bar"
            style={{
              background: i <= strength.score ? color : 'var(--bg-card)',
            }}
          />
        ))}
      </div>
      <div className="password-meter-label" style={{ color }}>
        {strength.label || '\u00A0'}
      </div>
      <div className="password-meter-feedback">
        {strength.feedback?.[0] || '\u00A0'}
      </div>
    </div>
  );
}
