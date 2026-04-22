/**
 * `byoky-bridge connect` — loopback handshake that kicks the extension
 * into starting the HTTP proxy on 127.0.0.1:<port>.
 *
 * Flow:
 *   1. CLI spins up an ephemeral HTTP server on 127.0.0.1.
 *   2. Serves /, /auth-sdk.js, POST /done.
 *   3. Opens the URL in the default browser.
 *   4. The page runs ByokySDK.connect() → user approves in the wallet popup.
 *   5. Page posts {action:'startBridgeProxy', sessionKey, port} via
 *      window.postMessage. The extension's content script (content.ts)
 *      already trusts 127.0.0.1 for this action, so it forwards to the
 *      background script, which opens the native-messaging port and tells
 *      the bridge to `server.listen(port)`.
 *   6. Page POSTs /done — CLI resolves, polls /health, exits.
 *
 * The loopback server only lives for this handshake. The bridge proxy on
 * :19280 is held alive by the extension's service worker afterwards.
 */

import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { platform } from 'node:os';

export interface ConnectOptions {
  port: number;
  providers: string[];
}

export interface ConnectResult {
  providers: string[];
  port: number;
}

const HANDSHAKE_TIMEOUT_MS = 180_000;
const HEALTH_POLL_TIMEOUT_MS = 15_000;
const HEALTH_POLL_INTERVAL_MS = 250;

export async function runConnect(opts: ConnectOptions): Promise<ConnectResult> {
  const handshake = await runHandshake(opts);
  const providers = await pollHealth(opts.port);
  return { providers, port: handshake.port };
}

function runHandshake(opts: ConnectOptions): Promise<ConnectResult> {
  return new Promise((resolvePromise, rejectPromise) => {
    let resolved = false;
    let finalize: ((res: ConnectResult) => void) | null = null;
    let fail: ((err: Error) => void) | null = null;

    const server: Server = createServer((req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS, GET');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Cache-Control', 'no-store');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.method === 'POST' && req.url === '/done') {
        const MAX_BODY = 64_000;
        let body = '';
        let oversized = false;
        req.on('data', (chunk: Buffer) => {
          body += chunk.toString();
          if (body.length > MAX_BODY) {
            oversized = true;
            req.destroy();
          }
        });
        req.on('end', () => {
          if (oversized) {
            res.writeHead(413);
            res.end();
            return;
          }
          let data: { providers?: unknown; port?: unknown; error?: unknown } = {};
          try { data = JSON.parse(body || '{}'); } catch { /* ignore */ }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
          if (resolved) return;
          resolved = true;
          if (typeof data.error === 'string' && data.error) {
            fail?.(new Error(data.error));
            return;
          }
          const providers = Array.isArray(data.providers)
            ? (data.providers as unknown[]).filter((v) => typeof v === 'string') as string[]
            : [];
          const port = typeof data.port === 'number' ? data.port : opts.port;
          finalize?.({ providers, port });
        });
        return;
      }

      if (req.method === 'GET' && req.url === '/auth-sdk.js') {
        try {
          const js = readAuthSdkBundle();
          res.writeHead(200, {
            'Content-Type': 'application/javascript; charset=utf-8',
            'Cache-Control': 'no-store',
          });
          res.end(js);
        } catch {
          res.writeHead(500);
          res.end('SDK bundle missing');
        }
        return;
      }

      if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(buildConnectPage(opts));
        return;
      }

      res.writeHead(404);
      res.end();
    });

    finalize = (r) => {
      server.close(() => resolvePromise(r));
    };
    fail = (err) => {
      server.close(() => rejectPromise(err));
    };

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (typeof addr !== 'object' || !addr) {
        fail?.(new Error('Failed to bind loopback server'));
        return;
      }
      const url = `http://127.0.0.1:${addr.port}`;
      process.stderr.write(`Open this URL to approve the Claude Code session in your Byoky wallet:\n  ${url}\n`);
      openInBrowser(url);
    });

    setTimeout(() => {
      if (resolved) return;
      resolved = true;
      fail?.(new Error(`Timed out after ${Math.round(HANDSHAKE_TIMEOUT_MS / 1000)}s — the browser tab never confirmed the session.`));
    }, HANDSHAKE_TIMEOUT_MS);
  });
}

