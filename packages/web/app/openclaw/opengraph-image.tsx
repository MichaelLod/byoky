import { ogCard, ogSize } from '../og-card';

export const alt = 'Run OpenClaw with Byoky — your keys stay in your wallet';
export const size = ogSize;
export const contentType = 'image/png';

export default function Image() {
  return ogCard({
    badge: '5-MINUTE GUIDE',
    headline: 'RUN OPENCLAW',
    accent: 'WITH BYOKY',
    sub: 'Use your own API keys or your Claude Pro/Max subscription. Keys never leave your wallet.',
  });
}
