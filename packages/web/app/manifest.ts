import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Byoky — MetaMask for AI',
    short_name: 'Byoky',
    description:
      'A secure browser wallet for your LLM API keys and setup tokens. Connect to any app — your keys never leave the extension.',
    start_url: '/',
    display: 'browser',
    background_color: '#0a0a0f',
    theme_color: '#a855f7',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  };
}
