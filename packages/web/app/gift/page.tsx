import type { Metadata } from 'next';
import { GiftRedeem } from './GiftRedeem';

export const metadata: Metadata = {
  title: 'Redeem Gift',
  description:
    'Redeem a Byoky token gift. Open this link in the Byoky extension or mobile app to accept shared token access.',
  alternates: {
    canonical: '/gift',
  },
};

export default function GiftPage() {
  return <GiftRedeem />;
}
