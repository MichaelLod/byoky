import { defineConfig } from 'tsup';

export default defineConfig([
  // Main package: ESM + CJS for Node, extension, and SDK consumers.
  {
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    clean: true,
    sourcemap: false,
  },
  // Mobile bundle: self-contained IIFE for embedding in iOS JavaScriptCore
  // and Android Hermes/QuickJS. Must not pull in any Node-specific globals
  // (no process, no Buffer, no require). platform: 'neutral' enforces this.
  // The bundle assigns globalThis.BYOKY_TRANSLATE in its module body, so the
  // native side just evaluates the file once and then calls the global.
  {
    entry: { mobile: 'src/translate/mobile-entry.ts' },
    format: ['iife'],
    globalName: 'BYOKY_TRANSLATE_BUNDLE',
    platform: 'neutral',
    clean: false,
    dts: false,
    sourcemap: false,
    minify: false,
    outExtension: () => ({ js: '.js' }),
    noExternal: [/.*/],
  },
]);
