import type { Metadata } from 'next';
import { decodeGiftLink, validateGiftLink } from '@byoky/sdk';
import { GiftRedeem } from '../GiftRedeem';

type Params = Promise<{ encoded: string }>;

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function formatExpiry(ms: number): string {
  const diff = ms - Date.now();
  if (diff <= 0) return 'expired';
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 1) return `${Math.ceil(diff / 60_000)}m left`;
  if (hours < 24) return `${hours}h left`;
  return `${Math.floor(hours / 24)}d left`;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { encoded } = await params;
  const link = decodeGiftLink(encoded);
  const valid = link && validateGiftLink(link).valid;

  const title = link && valid
    ? `${formatTokens(link.m)} ${link.n} tokens from ${link.s}`
    : 'A token gift for you — Byoky';
  const description = link && valid
    ? `${link.s} is sharing ${formatTokens(link.m)} ${link.n} tokens with you via Byoky · ${formatExpiry(link.e)}`
    : 'Someone shared a Byoky token gift with you. Open in the extension or mobile app to accept.';

  return {
    title,
    description,
    alternates: { canonical: `/gift/${encoded}` },
    openGraph: {
      title,
      description,
      url: `https://byoky.com/gift/${encoded}`,
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
  };
}

export default function GiftEncodedPage() {
  return <GiftRedeem />;
}
