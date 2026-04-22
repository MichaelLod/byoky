import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/host.ts', 'src/installer.ts', 'src/relay-mode.ts', 'src/spawner.ts', 'src/connect-mode.ts'],
    format: ['esm'],
    dts: true,
    clean: true,
    target: 'node20',
  },
  {
    // Browser IIFE bundle served to the connect page at /auth-sdk.js.
    entry: { 'auth-sdk': 'src/auth-sdk.ts' },
    format: ['iife'],
    globalName: 'ByokySDK',
    platform: 'browser',
    noExternal: [/.*/],
    dts: false,
    minify: true,
    clean: false,
    outExtension: () => ({ js: '.js' }),
  },
]);
