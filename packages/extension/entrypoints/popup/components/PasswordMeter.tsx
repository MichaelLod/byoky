import type { PasswordStrength } from '@byoky/core';

const COLORS = ['var(--danger)', '#f97316', '#eab308', '#22c55e', '#0ea5e9'];

export function PasswordMeter({ strength }: { strength: PasswordStrength }) {
  const color = COLORS[strength.score];

  return (
    <div className="password-meter">
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
        {strength.label}
      </div>
      {strength.feedback.length > 0 && (
        <div className="password-meter-feedback">
          {strength.feedback[0]}
        </div>
      )}
    </div>
  );
}
