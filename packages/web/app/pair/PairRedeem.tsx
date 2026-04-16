'use client';

import { useEffect, useRef, useState } from 'react';
import { decodePairPayload, type PairPayload } from '@byoky/sdk';

const IOS_STORE = 'https://apps.apple.com/app/byoky/id6760779919';
const ANDROID_STORE = 'https://play.google.com/store/apps/details?id=com.byoky.app';
const CHROME_STORE = 'https://chromewebstore.google.com/detail/byoky/igjohldpldlahcjmefdhlnbcpldlgmon';
const FIREFOX_STORE = 'https://addons.mozilla.org/en-US/firefox/addon/byoky/';

type Platform = 'ios' | 'android' | 'desktop' | 'unknown';

function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'desktop';
}

function extractEncoded(): string | null {
  if (typeof window === 'undefined') return null;
  const hash = window.location.hash;
  if (hash.startsWith('#') && hash.length > 1) return decodeURIComponent(hash.slice(1));
  const p = window.location.pathname.replace(/\/+$/, '');
  if (p.startsWith('/pair/')) {
    const seg = p.slice('/pair/'.length);
    if (seg) return decodeURIComponent(seg);
  }
  return null;
}

function safeOrigin(o: string): string {
  try {
    return new URL(o).host;
  } catch {
    return o;
  }
}