async function pollHealth(port: number): Promise<string[]> {
  const deadline = Date.now() + HEALTH_POLL_TIMEOUT_MS;
  let lastErr: Error | null = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) {
        const json = await res.json() as { status?: string; providers?: unknown };
        if (json.status === 'ok' && Array.isArray(json.providers)) {
          return (json.providers as unknown[]).filter((v) => typeof v === 'string') as string[];
        }
      }
    } catch (e) {
      lastErr = e as Error;
    }
    await new Promise((r) => setTimeout(r, HEALTH_POLL_INTERVAL_MS));
  }
  throw new Error(`Bridge didn't come up on 127.0.0.1:${port} within ${Math.round(HEALTH_POLL_TIMEOUT_MS / 1000)}s${lastErr ? ` (${lastErr.message})` : ''}.`);
}

function openInBrowser(url: string): void {
  const os = platform();
  try {
    if (os === 'darwin') {
      spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
    } else if (os === 'win32') {
      spawn('cmd', ['/c', 'start', '""', url], { stdio: 'ignore', detached: true }).unref();
    } else {
      spawn('xdg-open', [url], { stdio: 'ignore', detached: true }).unref();
    }
  } catch {
    // Caller already printed the URL — user can click it manually.
  }
}

let authSdkCache: string | null = null;

function readAuthSdkBundle(): string {
  if (authSdkCache !== null) return authSdkCache;
  const here = dirname(fileURLToPath(import.meta.url));
  const bundlePath = resolve(here, 'auth-sdk.js');
  authSdkCache = readFileSync(bundlePath, 'utf8');
  return authSdkCache;
}

