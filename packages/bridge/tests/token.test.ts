import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, statSync, writeFileSync, readdirSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

// token.ts resolves ~/.byoky-bridge when it loads, so point HOME at a
// scratch dir first — and refuse to run if that didn't take, rather than
// touch the real token.
const home = mkdtempSync(join(tmpdir(), 'byoky-bridge-token-'));
process.env.HOME = home;
if (homedir() !== home) throw new Error('HOME override not visible to os.homedir()');
const { loadOrCreateToken, TOKEN_FILE } = await import('../src/token.js');

describe('bridge token file', () => {
  it('creates a 32-byte base64url token, 0600 in a 0700 directory', () => {
    const token = loadOrCreateToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(TOKEN_FILE).toBe(join(home, '.byoky-bridge', 'token'));
    expect(statSync(TOKEN_FILE).mode & 0o777).toBe(0o600);
    expect(statSync(dirname(TOKEN_FILE)).mode & 0o777).toBe(0o700);
    // No temp file left behind.
    expect(readdirSync(dirname(TOKEN_FILE))).toEqual(['token']);
  });

  it('stays the same across calls', () => {
    const first = loadOrCreateToken();
    expect(loadOrCreateToken()).toBe(first);
    expect(readFileSync(TOKEN_FILE, 'utf8').trim()).toBe(first);
  });

  it('replaces a file that holds no valid token', () => {
    writeFileSync(TOKEN_FILE, 'byoky\n');
    const token = loadOrCreateToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(readFileSync(TOKEN_FILE, 'utf8').trim()).toBe(token);
    expect(statSync(TOKEN_FILE).mode & 0o777).toBe(0o600);
  });
});
