import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@byoky/sdk', '@byoky/core'],
};

export default nextConfig;
