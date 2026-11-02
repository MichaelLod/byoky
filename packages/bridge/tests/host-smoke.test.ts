import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The built host as the browser starts it: the installed wrapper runs
// `node bin/byoky-bridge.js host <caller origin>` and talks length-prefixed
// JSON over stdio. Needs the build (pnpm --filter @byoky/bridge build); CI's
// packages job builds it first.

const BRIDGE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(BRIDGE_DIR, 'bin', 'byoky-bridge.js');

function frame(msg: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(msg));
  const length = Buffer.alloc(4);
  length.writeUInt32LE(body.length);
  return Buffer.concat([length, body]);
}

describe.skipIf(!existsSync(join(BRIDGE_DIR, 'dist', 'host.js')))('byoky-bridge host (built)', () => {
  it('answers a framed ping with a pong and exits when the browser closes stdin', async () => {
    const home = mkdtempSync(join(tmpdir(), 'byoky-bridge-smoke-'));
    try {
      const host = spawn(process.execPath, [BIN, 'host', 'chrome-extension://ahhecmfcclkjdgjnmackoacldnmgmipl/'], {
        env: { ...process.env, HOME: home },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stderr = '';
      host.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
      const exited = new Promise<number | null>((resolve) => host.on('exit', resolve));

      const reply = new Promise<unknown>((resolve, reject) => {
        let buf = Buffer.alloc(0);
        host.stdout.on('data', (chunk: Buffer) => {
          buf = Buffer.concat([buf, chunk]);
          if (buf.length < 4) return;
          const length = buf.readUInt32LE(0);
          if (buf.length >= 4 + length) resolve(JSON.parse(buf.subarray(4, 4 + length).toString('utf8')));
        });
        host.on('exit', (code) => reject(new Error(`host exited (${code}) before replying: ${stderr}`)));
      });
      host.stdin.write(frame({ type: 'ping' }));

      expect(await reply).toMatchObject({ type: 'pong' });
      host.stdin.end();
      expect(await exited).toBe(0);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }, 15_000);
});
