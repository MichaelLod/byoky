import { Byoky, isExtensionInstalled, getStoreUrl } from '@byoky/sdk';
import type { ByokySession } from '@byoky/sdk';
import type { RelayConnection } from '@byoky/sdk';

const SERVER_URL = 'http://localhost:3001';
const WS_RELAY_URL = 'ws://localhost:3001/ws/relay';

const app = document.getElementById('app')!;
const byoky = new Byoky();
let session: ByokySession | null = null;
let relay: RelayConnection | null = null;

function render(): void {
  if (!session) {
    renderConnect();
  } else {
    renderDashboard();
  }
}

function renderConnect(): void {
  app.innerHTML = `
    <h1>{{PROJECT_NAME}}</h1>
    <p class="subtitle">Server-side LLM calls through your Byoky wallet</p>
    <button id="connect-btn">Connect Wallet</button>
    <div id="error"></div>
  `;

  document.getElementById('connect-btn')!.addEventListener('click', async () => {
    const btn = document.getElementById('connect-btn') as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = 'Connecting...';
    const errorEl = document.getElementById('error')!;
    errorEl.innerHTML = '';

    try {
      session = await byoky.connect({
        providers: [{ id: 'anthropic', required: false }],
        modal: true,
      });

      // Open a relay to the backend server
      relay = session.createRelay(WS_RELAY_URL);

      session.onDisconnect(() => {
        session = null;
        relay = null;
        render();
      });

      render();
    } catch (err) {
      if (!isExtensionInstalled()) {
        const url = getStoreUrl();
        errorEl.innerHTML = `<p class="error">Byoky wallet not found.${
          url ? ` <a href="${url}" target="_blank" style="color:#818cf8">Install extension</a>` : ''
        }</p>`;
      } else {
        errorEl.innerHTML = `<p class="error">${err instanceof Error ? err.message : 'Connection failed'}</p>`;
      }
      btn.disabled = false;
      btn.textContent = 'Connect Wallet';
    }
  });
}

function renderDashboard(): void {
  if (!session) return;

  const providers = Object.entries(session.providers)
    .filter(([, p]) => p.available)
    .map(([id]) => id);

  app.innerHTML = `
    <h1>{{PROJECT_NAME}}</h1>
    <div class="status-bar">
      <div class="status-dot"></div>
      <span>Wallet connected &mdash; relay active</span>
      <button id="disconnect-btn" style="margin-left:auto;background:transparent;color:var(--text-muted);border:1px solid var(--border);padding:6px 12px;font-size:0.85rem;">Disconnect</button>
    </div>

    <div class="card">
      <h2>Server-Side Generation</h2>
      <p class="info" style="margin-bottom:12px">
        Your prompt is sent to the Express server, which makes the LLM call through the relay
        using provider: <strong>${providers[0] ?? 'none'}</strong>
      </p>
      <textarea id="prompt" placeholder="Enter a prompt...">Explain what a backend relay is in two sentences.</textarea>
      <button id="generate-btn">Generate on Server</button>
      <div id="response"></div>
    </div>

    <div class="card">
      <h2>How it works</h2>
      <p class="info">1. Browser connects to Byoky wallet via the SDK</p>
      <p class="info">2. <code>session.createRelay()</code> opens a WebSocket to your Express server</p>
      <p class="info">3. The server receives a <code>ByokyClient</code> with <code>createFetch()</code></p>
      <p class="info">4. Server-side fetch calls are proxied through the wallet — keys never leave the extension</p>
    </div>
  `;

  document.getElementById('disconnect-btn')!.addEventListener('click', () => {
    relay?.close();
    session?.disconnect();
    session = null;
    relay = null;
    render();
  });

  document.getElementById('generate-btn')!.addEventListener('click', async () => {
    const btn = document.getElementById('generate-btn') as HTMLButtonElement;
    const prompt = (document.getElementById('prompt') as HTMLTextAreaElement).value.trim();
    const responseEl = document.getElementById('response')!;

    if (!prompt) return;
    btn.disabled = true;
    btn.textContent = 'Generating...';
    responseEl.innerHTML = '<div class="response-box">Waiting for server...</div>';

    try {
      const res = await fetch(`${SERVER_URL}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: session?.sessionKey,
          prompt,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }

      responseEl.innerHTML = `
        <div class="response-box">${escapeHtml(data.content)}</div>
        <p class="info">Provider: ${data.provider}</p>
      `;
    } catch (err) {
      responseEl.innerHTML = `<p class="error">${err instanceof Error ? escapeHtml(err.message) : 'Request failed'}</p>`;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Generate on Server';
    }
  });
}

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

render();
