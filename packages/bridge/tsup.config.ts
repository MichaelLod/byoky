import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/host.ts', 'src/installer.ts', 'src/relay-mode.ts', 'src/spawner.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  target: 'node20',
});
