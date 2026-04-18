'use client';

import { useEffect, useState } from 'react';
import { decodeGiftLink, validateGiftLink, isExtensionInstalled, type GiftLink } from '@byoky/sdk';

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
  if (p.startsWith('/gift/')) {
    const seg = p.slice('/gift/'.length);
    if (seg) return decodeURIComponent(seg);
  }
  return null;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function formatExpiry(ms: number): string {
  const diff = ms - Date.now();
  if (diff <= 0) return 'Expired';
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 1) return `${Math.ceil(diff / 60_000)}m left`;
  if (hours < 24) return `${hours}h left`;
  return `${Math.floor(hours / 24)}d left`;
}

function stageGiftInExtension(giftLink: string): Promise<boolean> {
  if (typeof window === 'undefined' || !isExtensionInstalled()) return Promise.resolve(false);
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timeout = setTimeout(() => {
      channel.port1.onmessage = null;
      resolve(false);
    }, 3000);
    channel.port1.onmessage = (event) => {
      clearTimeout(timeout);
      const payload = (event.data as { payload?: { ok?: boolean } } | undefined)?.payload;
      resolve(payload?.ok === true);
    };
    window.postMessage(
      {
        type: 'BYOKY_STAGE_GIFT',
        requestId:
          typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? crypto.randomUUID()
            : String(Math.random()),
        giftLink,
      },
      window.location.origin,
      [channel.port2],
    );
  });
}

