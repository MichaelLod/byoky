import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@byoky/sdk', '@byoky/core'],
  async redirects() {
    // Byoky no longer runs a token pool, gift links, QR pairing or an app
    // registry. Old shared links land on the home page instead of a 404.
    return [
      { source: '/apps', destination: '/', permanent: true },
      { source: '/apps/:path*', destination: '/', permanent: true },
      { source: '/token-pool', destination: '/', permanent: true },
      { source: '/token-pool/:path*', destination: '/', permanent: true },
      { source: '/marketplace', destination: '/', permanent: true },
      { source: '/marketplace/:path*', destination: '/', permanent: true },
      { source: '/gift', destination: '/', permanent: true },
      { source: '/gift/:path*', destination: '/', permanent: true },
      { source: '/g/:path*', destination: '/', permanent: true },
      { source: '/pair', destination: '/', permanent: true },
      { source: '/pair/:path*', destination: '/', permanent: true },
      { source: '/blog/v0-6-0-gifts-everywhere', destination: '/blog', permanent: true },
      // The mini-app developer hub; READMEs scaffolded by create-byoky-app still link here.
      { source: '/dev', destination: '/docs', permanent: true },
      { source: '/dev/:path*', destination: '/docs', permanent: true },
    ];
  },
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
            value: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://avatars.githubusercontent.com https://unpkg.com https://api.producthunt.com; connect-src 'self' https://api.github.com; frame-ancestors 'none';",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
