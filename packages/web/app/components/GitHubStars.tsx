'use client';

import { useState, useEffect } from 'react';

export function GitHubStars({ repo }: { repo: string }) {
  const [stars, setStars] = useState<number | null>(null);

  useEffect(() => {
    fetch(`https://api.github.com/repos/${repo}`)
      .then(r => r.json())
      .then(data => {
        if (typeof data.stargazers_count === 'number') {
          setStars(data.stargazers_count);
        }
      })
      .catch(() => {});
  }, [repo]);

  if (stars === null) return null;

  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '4px',
      fontSize: '12px',
      fontWeight: 700,
      color: 'var(--text-muted)',
      background: 'var(--bg-elevated, #f5f5f4)',
      padding: '2px 8px',
      borderRadius: '6px',
    }}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="#FF4F00" stroke="none">
        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
      </svg>
      {stars.toLocaleString()}
    </span>
  );
}