export function GiftRedeem() {
  const [platform, setPlatform] = useState<Platform>('unknown');
  const [encoded, setEncoded] = useState<string | null>(null);
  const [preview, setPreview] = useState<GiftLink | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [extDetected, setExtDetected] = useState(false);
  const [copied, setCopied] = useState(false);
  const [staged, setStaged] = useState(false);
  const [staging, setStaging] = useState(false);

  useEffect(() => {
    setPlatform(detectPlatform());
    setExtDetected(isExtensionInstalled());
    const t = setTimeout(() => setExtDetected(isExtensionInstalled()), 400);
    const enc = extractEncoded();
    if (!enc) {
      setError('No gift link provided');
      return () => clearTimeout(t);
    }
    setEncoded(enc);
    const link = decodeGiftLink(enc);
    if (!link) { setError('Invalid gift link'); return () => clearTimeout(t); }
    const val = validateGiftLink(link);
    if (!val.valid) { setError(val.reason ?? 'Invalid gift'); return () => clearTimeout(t); }
    setPreview(link);
    return () => clearTimeout(t);
  }, []);

  function tryOpenApp() {
    if (!encoded) return;
    if (platform === 'android') {
      const fallback = encodeURIComponent(ANDROID_STORE);
      window.location.href = `intent://gift/${encoded}#Intent;scheme=byoky;package=com.byoky.app;S.browser_fallback_url=${fallback};end`;
      return;
    }
    if (platform !== 'ios') return;

    const iframe = document.createElement('iframe');
    iframe.src = `byoky://gift/${encoded}`;
    iframe.style.cssText = 'position:fixed;top:-1px;left:-1px;width:1px;height:1px;opacity:0;pointer-events:none;border:0;';
    document.body.appendChild(iframe);

    const cleanup = () => {
      iframe.remove();
      document.removeEventListener('visibilitychange', onVisibility);
      window.clearTimeout(timer);
    };
    const onVisibility = () => {
      if (document.hidden) cleanup();
    };
    const timer = window.setTimeout(() => {
      cleanup();
      if (document.hidden) return;
      window.location.href = IOS_STORE;
    }, 1500);
    document.addEventListener('visibilitychange', onVisibility);
  }

  async function handleStage() {
    if (!encoded) return;
    const giftLink = `https://byoky.com/gift#${encoded}`;
    setStaging(true);
    const ok = await stageGiftInExtension(giftLink);
    setStaging(false);
    setStaged(ok);
  }

  async function copyLink() {
    if (!encoded) return;
    try {
      await navigator.clipboard.writeText(`https://byoky.com/gift#${encoded}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard may be blocked */
    }
  }

  function retryMobile() {
    tryOpenApp();
  }

  return (
    <div className="gift-wrap">
      <div className="gift-icon">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--teal, #2dd4bf)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 12v10H4V12" />
          <path d="M2 7h20v5H2z" />
          <path d="M12 22V7" />
          <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" />
          <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" />
        </svg>
      </div>

      {error ? (
        <>
          <h1>Gift unavailable</h1>
          <p className="gift-sub">{error}</p>
        </>
      ) : !preview ? (
        <>
          <h1>Opening gift</h1>
          <p className="gift-sub">Decoding the link…</p>
        </>
      ) : (
        <>
          <h1>Token gift from {preview.s}</h1>
          <p className="gift-sub">
            {formatTokens(preview.m)} {preview.n} tokens · {formatExpiry(preview.e)}
          </p>

          {platform === 'ios' || platform === 'android' ? (
            <div className="gift-panel">
              <p className="gift-panel-title">Accept this gift in Byoky</p>
              <p className="gift-panel-note">
                Tap below to open it in the app. If you don&apos;t have Byoky yet,
                you&apos;ll be taken to the {platform === 'ios' ? 'App Store' : 'Play Store'}.
              </p>
              <div className="gift-actions">
                <button className="gift-btn gift-btn-primary" onClick={retryMobile}>
                  Accept gift in Byoky
                </button>
              </div>
            </div>
          ) : (
            <div className="gift-panel">
              {staged ? (
                <>
                  <p className="gift-panel-title">Sent to your extension</p>
                  <p className="gift-panel-note">
                    Click the Byoky icon in your browser toolbar to review and accept.
                  </p>
                </>
              ) : extDetected ? (
                <>
                  <p className="gift-panel-title">Byoky extension detected</p>
                  <p className="gift-panel-note">
                    We can send this gift straight to your wallet. You&apos;ll review it
                    before anything is added.
                  </p>
                  <div className="gift-actions">
                    <button
                      className="gift-btn gift-btn-primary"
                      onClick={handleStage}
                      disabled={staging}
                    >
                      {staging ? 'Sending…' : 'Open in Byoky'}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="gift-panel-title">Install Byoky to accept</p>
                  <p className="gift-panel-note">
                    Byoky keeps your API keys local and proxies requests on your behalf.
                  </p>
                  <div className="gift-actions">
                    <a
                      className="gift-btn gift-btn-primary"
                      href={CHROME_STORE}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Chrome extension
                    </a>
                    <a
                      className="gift-btn gift-btn-secondary"
                      href={FIREFOX_STORE}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Firefox add-on
                    </a>
                  </div>
                </>
              )}
            </div>
          )}

          <button className="gift-link" onClick={copyLink}>
            {copied ? 'Link copied' : 'Copy gift link instead'}
          </button>
        </>
      )}

      <style>{`
        .gift-wrap {
          max-width: 460px;
          margin: 0 auto;
          padding: 120px 24px 80px;
          text-align: center;
        }
        .gift-icon {
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
        .gift-wrap h1 {
          font-size: 24px;
          font-weight: 800;
          letter-spacing: -0.02em;
          margin: 0 0 6px;
        }
        .gift-sub {
          color: var(--text-secondary);
          font-size: 14px;
          line-height: 1.5;
          margin: 0 0 24px;
        }
        .gift-panel {
          background: var(--bg-card, #fff);
          border: 1px solid var(--border, #e5e5e5);
          border-radius: 14px;
          padding: 20px;
          margin-bottom: 14px;
          text-align: center;
        }
        .gift-panel-title {
          font-size: 15px;
          font-weight: 700;
          margin: 0 0 6px;
          color: var(--text, #1a1a1a);
        }
        .gift-panel-note {
          font-size: 13px;
          color: var(--text-secondary);
          line-height: 1.5;
          margin: 0 0 16px;
        }
        .gift-actions {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .gift-btn {
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
        .gift-btn-primary {
          background: #FF4F00;
          color: #fff;
        }
        .gift-btn-primary:hover { background: #e64500; transform: translateY(-1px); }
        .gift-btn-primary:disabled { opacity: 0.55; cursor: not-allowed; transform: none; }
        .gift-btn-secondary {
          background: var(--bg-elevated, #f5f5f4);
          color: var(--text, #1a1a1a);
        }
        .gift-btn-secondary:hover { background: var(--border, #e5e5e5); }
        .gift-link {
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
        .gift-link:hover { color: #FF4F00; }
      `}</style>
    </div>
  );
}
