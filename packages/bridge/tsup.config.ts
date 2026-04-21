import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/host.ts', 'src/installer.ts', 'src/relay-mode.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  target: 'node20',
});
