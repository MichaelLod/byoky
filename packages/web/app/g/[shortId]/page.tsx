import type { Metadata } from 'next';
import { GiftRedeem } from '../../gift/GiftRedeem';

export async function generateMetadata(): Promise<Metadata> {
  // The short-link route resolves its payload client-side (via the vault),
  // so we can't cheaply look up gift details during metadata generation.
  // Use the generic gift card; the canonical /gift URL carries rich metadata
  // for crawlers that follow it.
  const title = 'A token gift for you — Byoky';
  const description =
    'Someone shared a Byoky token gift with you. Open in the extension or mobile app to accept.';
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: 'https://byoky.com/gift',
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
  };
}

export default function GiftShortPage() {
  return <GiftRedeem />;
}
