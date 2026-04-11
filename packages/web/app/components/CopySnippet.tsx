'use client';

export function CopySnippet({ text, display }: { text: string; display: string }) {
  return (
    <code
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '8px',
        padding: '10px 20px', borderRadius: '10px',
        background: 'var(--bg-elevated)', border: '1px solid var(--border)',
        fontFamily: 'var(--font-code)', fontSize: '14px', color: 'var(--text-secondary)',
        letterSpacing: '0.01em', cursor: 'pointer',
      }}
      onClick={() => navigator.clipboard.writeText(text)}
      title="Click to copy"
    >
      <span style={{ color: 'var(--text-muted)' }}>$</span> {display}
      <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: '4px' }}>&#128203;</span>
    </code>
  );
}
