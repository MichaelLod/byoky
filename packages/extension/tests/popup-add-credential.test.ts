// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { bg, mount, run, typeInto, type Mounted } from './helpers/popup-harness';

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
