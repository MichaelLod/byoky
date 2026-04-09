import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';

/**
 * Tiny native-messaging client for talking to a live `byoky-bridge host`
 * subprocess from inside a vitest live test.
 *
 * Why this exists: Anthropic OAuth setup tokens (`sk-ant-oat01-...`) cannot
 * be authenticated with the `x-api-key` header. They have to go through the
 * Bearer + Claude Code system prompt path that the bridge implements. The
 * bridge runs in Node, the live test runs in Node, so we just spawn the
 * bridge as a child process and talk to it the same way the extension does
 * (4-byte little-endian length prefix + UTF-8 JSON).
 *
 * The bridge binary is expected to be on PATH (typically via
 * `npm install -g @byoky/bridge` or an npm-link from local source). If it
 * is not, callers should `skipIf` ahead of using this helper.
 */

export interface BridgeProxyRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  toolNameMap?: Record<string, string>;
}

export interface BridgeProxyResponse {
  status: number;
  headers: Record<string, string>;
  /** Concatenation of all chunks the bridge forwarded back. */
  body: string;
}

/**
 * Spawn `byoky-bridge host` and run a single proxy request through it.
 * Resolves with the response when the bridge sends `proxy_response_done`.
 * Rejects on `proxy_error` or unexpected disconnect.
 */
export async function runBridgeProxy(req: BridgeProxyRequest): Promise<BridgeProxyResponse> {
  const requestId = randomUUID();
  const bridge = spawn('byoky-bridge', ['host'], { stdio: ['pipe', 'pipe', 'pipe'] });

  return new Promise<BridgeProxyResponse>((resolve, reject) => {
    let resolved = false;
    let status = 0;
    let headers: Record<string, string> = {};
    const chunks: string[] = [];
    const stderr: string[] = [];

    // Buffered native-messaging frame reader.
    let buffer = Buffer.alloc(0);

    function settle(err: Error | null, value?: BridgeProxyResponse): void {
      if (resolved) return;
      resolved = true;
      try { bridge.kill(); } catch { /* ignore */ }
      if (err) reject(err);
      else resolve(value!);
    }

    bridge.stdout.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (buffer.length < 4) break;
        const len = buffer.readUInt32LE(0);
        if (buffer.length < 4 + len) break;
        const json = buffer.slice(4, 4 + len).toString('utf8');
        buffer = buffer.slice(4 + len);
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(json) as Record<string, unknown>;
        } catch (e) {
          settle(new Error(`Bridge sent invalid JSON: ${(e as Error).message}`));
          return;
        }
        handleMessage(msg);
      }
    });

    function handleMessage(msg: Record<string, unknown>): void {
      if (msg.requestId !== requestId && msg.type !== 'pong') return;
      switch (msg.type) {
        case 'proxy_response_meta':
          status = (msg.status as number) ?? 0;
          headers = ((msg.headers as Record<string, string>) ?? {});
          break;
        case 'proxy_response_chunk':
          chunks.push((msg.chunk as string) ?? '');
          break;
        case 'proxy_response_done':
          settle(null, { status, headers, body: chunks.join('') });
          break;
        case 'proxy_error':
          settle(new Error(`Bridge proxy error: ${(msg.error as string) ?? 'unknown'}`));
          break;
        default:
          // Other message types (pong, etc.) — ignore.
          break;
      }
    }

    bridge.stderr.on('data', (chunk: Buffer) => {
      stderr.push(chunk.toString('utf8'));
    });

    bridge.on('error', (err) => {
      settle(new Error(`Failed to spawn byoky-bridge: ${err.message}. Is it installed and on PATH? Try \`npm install -g @byoky/bridge\` or \`npm link\` from packages/bridge.`));
    });

    bridge.on('exit', (code) => {
      if (!resolved) {
        const stderrText = stderr.join('').trim();
        settle(new Error(`Bridge exited (code ${code}) before completing the request. stderr: ${stderrText || '(empty)'}`));
      }
    });

    // Send the proxy request.
    const request = {
      type: 'proxy',
      requestId,
      url: req.url,
      method: req.method,
      headers: req.headers,
      body: req.body,
      toolNameMap: req.toolNameMap ?? {},
    };
    writeFrame(bridge, request);
  });
}

function writeFrame(bridge: ChildProcessWithoutNullStreams, msg: unknown): void {
  const json = JSON.stringify(msg);
  const body = Buffer.from(json, 'utf8');
  const length = Buffer.alloc(4);
  length.writeUInt32LE(body.length, 0);
  bridge.stdin.write(length);
  bridge.stdin.write(body);
}

/**
 * Quick liveness check — sends a `ping` and waits for `pong`. Used to skip
 * tests with a clear message when the bridge isn't installed.
 */
export async function isBridgeAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    let bridge: ChildProcessWithoutNullStreams;
    try {
      bridge = spawn('byoky-bridge', ['host'], { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch {
      resolve(false);
      return;
    }
    let buffer = Buffer.alloc(0);
    const cleanup = () => { try { bridge.kill(); } catch { /* ignore */ } };
    const timeout = setTimeout(() => { cleanup(); resolve(false); }, 2000);

    bridge.stdout.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length < 4) return;
      const len = buffer.readUInt32LE(0);
      if (buffer.length < 4 + len) return;
      const json = buffer.slice(4, 4 + len).toString('utf8');
      try {
        const msg = JSON.parse(json) as { type?: string };
        clearTimeout(timeout);
        cleanup();
        resolve(msg.type === 'pong');
      } catch {
        clearTimeout(timeout);
        cleanup();
        resolve(false);
      }
    });

    bridge.on('error', () => { clearTimeout(timeout); resolve(false); });
    bridge.on('exit', () => { clearTimeout(timeout); resolve(false); });

    writeFrame(bridge, { type: 'ping' });
  });
}
