import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@byoky/sdk', '@byoky/core'],
  async headers() {
    // Dev mode needs 'unsafe-eval' for React Refresh / HMR. Skip the strict
    // CSP entirely in dev — production keeps the full lockdown.
    if (process.env.NODE_ENV === 'development') {
      return [];
    }
    return [
      {
        source: '/api/apps/apps/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET, OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type' },
        ],
      },
      {
        source: '/api/apps/submit',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: 'https://byoky.com' },
          { key: 'Access-Control-Allow-Methods', value: 'POST, OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type' },
        ],
      },
      {
        source: '/api/apps/admin/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: 'https://byoky.com' },
          { key: 'Access-Control-Allow-Methods', value: 'GET, POST, OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type, Authorization' },
        ],
      },
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Content-Security-Policy',
            value: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://avatars.githubusercontent.com; connect-src 'self' wss://*.byoky.com https://*.byoky.com https://api.github.com https://gist.githubusercontent.com; frame-ancestors 'none';",
          },
        ],
      },
      {
        source: '/:path*',
        has: [{ type: 'host', value: 'chat.byoky.com' }],
        headers: [
          { key: 'X-Frame-Options', value: 'ALLOWALL' },
          {
            key: 'Content-Security-Policy',
            value: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' wss://*.byoky.com https://*.byoky.com; frame-ancestors *;",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
