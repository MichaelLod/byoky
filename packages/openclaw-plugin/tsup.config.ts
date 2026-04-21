import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm'],
    dts: true,
    clean: true,
    // `@byoky/bridge/spawner` owns the child_process import; we resolve it
    // at runtime from the bridge dep so this bundle stays scanner-clean.
    external: ['openclaw', '@byoky/bridge/spawner'],
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
