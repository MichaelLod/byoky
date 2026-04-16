import type { Metadata } from 'next';
import { PairRedeem } from './PairRedeem';

export const metadata: Metadata = {
  title: 'Connect Byoky',
  description:
    'Pair the Byoky mobile app with a web app. Open this link on your phone to connect your wallet via the relay.',
  alternates: {
    canonical: '/pair',
  },
};

export default function PairPage() {
  return <PairRedeem />;
}
