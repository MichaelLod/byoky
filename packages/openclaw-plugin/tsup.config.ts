import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm'],
    dts: true,
    clean: true,
    external: ['openclaw'],
  },
  {
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
