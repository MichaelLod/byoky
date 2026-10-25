// Builds the extension for the marketing captures into marketing/raw/ext-build
// instead of packages/extension/.output, so a capture run never replaces a build
// someone else is testing. Usage (from the repo root):
//   pnpm --filter @byoky/extension exec wxt build -c ../../marketing/scripts/wxt.marketing.config.ts
// No `wxt` import here: this file is resolved from marketing/, which doesn't
// depend on wxt. defineConfig is an identity function anyway.
import path from 'path';
import base from '../../packages/extension/wxt.config';

export default {
  ...base,
  outDir: path.resolve(__dirname, '../raw/ext-build'),
};
