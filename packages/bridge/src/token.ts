/**
 * Bridge token: the secret every local client must present to the HTTP
 * proxy. Without it any program on the machine (an npm postinstall script,
 * another user, a container on the host network) could spend the wallet's
 * keys through 127.0.0.1.
 *
 * Generated once and kept at ~/.byoky-bridge/token (file 0600, directory
 * 0700), so users configure their tools once. `byoky-bridge token` prints it.
 *
 * No env lookups or child_process here: the OpenClaw plugin bundles this
 * file, and OpenClaw's install-time scanner blocks plugins that mix those
 * with network calls.
 */

import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import {
  chmodSync, existsSync, linkSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

const STORE_DIR = join(homedir(), '.byoky-bridge');
export const TOKEN_FILE = join(STORE_DIR, 'token');

// 32 random bytes, base64url without padding.
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

function readToken(): string | null {
  try {
    const token = readFileSync(TOKEN_FILE, 'utf8').trim();
    return TOKEN_RE.test(token) ? token : null;
  } catch {
    return null;
  }
}

/** Returns the bridge token, creating it on first use. */
export function loadOrCreateToken(): string {
  const existing = readToken();
  if (existing) return existing;

  if (!existsSync(STORE_DIR)) {
    mkdirSync(STORE_DIR, { recursive: true, mode: 0o700 });
  }
  try {
    chmodSync(STORE_DIR, 0o700);
  } catch { /* best-effort on platforms without chmod */ }

  // The bridge host and the CLI can both get here at once on first run.
  // Hard-linking a finished temp file into place creates the token
  // atomically; the loser gets EEXIST and reads the winner's token.
  const tmp = `${TOKEN_FILE}.${process.pid}.tmp`;
  writeFileSync(tmp, `${randomBytes(32).toString('base64url')}\n`, { mode: 0o600 });
  try {
    chmodSync(tmp, 0o600);
    if (existsSync(TOKEN_FILE)) {
      // Present but not a valid token (truncated or hand-edited): replace it.
      renameSync(tmp, TOKEN_FILE);
    } else {
      linkSync(tmp, TOKEN_FILE);
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
  } finally {
    try {
      unlinkSync(tmp);
    } catch { /* already renamed into place */ }
  }

  const token = readToken();
  if (!token) throw new Error(`Could not create the bridge token at ${TOKEN_FILE}`);
  return token;
}
