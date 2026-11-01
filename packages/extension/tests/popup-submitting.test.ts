// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { bg, mount, run, typeInto, buttonByText, deferred, type Mounted } from './helpers/popup-harness';

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

describe('forms waiting on the background keep their page (F053)', () => {
  it('a failed save from the Settings tab keeps the add-credential form as typed', async () => {
    bg.handlers.addCredential = () => ({ error: 'Base URL must use https://' });
    view = await mount(App);
    const { container } = view;

    await run(() => useWalletStore.getState().navigate('settings'));
    await run(() => useWalletStore.getState().openModal('add-credential'));

    typeInto(container.querySelector<HTMLSelectElement>('#provider')!, 'azure_openai');
    await run(() => {});
    typeInto(container.querySelector<HTMLInputElement>('#label')!, 'Azure2');
    typeInto(container.querySelector<HTMLTextAreaElement>('#apiKey')!, 'abc');
    typeInto(container.querySelector<HTMLInputElement>('#baseUrl')!, 'http://bad.example');
    await run(() => {});

    await run(() => buttonByText(container, 'Save')!.click());

    expect(container.querySelector('.loading')).toBeNull();
    expect(container.querySelector('.error')?.textContent).toBe('Base URL must use https://');
    expect(container.querySelector<HTMLSelectElement>('#provider')!.value).toBe('azure_openai');
    expect(container.querySelector<HTMLInputElement>('#label')!.value).toBe('Azure2');
    expect(container.querySelector<HTMLInputElement>('#baseUrl')!.value).toBe('http://bad.example');
  });

  it('shows Saving... in the button while the save is in flight', async () => {
    const reply = deferred();
    bg.handlers.addCredential = () => reply.promise;
    view = await mount(App);
    const { container } = view;
    await run(() => useWalletStore.getState().navigate('settings'));
    await run(() => useWalletStore.getState().openModal('add-credential'));
    typeInto(container.querySelector<HTMLInputElement>('#label')!, 'Personal');
    typeInto(container.querySelector<HTMLTextAreaElement>('#apiKey')!, 'sk-ant-api03-x');
    await run(() => {});

    await run(() => container.querySelector<HTMLButtonElement>('button[type=submit]')!.click());
    const submit = container.querySelector<HTMLButtonElement>('button[type=submit]')!;
    expect(submit.textContent).toBe('Saving...');
    expect(submit.disabled).toBe(true);
    expect(container.querySelector('[role=dialog]')).not.toBeNull();

    await run(() => reply.resolve({ success: true }));
    expect(container.querySelector('[role=dialog]')).toBeNull();
  });

  it('unlock keeps the raven and header on screen while the password is checked', async () => {
    bg.state.unlocked = false;
    const reply = deferred();
    bg.handlers.unlock = () => reply.promise;
    view = await mount(App);
    const { container } = view;

    typeInto(container.querySelector<HTMLInputElement>('#password')!, 'wrong-password');
    await run(() => {});
    await run(() => container.querySelector<HTMLButtonElement>('button[type=submit]')!.click());

    expect(container.querySelector('.loading')).toBeNull();
    expect(container.querySelector('.logo')).not.toBeNull();
    expect(container.querySelector('.brand-mark svg')).not.toBeNull();
    const submit = container.querySelector<HTMLButtonElement>('button[type=submit]')!;
    expect(submit.textContent).toBe('Unlocking...');
    expect(submit.disabled).toBe(true);

    await run(() => reply.resolve({ success: false }));
    expect(container.querySelector('.error')?.textContent).toBe('Incorrect password');
    expect(container.querySelector<HTMLInputElement>('#password')!.value).toBe('wrong-password');
    expect(useWalletStore.getState().submitting).toBe(false);
  });

  it('a thrown unlock does not leave the button stuck', async () => {
    bg.state.unlocked = false;
    bg.handlers.unlock = () => { throw new Error('Could not reach the wallet'); };
    view = await mount(App);
    const { container } = view;
    typeInto(container.querySelector<HTMLInputElement>('#password')!, 'pw');
    await run(() => {});
    await run(() => container.querySelector<HTMLButtonElement>('button[type=submit]')!.click());
    expect(container.querySelector('.error')?.textContent).toBe('Could not reach the wallet');
    expect(container.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(false);
  });
});
