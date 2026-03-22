import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@byoky/sdk', '@byoky/core'],
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Content-Security-Policy',
            value: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://api.qrserver.com; connect-src 'self' ws://localhost:* ws://127.0.0.1:* wss://*.byoky.com; frame-ancestors 'none';",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