export function PairRedeem() {
  const [platform, setPlatform] = useState<Platform>('unknown');
  const [encoded, setEncoded] = useState<string | null>(null);
  const [preview, setPreview] = useState<PairPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const autoTried = useRef(false);

  useEffect(() => {
    setPlatform(detectPlatform());
    const enc = extractEncoded();
    if (!enc) {
      setError('No pairing link provided');
      return;
    }
    setEncoded(enc);
    const payload = decodePairPayload(enc);
    if (!payload) {
      setError('Invalid pairing link');
      return;
    }
    setPreview(payload);
  }, []);

  useEffect(() => {
    if (!preview || !encoded || autoTried.current) return;
    if (platform !== 'ios' && platform !== 'android') return;
    autoTried.current = true;

    if (platform === 'android') {
      const fallback = encodeURIComponent(ANDROID_STORE);
      window.location.href = `intent://pair/${encoded}#Intent;scheme=byoky;package=com.byoky.app;S.browser_fallback_url=${fallback};end`;
      return;
    }

    const iframe = document.createElement('iframe');
    iframe.src = `byoky://pair/${encoded}`;
    iframe.style.cssText = 'position:fixed;top:-1px;left:-1px;width:1px;height:1px;opacity:0;pointer-events:none;border:0;';
    document.body.appendChild(iframe);
    const timer = window.setTimeout(() => {
      iframe.remove();
      if (document.hidden) return;
      window.location.href = IOS_STORE;
    }, 1500);
    const onHidden = () => { if (document.hidden) window.clearTimeout(timer); };
    document.addEventListener('visibilitychange', onHidden, { once: true });
  }, [preview, encoded, platform]);

  async function copyLink() {
    if (!encoded) return;
    try {
      await navigator.clipboard.writeText(`https://byoky.com/pair#${encoded}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard may be blocked */
    }
  }

  function retryMobile() {
    if (!encoded || (platform !== 'ios' && platform !== 'android')) return;
    autoTried.current = false;
    if (platform === 'android') {
      const fallback = encodeURIComponent(ANDROID_STORE);
      window.location.href = `intent://pair/${encoded}#Intent;scheme=byoky;package=com.byoky.app;S.browser_fallback_url=${fallback};end`;
    } else {
      window.location.href = `byoky://pair/${encoded}`;
    }
  }

  return (
    <div className="pair-wrap">
      <div className="pair-icon">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--teal, #2dd4bf)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          <path d="M9 12l2 2 4-4" />
        </svg>
      </div>

      {error ? (
        <>
          <h1>Pairing unavailable</h1>
          <p className="pair-sub">{error}</p>
        </>
      ) : !preview ? (
        <>
          <h1>Opening pair link</h1>
          <p className="pair-sub">Decoding the link…</p>
        </>
      ) : (
        <>
          <h1>Connect to {safeOrigin(preview.o)}</h1>
          <p className="pair-sub">
            Pair your Byoky mobile wallet so this web app can proxy requests through your phone.
          </p>

          {platform === 'ios' || platform === 'android' ? (
            <div className="pair-panel">
              <p className="pair-panel-title">Opening the Byoky app…</p>
              <p className="pair-panel-note">
                If nothing happens, you&apos;ll be redirected to the{' '}
                {platform === 'ios' ? 'App Store' : 'Play Store'} to install Byoky.
              </p>
              <div className="pair-actions">
                <button className="pair-btn pair-btn-primary" onClick={retryMobile}>
                  Open in Byoky
                </button>
                <a
                  className="pair-btn pair-btn-secondary"
                  href={platform === 'ios' ? IOS_STORE : ANDROID_STORE}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Get Byoky on {platform === 'ios' ? 'App Store' : 'Play Store'}
                </a>
              </div>
            </div>
          ) : (
            <div className="pair-panel">
              <p className="pair-panel-title">Scan this link from your phone</p>
              <p className="pair-panel-note">
                Pair links are meant to be opened on a phone. Scan the QR shown
                on the web app with your phone&apos;s camera, or install the
                Byoky extension to connect on this device instead.
              </p>
              <div className="pair-actions">
                <a
                  className="pair-btn pair-btn-primary"
                  href={CHROME_STORE}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Chrome extension
                </a>
                <a
                  className="pair-btn pair-btn-secondary"
                  href={FIREFOX_STORE}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Firefox add-on
                </a>
              </div>
            </div>
          )}

          <button className="pair-link" onClick={copyLink}>
            {copied ? 'Link copied' : 'Copy pair link instead'}
          </button>
        </>
      )}

      <style>{`
        .pair-wrap {
          max-width: 460px;
          margin: 0 auto;
          padding: 120px 24px 80px;
          text-align: center;
        }
        .pair-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 64px;
          height: 64px;
          border-radius: 16px;
          background: rgba(45, 212, 191, 0.1);
          border: 1px solid rgba(45, 212, 191, 0.22);
          margin-bottom: 18px;
        }
        .pair-wrap h1 {
          font-size: 24px;
          font-weight: 800;
          letter-spacing: -0.02em;
          margin: 0 0 6px;
        }
        .pair-sub {
          color: var(--text-secondary);
          font-size: 14px;
          line-height: 1.5;
          margin: 0 0 24px;
        }
        .pair-panel {
          background: var(--bg-card, #fff);
          border: 1px solid var(--border, #e5e5e5);
          border-radius: 14px;
          padding: 20px;
          margin-bottom: 14px;
          text-align: center;
        }
        .pair-panel-title {
          font-size: 15px;
          font-weight: 700;
          margin: 0 0 6px;
          color: var(--text, #1a1a1a);
        }
        .pair-panel-note {
          font-size: 13px;
          color: var(--text-secondary);
          line-height: 1.5;
          margin: 0 0 16px;
        }
        .pair-actions {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .pair-btn {
          padding: 12px 16px;
          border-radius: 10px;
          font-size: 14px;
          font-weight: 700;
          cursor: pointer;
          border: none;
          text-decoration: none;
          transition: all 0.18s;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        .pair-btn-primary {
          background: #FF4F00;
          color: #fff;
        }
        .pair-btn-primary:hover { background: #e64500; transform: translateY(-1px); }
        .pair-btn-primary:disabled { opacity: 0.55; cursor: not-allowed; transform: none; }
        .pair-btn-secondary {
          background: var(--bg-elevated, #f5f5f4);
          color: var(--text, #1a1a1a);
        }
        .pair-btn-secondary:hover { background: var(--border, #e5e5e5); }
        .pair-link {
          background: transparent;
          border: none;
          color: var(--text-muted);
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          padding: 10px;
          text-decoration: underline;
          text-underline-offset: 3px;
        }
        .pair-link:hover { color: #FF4F00; }
      `}</style>
    </div>
  );
}
