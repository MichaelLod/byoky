'use client';

import { useEffect } from 'react';

const SHOW_BANNER = true;

export function ServerUpdateBanner() {
  useEffect(() => {
    if (!SHOW_BANNER) return;
    document.body.classList.add('has-server-banner');
    return () => document.body.classList.remove('has-server-banner');
  }, []);

  if (!SHOW_BANNER) return null;

  return (
    <div className="server-banner" role="status" aria-live="polite">
      <span className="server-banner-dot" aria-hidden />
      <span>
        We&rsquo;re updating the servers — gifts may be briefly offline. Hold tight!
      </span>
    </div>
  );
}
