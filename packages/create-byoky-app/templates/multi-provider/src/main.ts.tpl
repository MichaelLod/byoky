import { Byoky, isExtensionInstalled, getStoreUrl } from '@byoky/sdk';
import type { ByokySession } from '@byoky/sdk';

const PROVIDERS = ['anthropic', 'openai', 'gemini'] as const;
type ProviderId = (typeof PROVIDERS)[number];

const PROVIDER_CONFIG: Record<
  ProviderId,
  { displayName: string; testUrl: string; buildBody: () => string }
> = {
  anthropic: {
    displayName: 'Anthropic',
    testUrl: 'https://api.anthropic.com/v1/messages',
    buildBody: () =>
      JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 128,
        messages: [{ role: 'user', content: 'Say hello in one sentence.' }],
      }),
  },
  openai: {
    displayName: 'OpenAI',
    testUrl: 'https://api.openai.com/v1/chat/completions',
    buildBody: () =>
      JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 128,
        messages: [{ role: 'user', content: 'Say hello in one sentence.' }],
      }),
  },
  gemini: {
    displayName: 'Google Gemini',
    testUrl:
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
    buildBody: () =>
      JSON.stringify({
        contents: [{ parts: [{ text: 'Say hello in one sentence.' }] }],
        generationConfig: { maxOutputTokens: 128 },
      }),
  },
};

const app = document.getElementById('app')!;
const byoky = new Byoky();
let session: ByokySession | null = null;

function render(): void {
  if (!session) {
    renderConnect();
  } else {
    renderProviders();
  }
}

function renderConnect(): void {
  app.innerHTML = `
    <h1>{{PROJECT_NAME}}</h1>
    <p class="subtitle">Connect your Byoky wallet to use multiple AI providers</p>
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
        providers: PROVIDERS.map((id) => ({ id, required: false })),
        modal: true,
      });
      session.onDisconnect(() => {
        session = null;
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

function renderProviders(): void {
  if (!session) return;

  const connectedProviders = Object.entries(session.providers)
    .filter(([, p]) => p.available)
    .map(([id]) => id);

  app.innerHTML = `
    <h1>{{PROJECT_NAME}}</h1>
    <div class="status-bar">
      <div class="status-dot"></div>
      <span>Connected — ${connectedProviders.length} provider${connectedProviders.length !== 1 ? 's' : ''} available</span>
      <button id="disconnect-btn" style="margin-left:auto;background:transparent;color:var(--text-muted);border:1px solid var(--border);padding:6px 12px;font-size:0.85rem;">Disconnect</button>
    </div>
    <div id="providers"></div>
  `;

  document.getElementById('disconnect-btn')!.addEventListener('click', () => {
    session?.disconnect();
    session = null;
    render();
  });

  const container = document.getElementById('providers')!;

  for (const providerId of PROVIDERS) {
    const providerInfo = session.providers[providerId];
    const config = PROVIDER_CONFIG[providerId];
    const available = providerInfo?.available ?? false;

    const card = document.createElement('div');
    card.className = 'provider-card';
    card.innerHTML = `
      <div class="provider-header">
        <span class="provider-name">${config.displayName}</span>
        <span class="badge ${available ? 'badge-available' : 'badge-unavailable'}">${available ? 'Available' : 'Not configured'}</span>
      </div>
      ${available ? `<button class="test-btn" data-provider="${providerId}">Send test message</button>` : '<p style="color:var(--text-muted);font-size:0.9rem;">Add your ${config.displayName} API key in the Byoky wallet to use this provider.</p>'}
      <div class="response" id="response-${providerId}"></div>
    `;
    container.appendChild(card);
  }

  container.querySelectorAll<HTMLButtonElement>('.test-btn').forEach((btn) => {
    btn.addEventListener('click', () => handleTest(btn.dataset.provider as ProviderId));
  });
}

async function handleTest(providerId: ProviderId): Promise<void> {
  if (!session) return;
  const config = PROVIDER_CONFIG[providerId];
  const responseEl = document.getElementById(`response-${providerId}`)!;
  responseEl.innerHTML = '<div class="response-box">Sending request...</div>';

  const btn = document.querySelector<HTMLButtonElement>(
    `.test-btn[data-provider="${providerId}"]`
  );
  if (btn) btn.disabled = true;

  try {
    const proxyFetch = session.createFetch(providerId);

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (providerId === 'anthropic') {
      headers['x-api-key'] = 'byoky';
      headers['anthropic-version'] = '2023-06-01';
    } else if (providerId === 'openai') {
      headers['Authorization'] = 'Bearer byoky';
    }

    const response = await proxyFetch(config.testUrl, {
      method: 'POST',
      headers,
      body: config.buildBody(),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
    }

    const data = await response.json();

    let content: string;
    if (providerId === 'anthropic') {
      content = data.content?.[0]?.text ?? JSON.stringify(data);
    } else if (providerId === 'openai') {
      content = data.choices?.[0]?.message?.content ?? JSON.stringify(data);
    } else {
      content =
        data.candidates?.[0]?.content?.parts?.[0]?.text ?? JSON.stringify(data);
    }

    responseEl.innerHTML = `<div class="response-box">${escapeHtml(content)}</div>`;
  } catch (err) {
    responseEl.innerHTML = `<p class="error">${err instanceof Error ? escapeHtml(err.message) : 'Request failed'}</p>`;
  } finally {
    if (btn) btn.disabled = false;
  }
}

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

render();
