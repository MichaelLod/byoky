import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

// docs/brand/README.md: "never use the old orange (#FF4F00)". These are the
// surfaces people see: the site, the wallet popup, the SDK's connect modal,
// and the local pages `byoky-bridge connect` and the OpenClaw login open.
const ROOT = resolve(__dirname, '../../..');
const UI_SOURCES = [
  'packages/web/app',
  'packages/extension/entrypoints',
  'packages/sdk/src',
  'packages/bridge/src',
  'packages/openclaw-plugin/src',
];
const RETIRED = /#FF4F00|#e64500|#ff6a2a|rgba\(\s*255,\s*79,\s*0\b/i;

function sourceFiles(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(tsx?|css|html)$/.test(entry.name) ? [path] : [];
  });
}

describe('brand colours', () => {
  it('keep the retired orange theme out of every UI surface', () => {
    const files = UI_SOURCES.flatMap(sourceFiles);
    expect(files.length).toBeGreaterThan(50);
    const hits = files.filter((file) => RETIRED.test(readFileSync(join(ROOT, file), 'utf8')));
    expect(hits).toEqual([]);
  });
});
