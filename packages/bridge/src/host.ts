/**
 * Native Messaging Host for Byoky Bridge.
 *
 * Communicates with the Byoky browser extension via Chrome/Firefox native
 * messaging protocol (stdin/stdout with length-prefixed JSON). What it does
 * with each message lives in host-core.ts.
 */

import { createHost } from './host-core.js';
import { loadOrCreateToken } from './token.js';
import { createMessageReader } from './native-messaging.js';

// --- Native messaging I/O ---

// The browser allows up to 64 MiB per message; past this one is dropped
// rather than buffered, and the request it carried answered with an error.
const MAX_INCOMING_MESSAGE_BYTES = 20_971_520; // 20 MiB

function writeMessage(msg: unknown): void {
  const json = JSON.stringify(msg);
  const buf = Buffer.from(json, 'utf-8');
  const lengthBuf = Buffer.alloc(4);
  lengthBuf.writeUInt32LE(buf.length, 0);
  process.stdout.write(lengthBuf);
  process.stdout.write(buf);
}

const host = createHost({ writeMessage, loadToken: loadOrCreateToken });

// --- Main loop ---

// The extension launches a host process for every availability ping and
// setup-token request too, so the HTTP proxy only ever starts on an
// explicit `start-proxy`. (The extension re-sends it after a service-worker
// restart; restoring a saved session at launch made every short-lived host
// race the real one for the port.)
//
// Messages are handled concurrently: a long streaming fetch must not hold
// up the next request or a `proxy_http_response_*` message.
process.stdin.on('data', createMessageReader((msg) => {
  void host.handleMessage(msg).catch((e: unknown) => {
    process.stderr.write(`byoky-bridge: ${e instanceof Error ? e.message : 'message failed'}\n`);
  });
}, MAX_INCOMING_MESSAGE_BYTES, (msg) => host.handleOversized(msg)));
// stdin closed = extension disconnected
process.stdin.on('end', () => process.exit(0));
