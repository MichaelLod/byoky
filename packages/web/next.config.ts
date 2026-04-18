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
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Content-Security-Policy',
            value: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://avatars.githubusercontent.com https://unpkg.com; connect-src 'self' wss://*.byoky.com https://*.byoky.com https://api.github.com https://gist.githubusercontent.com; frame-ancestors 'none';",
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
            value: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://unpkg.com; connect-src 'self' wss://*.byoky.com https://*.byoky.com; frame-ancestors * chrome-extension: moz-extension: safari-web-extension:;",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
