import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm'],
    dts: true,
    clean: true,
    external: ['openclaw'],
    // Inline the bridge's token and manifest modules so the plugin shares
    // their code with `byoky-bridge` without a runtime import of a package
    // version that may lag behind.
    noExternal: [/^@byoky\/bridge\//],
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
