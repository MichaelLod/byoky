// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { bg, mount, run, typeInto, buttonByText, type Mounted } from './helpers/popup-harness';

type Store = typeof import('../entrypoints/popup/store');
let useWalletStore: Store['useWalletStore'];
let App: typeof import('../entrypoints/popup/App').default;
let initial: ReturnType<Store['useWalletStore']['getState']>;

beforeAll(async () => {
  ({ useWalletStore } = await import('../entrypoints/popup/store'));
  App = (await import('../entrypoints/popup/App')).default;
  initial = useWalletStore.getState();
});

let view: Mounted | null = null;

beforeEach(() => {
  bg.reset();
  useWalletStore.setState(initial, true);
  document.body.innerHTML = '';
});

afterEach(() => {
  view?.unmount();
  view = null;
});

async function openForm() {
  view = await mount(App);
  await run(() => useWalletStore.getState().openModal('add-credential'));
  return view.container;
}

const save = (c: HTMLElement) => c.querySelector<HTMLButtonElement>('button[type=submit]')!;
async function fill(c: HTMLElement, selector: string, value: string) {
  typeInto(c.querySelector<HTMLInputElement>(selector)!, value);
  await run(() => {});
}

describe('add-credential Save says when it can work (F123)', () => {
  it('stays disabled without a label, and the label is required', async () => {
    const c = await openForm();
    expect(c.querySelector<HTMLInputElement>('#label')!.required).toBe(true);
    await fill(c, '#apiKey', 'sk-ant-api03-x');
    expect(save(c).disabled).toBe(true);
    await fill(c, '#label', '  ');
    expect(save(c).disabled).toBe(true);
    await fill(c, '#label', 'Personal');
    expect(save(c).disabled).toBe(false);
  });

  it('stays disabled without a key, except for a local server', async () => {
    const c = await openForm();
    await fill(c, '#label', 'Personal');
    expect(save(c).disabled).toBe(true);
    await fill(c, '#provider', 'ollama');
    expect(c.querySelector<HTMLInputElement>('#baseUrl')!.value).toBe('http://localhost:11434');
    expect(save(c).disabled).toBe(false);
    expect(c.querySelector<HTMLTextAreaElement>('#apiKey')!.required).toBe(false);
  });

  it('needs the endpoint for Azure', async () => {
    const c = await openForm();
    await fill(c, '#provider', 'azure_openai');
    await fill(c, '#label', 'Azure');
    await fill(c, '#apiKey', 'abc');
    expect(save(c).disabled).toBe(true);
    await fill(c, '#baseUrl', 'https://r.openai.azure.com');
    expect(save(c).disabled).toBe(false);
  });

  it('drops a stale error once the form is edited', async () => {
    bg.handlers.addCredential = () => ({ error: 'Base URL must use https://' });
    const c = await openForm();
    await fill(c, '#provider', 'azure_openai');
    await fill(c, '#label', 'Azure');
    await fill(c, '#apiKey', 'abc');
    await fill(c, '#baseUrl', 'http://bad.example');
    await run(() => save(c).click());
    expect(c.querySelector('.error')?.textContent).toBe('Base URL must use https://');

    await fill(c, '#baseUrl', '');
    expect(c.querySelector('.error')).toBeNull();
    expect(save(c).disabled).toBe(true);
  });
});

// F021: the background refuses setup tokens in Safari (it can't reach the
// Byoky Bridge), so the form must not offer one or send the user to npm.
describe('setup tokens are offered only where the bridge can work', () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it('Chrome and Firefox offer the Setup Token toggle for Anthropic', async () => {
    const c = await openForm();
    expect(buttonByText(c, 'Setup Token')).toBeDefined();
  });

  it('Safari offers only an API key, and never the bridge install', async () => {
    vi.stubEnv('SAFARI', 'true');
    const c = await openForm();
    expect(c.querySelector<HTMLSelectElement>('#provider')!.value).toBe('anthropic');
    expect(buttonByText(c, 'Setup Token')).toBeUndefined();
    expect(c.textContent).not.toContain('byoky-bridge install');
    expect(c.querySelector('label[for=apiKey]')?.textContent).toContain('API Key');
    expect(bg.actions()).not.toContain('checkBridge');
  });

  it('Safari says a setup token from a backup won\'t work there', async () => {
    vi.stubEnv('SAFARI', 'true');
    bg.state.credentials = [
      { id: 'c1', providerId: 'anthropic', label: 'Claude Max', authMethod: 'oauth', createdAt: 1 },
      { id: 'c2', providerId: 'anthropic', label: 'Console', authMethod: 'api_key', createdAt: 2 },
    ];
    view = await mount(App);
    const notes = [...view.container.querySelectorAll('.credential-card')]
      .map((card) => card.querySelector('.warning-note')?.textContent ?? null);
    expect(notes[0]).toContain('Requests with this one fail in Safari');
    expect(notes[1]).toBeNull();
  });
});
