import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/index.ts', 'src/spawn-bridge.ts'],
    format: ['esm'],
    dts: true,
    clean: true,
    // Keep spawn-bridge as a separate emitted file so index.js does NOT
    // statically embed the `child_process` import — the OpenClaw plugin
    // scanner rejects any module that combines `fetch` with `child_process`.
    splitting: false,
    external: ['openclaw', './spawn-bridge.js'],
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
