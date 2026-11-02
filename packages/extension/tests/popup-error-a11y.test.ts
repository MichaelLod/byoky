// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
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
  bg.state.credentials = [{ id: 'c1', providerId: 'anthropic', label: 'Personal', authMethod: 'api_key', createdAt: 1 }];
  useWalletStore.setState(initial, true);
  document.body.innerHTML = '';
});

afterEach(() => {
  view?.unmount();
  view = null;
});

const alerts = (c: HTMLElement) => [...c.querySelectorAll('[role=alert]')].map((a) => a.textContent);

/** The field is marked invalid and described by the alert that says why. */
function expectMarked(field: Element, text: string) {
  expect(field.getAttribute('aria-invalid')).toBe('true');
  const error = document.getElementById(field.getAttribute('aria-describedby') ?? '');
  expect(error?.getAttribute('role')).toBe('alert');
  expect(error?.textContent).toBe(text);
}

function expectUnmarked(field: Element) {
  expect(field.getAttribute('aria-invalid')).not.toBe('true');
  expect(field.hasAttribute('aria-describedby')).toBe(false);
}

// F031: every inline error was a plain <div class="error">, so a screen
// reader heard nothing, and no field said it was the one in error.
describe('popup errors are announced and tied to their field (F031)', () => {
  it('setup: a password mismatch', async () => {
    bg.state.initialized = false;
    bg.state.unlocked = false;
    view = await mount(App);
    const { container } = view;
    await run(() => buttonByText(container, 'Get Started')!.click());
    typeInto(container.querySelector<HTMLInputElement>('#password')!, 'correct-Horse-battery-42');
    await run(() => {});
    await run(() => container.querySelector<HTMLButtonElement>('button[type=submit]')!.click());
    typeInto(container.querySelector<HTMLInputElement>('#confirm')!, 'something-else');
    await run(() => {});
    await run(() => container.querySelector<HTMLButtonElement>('button[type=submit]')!.click());

    expect(alerts(container)).toEqual(['Passwords do not match']);
    expectMarked(container.querySelector('#confirm')!, 'Passwords do not match');
  });

  it('export: the field each error is about', async () => {
    bg.handlers.exportVault = () => ({ error: 'Incorrect password' });
    view = await mount(App);
    const { container } = view;
    await run(() => useWalletStore.getState().navigate('settings'));
    await run(() => buttonByText(container, 'Export backup')!.click());
    const current = container.querySelector('#export-current-pw')!;
    const pw = container.querySelector('#export-pw')!;
    const confirm = container.querySelector('#export-confirm')!;
    const submit = () => container.querySelector<HTMLButtonElement>('button[type=submit]')!.click();

    typeInto(current as HTMLInputElement, 'wallet-pass');
    typeInto(pw as HTMLInputElement, 'Another-Strong-Pass-42');
    typeInto(confirm as HTMLInputElement, 'Another-Strong-Pass-43');
    await run(() => {});
    await run(submit);
    expect(alerts(container)).toEqual(['Passwords do not match']);
    expectMarked(confirm, 'Passwords do not match');
    expectUnmarked(current);
    expectUnmarked(pw);

    typeInto(confirm as HTMLInputElement, 'Another-Strong-Pass-42');
    await run(() => {});
    await run(submit);
    expect(alerts(container)).toEqual(['Incorrect password']);
    expectMarked(current, 'Incorrect password');
    expectUnmarked(confirm);
  });

  it('import: a refused file or password', async () => {
    bg.handlers.importVault = () => ({ error: 'Wrong password or corrupted file' });
    view = await mount(App);
    const { container } = view;
    await run(() => useWalletStore.getState().navigate('settings'));
    await run(() => buttonByText(container, 'Import backup')!.click());
    const input = container.querySelector<HTMLInputElement>('input[type=file]')!;
    const big = new File(['x'], 'big.byoky');
    Object.defineProperty(big, 'size', { value: 11 * 1024 * 1024 });
    Object.defineProperty(input, 'files', { value: [big], configurable: true });
    await run(() => { input.dispatchEvent(new Event('change', { bubbles: true })); });

    expect(alerts(container)).toEqual(['File too large (max 10MB)']);
    const fileButton = container.querySelector('.btn-file')!;
    expect(document.getElementById(fileButton.getAttribute('aria-describedby')!)?.textContent).toBe('File too large (max 10MB)');
    expectUnmarked(container.querySelector('#import-pw')!);
  });

  it('add credential: a refused endpoint marks the endpoint, a missing key the key', async () => {
    view = await mount(App);
    const { container } = view;
    await run(() => useWalletStore.getState().openModal('add-credential'));
    bg.handlers.addCredential = () => ({ error: 'Base URL must use https:// (or http://localhost for a local server)' });
    typeInto(container.querySelector<HTMLSelectElement>('#provider')!, 'azure_openai');
    await run(() => {});
    typeInto(container.querySelector<HTMLInputElement>('#label')!, 'Azure');
    typeInto(container.querySelector<HTMLTextAreaElement>('#apiKey')!, 'abc');
    typeInto(container.querySelector<HTMLInputElement>('#baseUrl')!, 'http://bad.example');
    await run(() => {});
    await run(() => container.querySelector<HTMLButtonElement>('button[type=submit]')!.click());
    const message = 'Base URL must use https:// (or http://localhost for a local server)';
    expect(alerts(container)).toEqual([message]);
    expectMarked(container.querySelector('#baseUrl')!, message);
    expectUnmarked(container.querySelector('#apiKey')!);

    bg.handlers.addCredential = () => ({ error: 'Enter an API key' });
    typeInto(container.querySelector<HTMLInputElement>('#baseUrl')!, 'https://r.openai.azure.com');
    await run(() => {});
    await run(() => container.querySelector<HTMLButtonElement>('button[type=submit]')!.click());
    expectMarked(container.querySelector('#apiKey')!, 'Enter an API key');
    expectUnmarked(container.querySelector('#baseUrl')!);
  });

  it('approval: an expired request', async () => {
    bg.state.approvals = [{ id: 'a1', appOrigin: 'https://app.example', providers: [], timestamp: 1 }];
    bg.handlers.approveConnect = () => ({ success: false, error: 'Approval not found' });
    view = await mount(App);
    const { container } = view;
    bg.state.approvals = [];
    await run(() => buttonByText(container, 'Approve')!.click());
    expect(alerts(container)).toEqual(['The request from app.example expired. Ask the app to connect again.']);
  });

  it('no error box is left unannounced', async () => {
    bg.handlers.deleteGroup = () => ({ error: 'Wallet is locked' });
    bg.state.groups = [
      { id: 'default', name: 'Default', providerId: '', createdAt: 1 },
      { id: 'g1', name: 'Cheap', providerId: 'anthropic', createdAt: 2 },
    ];
    view = await mount(App);
    const { container } = view;
    await run(() => useWalletStore.getState().navigate('connect'));
    await run(() => useWalletStore.getState().deleteGroup('g1'));
    const boxes = [...container.querySelectorAll('.error')];
    expect(boxes.map((b) => b.textContent)).toEqual(['Wallet is locked']);
    for (const box of boxes) expect(box.getAttribute('role')).toBe('alert');
  });
});