function buildConnectPage(opts: ConnectOptions): string {
  const providersJson = JSON.stringify(
    opts.providers.map((id) => ({ id, required: true })),
  );
  const portJson = JSON.stringify(opts.port);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Byoky — Connect Claude Code</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
  <style>
    :root {
      --bg: #fafaf9;
      --bg-card: #ffffff;
      --bg-elevated: #f5f5f4;
      --border: #e7e5e4;
      --text: #1c1917;
      --text-secondary: #57534e;
      --text-muted: #a8a29e;
      --teal: #FF4F00;
      --teal-dark: #e64500;
      --green: #16a34a;
    }
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
    html { -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
    body {
      font-family: 'Sora', system-ui, -apple-system, sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      line-height: 1.6;
    }
    .card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 40px 36px 32px;
      max-width: 440px;
      width: 100%;
      text-align: center;
      box-shadow: 0 4px 24px rgba(28, 25, 23, 0.04);
    }
    .eyebrow {
      display: inline-block;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--teal);
      background: rgba(255, 79, 0, 0.08);
      border: 1px solid rgba(255, 79, 0, 0.25);
      padding: 5px 11px;
      border-radius: 999px;
      margin-bottom: 18px;
    }
    h1 {
      font-size: 26px;
      font-weight: 700;
      letter-spacing: -0.02em;
      line-height: 1.15;
      margin-bottom: 8px;
    }
    h1 .grad {
      background: linear-gradient(90deg, var(--teal), var(--teal-dark));
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
    }
    .subtitle {
      color: var(--text-secondary);
      font-size: 15px;
      margin-bottom: 24px;
    }
    .status {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      font-size: 13px;
      font-weight: 500;
      color: var(--text-secondary);
      background: var(--bg-elevated);
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 8px 14px;
      margin-bottom: 20px;
    }
    .status .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--teal); animation: pulse 1.4s ease-in-out infinite; }
    .status.success { color: var(--green); }
    .status.success .dot { background: var(--green); animation: none; }
    .status.error { color: #b91c1c; }
    .status.error .dot { background: #dc2626; animation: none; }
    @keyframes pulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(255, 79, 0, 0.35); }
      50% { box-shadow: 0 0 0 6px rgba(255, 79, 0, 0); }
    }
    .connect-btn {
      display: block;
      width: 100%;
      padding: 13px 20px;
      border: none;
      border-radius: 10px;
      background: var(--teal);
      color: #fff;
      font-family: inherit;
      font-size: 15px;
      font-weight: 700;
      letter-spacing: -0.01em;
      cursor: pointer;
      transition: background 0.15s ease, transform 0.15s ease;
    }
    .connect-btn:hover { background: var(--teal-dark); transform: translateY(-1px); }
    .connect-btn:disabled { opacity: 0.6; cursor: default; transform: none; }
    .info {
      color: var(--text-muted);
      font-size: 12px;
      line-height: 1.55;
      margin-top: 16px;
      text-align: left;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="eyebrow">Claude Code × Byoky</div>
    <h1>Connect <span class="grad">Claude Code</span></h1>
    <p class="subtitle">Approve the session in your Byoky wallet. Your keys stay local.</p>
    <div id="status" class="status">
      <span class="dot"></span>
      <span id="status-text">Click connect to link your wallet.</span>
    </div>
    <button id="connect-btn" class="connect-btn" type="button">Connect wallet</button>
    <p class="info">
      The Byoky extension must be installed in this browser. Your API keys never leave the wallet — Claude Code talks to the local bridge, which asks the extension to inject the credential.
    </p>
  </div>
  <script src="/auth-sdk.js"></script>
  <script>
    (() => {
      const statusEl = document.getElementById('status');
      const statusText = document.getElementById('status-text');
      const btn = document.getElementById('connect-btn');
      function setStatus(text, kind) {
        statusText.textContent = text;
        statusEl.className = 'status' + (kind ? ' ' + kind : '');
      }
      async function reportDone(body) {
        try {
          await fetch('/done', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
        } catch {}
      }
      async function startBridge(sessionKey) {
        return new Promise((resolve, reject) => {
          const requestId = (crypto.randomUUID && crypto.randomUUID()) || String(Math.random()).slice(2);
          function handler(event) {
            const msg = event.detail;
            if (!msg || msg.requestId !== requestId) return;
            document.removeEventListener('byoky-message', handler);
            resolve(msg.payload);
          }
          document.addEventListener('byoky-message', handler);
          window.postMessage({
            type: 'BYOKY_INTERNAL_FROM_PAGE',
            requestId: requestId,
            action: 'startBridgeProxy',
            payload: { sessionKey: sessionKey, port: ${portJson} },
          }, window.location.origin);
          setTimeout(() => {
            document.removeEventListener('byoky-message', handler);
            reject(new Error('Bridge proxy start timed out'));
          }, 15000);
        });
      }
      async function run() {
        btn.disabled = true;
        btn.textContent = 'Connecting…';
        setStatus('Opening wallet…');
        try {
          if (!window.ByokySDK || !window.ByokySDK.Byoky) {
            throw new Error('SDK failed to load');
          }
          const byoky = new window.ByokySDK.Byoky({ timeout: 120000 });
          const session = await byoky.connect({
            providers: ${providersJson},
            modal: true,
          });
          const providers = session.providers || {};
          const available = Object.entries(providers)
            .filter(([, v]) => v && v.available)
            .map(([id]) => id);
          if (available.length === 0) {
            throw new Error('No matching providers in your wallet');
          }
          const sessionKey = session.sessionKey || '';
          if (sessionKey.startsWith('relay_') || sessionKey.startsWith('vault_')) {
            throw new Error('Relay/vault sessions aren\\'t supported by byoky-bridge connect yet — pair with the browser extension directly.');
          }
          setStatus('Wallet connected — starting bridge proxy…');
          const bridgeResult = await startBridge(sessionKey);
          const port = (bridgeResult && bridgeResult.port) || ${portJson};
          setStatus('Bridge active on port ' + port + '. Connected ' + available.length + ' provider(s): ' + available.join(', '), 'success');
          btn.style.display = 'none';
          await reportDone({ providers: available, port: port });
          setTimeout(() => setStatus('Done — you can close this tab.', 'success'), 1200);
        } catch (err) {
          const msg = (err && err.message) ? err.message : String(err);
          if (msg === 'User cancelled') {
            setStatus('Cancelled. Click connect to try again.');
          } else {
            setStatus('Error: ' + msg, 'error');
            await reportDone({ error: msg });
          }
          btn.disabled = false;
          btn.textContent = 'Try again';
        }
      }
      btn.addEventListener('click', run);
    })();
  </script>
</body>
</html>`;
}
