import type { Metadata } from 'next';
import { GiftRedeem } from './GiftRedeem';

export const metadata: Metadata = {
  title: 'Redeem Gift',
  description:
    'Redeem a Byoky token gift. Open this link in the Byoky extension or mobile app to accept shared token access.',
  alternates: {
    canonical: '/gift',
  },
  openGraph: {
    title: 'A token gift for you — Byoky',
    description:
      'Someone shared a Byoky token gift with you. Open in the extension or mobile app to accept.',
    url: 'https://byoky.com/gift',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'A token gift for you — Byoky',
    description:
      'Someone shared a Byoky token gift with you. Open in the extension or mobile app to accept.',
  },
};

export default function GiftPage() {
  return <GiftRedeem />;
}
