import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

// hermes-setup reads the bridge token from ~/.byoky-bridge; keep it in a
// scratch HOME (see token.test.ts).
const home = mkdtempSync(join(tmpdir(), 'byoky-bridge-hermes-'));
process.env.HOME = home;
if (homedir() !== home) throw new Error('HOME override not visible to os.homedir()');
const { runHermesSetup } = await import('../src/hermes-setup.js');
const { loadOrCreateToken } = await import('../src/token.js');

function writeConfig(lines: string[]): string {
  const path = join(home, `config-${Math.random().toString(36).slice(2)}.yaml`);
  writeFileSync(path, lines.join('\n'));
  return path;
}

describe('hermes-setup', () => {
  it('writes the bridge token as api_key and follows indented list items', () => {
    const path = writeConfig([
      'model:',
      '  default: claude-opus-4-7',
      '  provider: anthropic',
      '',
      'custom_providers:',
      '  - name: local',
      '    base_url: http://localhost:8080/v1',
      '',
      'display:',
      '  theme: dark',
      '',
    ]);
    runHermesSetup({ configPath: path });
    const out = readFileSync(path, 'utf8');
    expect(out).toContain([
      '  - name: local',
      '    base_url: http://localhost:8080/v1',
      '  - name: byoky-anthropic',
      '    base_url: http://127.0.0.1:19280/anthropic',
      `    api_key: '${loadOrCreateToken()}'`,
      '    api_mode: anthropic_messages',
      '',
      'display:',
    ].join('\n'));
    // A Claude model the user already picked is kept without --model.
    expect(out).toContain('  default: claude-opus-4-7');
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(runHermesSetup({ configPath: path }).alreadyConfigured).toBe(true);
  });

  it('replaces the empty api_key older versions wrote', () => {
    const path = writeConfig([
      'model:',
      '  default: claude-sonnet-4-6',
      '  provider: byoky-anthropic',
      '',
      'custom_providers:',
      '- name: byoky-anthropic',
      '  base_url: http://127.0.0.1:19280/anthropic',
      "  api_key: ''",
      '  api_mode: anthropic_messages',
      '',
    ]);
    const result = runHermesSetup({ configPath: path });
    expect(result.changes).toEqual(['byoky-anthropic.api_key → bridge token']);
    expect(readFileSync(path, 'utf8')).toContain(`  api_key: '${loadOrCreateToken()}'`);
  });

  it('applies an explicit --model even over another Claude model', () => {
    const path = writeConfig([
      'model:',
      '  default: claude-opus-4-7',
      '  provider: byoky-anthropic',
      '',
      'custom_providers: []',
      '',
    ]);
    runHermesSetup({ configPath: path, model: 'claude-haiku-4-5' });
    const out = readFileSync(path, 'utf8');
    expect(out).toContain('  default: claude-haiku-4-5');
    expect(out).toContain('custom_providers:\n- name: byoky-anthropic\n');
    expect(out).not.toContain('[]');
  });
});
