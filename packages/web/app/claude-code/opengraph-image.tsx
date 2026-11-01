import { ogCard, ogSize } from '../og-card';

export const alt = 'Run Claude Code with Byoky — on your existing Claude Pro/Max plan';
export const size = ogSize;
export const contentType = 'image/png';

export default function Image() {
  return ogCard({
    badge: '5-MINUTE GUIDE',
    headline: 'RUN CLAUDE CODE',
    accent: 'WITH BYOKY',
    sub: 'Use your Claude Pro/Max subscription or your own API key, kept in your Byoky wallet.',
  });
}
