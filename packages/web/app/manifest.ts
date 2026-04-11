import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Byoky — Bring Your Own Key',
    short_name: 'Byoky',
    description:
      'A secure browser wallet for your LLM API keys and setup tokens. Connect to any app — your keys never leave the extension.',
    start_url: '/',
    display: 'browser',
    background_color: '#ffffff',
    theme_color: '#FF4F00',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  };
}
