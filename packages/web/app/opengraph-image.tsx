import { ogCard, ogSize } from './og-card';

export const alt = 'Byoky — The MetaMask for API keys';
export const size = ogSize;
export const contentType = 'image/png';

export default function Image() {
  return ogCard({
    badge: 'OPEN SOURCE · NO SERVERS',
    headline: 'THE METAMASK',
    accent: 'FOR API KEYS',
    sub: 'Keep every AI API key in one wallet. Apps connect to the wallet. Your keys never leave Byoky.',
  });
}
