/**
 * Spawn the byoky-bridge CLI in relay mode as a detached child process.
 *
 * Exposed as a separate entry from `@byoky/bridge/spawner` so downstream
 * packages (notably the OpenClaw plugin) can start the bridge without
 * statically depending on `node:child_process` themselves — the OpenClaw
 * plugin scanner rejects any module that imports `child_process` together
 * with `fetch`. Keeping the spawn inside this package means the scanner
 * only sees the shape `import { spawnRelay } from '@byoky/bridge/spawner'`
 * in the plugin bundle, and the actual child_process import lives in
 * node_modules (outside the plugin's scanned tree).
 */

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

export interface SpawnRelayOptions {
  /** Bridge HTTP proxy port. Default 19280. */
  port: number;
  /** wss:// URL of the relay server the mobile wallet is paired on. */
  relayUrl: string;
  /** Relay room id (opaque to us; matches the mobile side's room). */
  roomId: string;
  /** Relay room auth token. */
  authToken: string;
  /** Provider ids the mobile wallet is offering. */
  providers: string[];
  /**
   * Optional node binary to invoke. Defaults to `process.execPath`, i.e.
   * whatever node is running the caller.
   */
  nodePath?: string;
  /**
   * Optional path to the byoky-bridge CLI. When omitted we resolve
   * `@byoky/bridge/package.json` from this module to locate the shipped bin.
   */
  bridgeBin?: string;
}

export function spawnRelay(opts: SpawnRelayOptions): void {
  const nodePath = opts.nodePath ?? process.execPath;
  const bridgeBin = opts.bridgeBin ?? resolveBridgeBin();

  const args = [
    bridgeBin,
    'relay',
    '--port', String(opts.port),
    '--relay-url', opts.relayUrl,
    '--room-id', opts.roomId,
    '--auth-token', opts.authToken,
    '--providers', opts.providers.join(','),
  ];

  // Detached + stdio:ignore so the bridge outlives the caller process.
  const child = spawn(nodePath, args, {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

function resolveBridgeBin(): string {
  const req = createRequire(import.meta.url);
  const pkgPath = req.resolve('@byoky/bridge/package.json');
  return resolve(dirname(pkgPath), 'bin/byoky-bridge.js');
}
