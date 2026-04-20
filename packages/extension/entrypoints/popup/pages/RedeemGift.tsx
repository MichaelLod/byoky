import { useState, useEffect, type FormEvent } from 'react';
import { useWalletStore } from '../store';
import { decodeGiftLink, validateGiftLink, extractGiftShortId, type GiftLink } from '@byoky/core';

export function RedeemGift() {
  const { redeemGift, resolveGiftShortLink, closeModal, dismissPendingGift, pendingGiftLink, error, loading } = useWalletStore();
  const [linkInput, setLinkInput] = useState('');
  const [preview, setPreview] = useState<GiftLink | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  // Holds the fully-decoded encoded blob once we've resolved the input.
  // Populated for both long URLs (immediate strip) and short URLs (after
  // vault lookup) so handleSubmit doesn't have to redo the work.
  const [resolvedEncoded, setResolvedEncoded] = useState<string | null>(null);

  useEffect(() => {
    if (pendingGiftLink && !linkInput) {
      void handleParse(pendingGiftLink);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingGiftLink]);

  function stripLongUrlPrefix(input: string): string {
    let encoded = input.trim();
    if (encoded.startsWith('https://byoky.com/gift#')) {
      encoded = encoded.replace('https://byoky.com/gift#', '');
    } else if (encoded.startsWith('https://byoky.com/gift/')) {
      encoded = encoded.replace('https://byoky.com/gift/', '');
    } else if (encoded.startsWith('byoky://gift/')) {
      encoded = encoded.replace('byoky://gift/', '');
    }
    return encoded;
  }

  async function handleParse(value: string) {
    setLinkInput(value);
    setParseError(null);
    setPreview(null);
    setResolvedEncoded(null);

    const trimmed = value.trim();
    if (!trimmed) return;

    let encoded: string;
    const shortId = extractGiftShortId(trimmed);
    const looksShort = shortId && /^(https?:\/\/|byoky:\/\/)/.test(trimmed);
    if (looksShort) {
      setResolving(true);
      const res = await resolveGiftShortLink(shortId!);
      setResolving(false);
      if (res.error || !res.encoded) {
        setParseError(res.error ?? 'Could not resolve gift link');
        return;
      }
      encoded = res.encoded;
    } else {
      encoded = stripLongUrlPrefix(trimmed);
    }

    const link = decodeGiftLink(encoded);
    if (!link) {
      setParseError('Invalid gift link format');
      return;
    }

    const validation = validateGiftLink(link);
    if (!validation.valid) {
      setParseError(validation.reason ?? 'Invalid gift');
      return;
    }

    setPreview(link);
    setResolvedEncoded(encoded);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!preview || !resolvedEncoded) return;
    await redeemGift(resolvedEncoded);
  }

  function formatTokens(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
    return String(n);
  }

  function formatExpiry(ms: number): string {
    const date = new Date(ms);
    const now = new Date();
    const diffMs = ms - now.getTime();
    if (diffMs <= 0) return 'Expired';
    const days = Math.floor(diffMs / (24 * 60 * 60 * 1000));
    const hours = Math.floor((diffMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
    if (days > 0) return `${days}d ${hours}h (${date.toLocaleDateString()})`;
    return `${hours}h (${date.toLocaleTimeString()})`;
  }

  return (
    <div>
      <p className="page-subtitle">
        Paste a gift link to receive token access from another Byoky user.
      </p>

      {(error || parseError) && <div className="error">{error || parseError}</div>}
      {resolving && <div className="form-hint">Resolving short link…</div>}

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="gift-link">Gift link</label>
          <textarea
            id="gift-link"
            value={linkInput}
            onChange={(e) => void handleParse(e.target.value)}
            placeholder="https://byoky.com/g/... or https://byoky.com/gift/..."
            rows={3}
          />
        </div>

        {preview && (
          <div className="gift-preview">
            <div className="gift-preview-header">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 12v10H4V12" />
                <path d="M2 7h20v5H2z" />
                <path d="M12 22V7" />
                <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" />
                <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" />
              </svg>
              <span>Token gift from <strong>{preview.s}</strong></span>
            </div>
            <div className="gift-preview-details">
              <div className="gift-preview-row">
                <span className="gift-preview-label">Provider</span>
                <span>{preview.n}</span>
              </div>
              <div className="gift-preview-row">
                <span className="gift-preview-label">Budget</span>
                <span>{formatTokens(preview.m)} tokens</span>
              </div>
              <div className="gift-preview-row">
                <span className="gift-preview-label">Expires</span>
                <span>{formatExpiry(preview.e)}</span>
              </div>
              <div className="gift-preview-row">
                <span className="gift-preview-label">Relay</span>
                <span className="gift-preview-relay">{new URL(preview.r).host}</span>
              </div>
            </div>
            <div className="gift-security-note" style={{ marginTop: '12px' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                <path d="M9 12l2 2 4-4" />
              </svg>
              <span>
                Requests will be relayed through the sender&apos;s wallet.
                The sender&apos;s API key is never exposed to you.
              </span>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              if (pendingGiftLink) dismissPendingGift();
              closeModal();
            }}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={loading || !preview}
          >
            Accept Gift
          </button>
        </div>
      </form>
    </div>
  );
}
