import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Byoky — Bring Your Own Key',
    short_name: 'Byoky',
    description:
      'The MetaMask for API keys. Keep every AI API key in one wallet. Apps connect to the wallet, and your keys never leave Byoky.',
    start_url: '/',
    display: 'browser',
    background_color: '#07060A',
    theme_color: '#07060A',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  };
}
