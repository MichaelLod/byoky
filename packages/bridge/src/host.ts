/**
 * Native Messaging Host for Byoky Bridge.
 *
 * Communicates with the Byoky browser extension via Chrome/Firefox native
 * messaging protocol (stdin/stdout with length-prefixed JSON).
 *
 * Receives Anthropic Messages API requests, routes them through Claude Code CLI
 * using the user's setup token, and returns standard API responses.
 */

import { translateRequest, type AnthropicRequest } from './translator.js';

interface BridgeRequest {
  type: 'proxy';
  requestId: string;
  setupToken: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

interface BridgeResponse {
  type: 'proxy_response';
  requestId: string;
  status: number;
  headers: Record<string, string>;
  body: string;
}

interface BridgeError {
  type: 'proxy_error';
  requestId: string;
  error: string;
}

interface BridgePing {
  type: 'ping';
}

interface BridgePong {
  type: 'pong';
  version: string;
}

// --- Native messaging I/O ---

function readMessage(): Promise<unknown> {
  return new Promise((resolve, reject) => {
    // Read 4-byte length prefix
    const lengthBuf = Buffer.alloc(4);
    let bytesRead = 0;

    function readLength() {
      const chunk = process.stdin.read(4 - bytesRead);
      if (!chunk) {
        process.stdin.once('readable', readLength);
        return;
      }
      chunk.copy(lengthBuf, bytesRead);
      bytesRead += chunk.length;

      if (bytesRead < 4) {
        process.stdin.once('readable', readLength);
        return;
      }

      const msgLength = lengthBuf.readUInt32LE(0);
      if (msgLength === 0) {
        resolve(null);
        return;
      }

      readBody(msgLength);
    }

    function readBody(length: number) {
      let body = Buffer.alloc(0);

      function readChunk() {
        const chunk = process.stdin.read(length - body.length);
        if (!chunk) {
          process.stdin.once('readable', readChunk);
          return;
        }
        body = Buffer.concat([body, chunk]);

        if (body.length < length) {
          process.stdin.once('readable', readChunk);
          return;
        }

        try {
          resolve(JSON.parse(body.toString('utf-8')));
        } catch (e) {
          reject(new Error(`Invalid JSON: ${(e as Error).message}`));
        }
      }

      readChunk();
    }

    process.stdin.once('readable', readLength);
    process.stdin.on('end', () => resolve(null));
  });
}

function writeMessage(msg: unknown): void {
  const json = JSON.stringify(msg);
  const buf = Buffer.from(json, 'utf-8');
  const lengthBuf = Buffer.alloc(4);
  lengthBuf.writeUInt32LE(buf.length, 0);
  process.stdout.write(lengthBuf);
  process.stdout.write(buf);
}

// --- Request handling ---

async function handleMessage(msg: unknown): Promise<void> {
  if (!msg || typeof msg !== 'object') return;

  const message = msg as { type: string };

  if (message.type === 'ping') {
    writeMessage({ type: 'pong', version: '0.2.0' } satisfies BridgePong);
    return;
  }

  if (message.type === 'proxy') {
    const req = msg as BridgeRequest;
    await handleProxy(req);
    return;
  }
}

async function handleProxy(req: BridgeRequest): Promise<void> {
  try {
    // Parse the Anthropic request body
    const apiRequest: AnthropicRequest = JSON.parse(req.body);

    // Route through Claude Code CLI
    const result = await translateRequest(apiRequest, req.setupToken);

    writeMessage({
      type: 'proxy_response',
      requestId: req.requestId,
      status: result.status,
      headers: result.headers,
      body: result.body,
    } satisfies BridgeResponse);
  } catch (e) {
    writeMessage({
      type: 'proxy_error',
      requestId: req.requestId,
      error: (e as Error).message,
    } satisfies BridgeError);
  }
}

// --- Main loop ---

async function main() {
  // Ensure stdin is in binary mode for native messaging
  process.stdin.resume();

  while (true) {
    const msg = await readMessage();
    if (msg === null) break; // stdin closed = extension disconnected
    await handleMessage(msg);
  }

  process.exit(0);
}

main().catch((e) => {
  process.stderr.write(`byoky-bridge fatal: ${e.message}\n`);
  process.exit(1);
});
