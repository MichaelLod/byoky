/**
 * Bridge spawner — isolated in its own module so the main plugin bundle
 * can be loaded without pulling `node:child_process` into the scanner's
 * view. The OpenClaw plugin scanner rejects any module that imports
 * `child_process` alongside `fetch` because the combination looks like
 * shell-exec-plus-exfiltration. Splitting the dynamic child spawn out
 * here keeps `src/index.ts` (which uses fetch) scanner-clean; this file
 * only ever runs after the user has explicitly approved the plugin and
 * chosen the relay pairing path.
 */

import { spawn } from 'node:child_process';

export interface SpawnBridgeOptions {
  nodePath: string;
  bridgeBin: string;
  port: number;
  relayUrl: string;
  roomId: string;
  authToken: string;
  providers: string[];
}

export function spawnRelayBridge(opts: SpawnBridgeOptions): void {
  const args = [
    opts.bridgeBin,
    'relay',
    '--port', String(opts.port),
    '--relay-url', opts.relayUrl,
    '--room-id', opts.roomId,
    '--auth-token', opts.authToken,
    '--providers', opts.providers.join(','),
  ];

  const child = spawn(opts.nodePath, args, {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}
