/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The console is a pure client of the vault API; no server secrets here.
  env: {
    NEXT_PUBLIC_VAULT_URL: process.env.NEXT_PUBLIC_VAULT_URL ?? 'http://localhost:3111',
  },
};
export default nextConfig;
