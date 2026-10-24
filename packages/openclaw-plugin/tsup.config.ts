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
    // The page never has a `process`; dropping the SDK's dev-only env reads
    // (connectMock's BYOKY_DEV_KEYS) keeps OpenClaw's install-time scanner
    // from flagging the bundle as env access + network send.
    esbuildOptions(options) {
      options.define = { ...options.define, 'process.env': '{}' };
    },
    outExtension: () => ({ js: '.js' }),
  },
]);
