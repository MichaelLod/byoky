'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

const DISMISS_KEY = 'byoky-ph-banner-dismissed-v1';
const PH_URL =
  'https://www.producthunt.com/products/byoky?embed=true&utm_source=badge-featured&utm_medium=badge&utm_campaign=badge-byoky';

export function ProductHuntBanner() {
  const pathname = usePathname();
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (pathname !== '/') {
      setShow(false);
      return;
    }
    try {
      setShow(localStorage.getItem(DISMISS_KEY) !== '1');
    } catch {
      setShow(true);
    }
  }, [pathname]);

  useEffect(() => {
    document.body.classList.toggle('has-ph-banner', show);
    return () => document.body.classList.remove('has-ph-banner');
  }, [show]);

  if (!show) return null;

  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // ignore
    }
    setShow(false);
  }

  return (
    <div className="ph-banner" role="region" aria-label="Product Hunt announcement">
      <a
        className="ph-banner-link"
        href={PH_URL}
        target="_blank"
        rel="noopener noreferrer"
      >
        <span className="ph-banner-logo" aria-hidden>
          <svg width="18" height="18" viewBox="0 0 40 40" fill="none">
            <circle cx="20" cy="20" r="20" fill="#DA552F" />
            <path
              d="M22.5 12h-7v16h3.5v-5h3.5a5.5 5.5 0 0 0 0-11zm0 7.5h-3.5v-4h3.5a2 2 0 0 1 0 4z"
              fill="#fff"
            />
          </svg>
        </span>
        <span className="ph-banner-text">
          We&rsquo;re live on <strong>Product Hunt</strong>
        </span>
        <span className="ph-banner-cta">Support us →</span>
      </a>
      <button
        type="button"
        className="ph-banner-close"
        aria-label="Dismiss Product Hunt announcement"
        onClick={dismiss}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
          <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
