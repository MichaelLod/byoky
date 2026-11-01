// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
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

async function pick(input: HTMLInputElement, file: File) {
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
    // FileReader reports back on a later task.
    await new Promise((r) => setTimeout(r, 20));
  });
}

describe('import after a rejected file (F124)', () => {
  it('drops the earlier file when the next one is too large', async () => {
    view = await mount(App);
    const { container } = view;
    await run(() => useWalletStore.getState().navigate('settings'));
    await run(() => buttonByText(container, 'Import backup')!.click());
    const input = container.querySelector<HTMLInputElement>('input[type=file]')!;
    const importButton = () => buttonByText(container, 'Import')!;

    await pick(input, new File(['{"v":1}'], 'bad.byoky'));
    typeInto(container.querySelector<HTMLInputElement>('#import-pw')!, 'export-pass');
    await run(() => {});
    expect(container.querySelector('.btn-file')?.textContent).toBe('bad.byoky');
    expect(importButton().disabled).toBe(false);

    const big = new File(['x'], 'big.byoky');
    Object.defineProperty(big, 'size', { value: 11 * 1024 * 1024 });
    await pick(input, big);

    expect(container.querySelector('.error')?.textContent).toBe('File too large (max 10MB)');
    expect(container.querySelector('.btn-file')?.textContent).toBe('Choose .byoky file');
    expect(importButton().disabled).toBe(true);
    expect(input.value).toBe('');
  });

  it('clears the size error when a good file is picked next', async () => {
    view = await mount(App);
    const { container } = view;
    await run(() => useWalletStore.getState().navigate('settings'));
    await run(() => buttonByText(container, 'Import backup')!.click());
    const input = container.querySelector<HTMLInputElement>('input[type=file]')!;

    const big = new File(['x'], 'big.byoky');
    Object.defineProperty(big, 'size', { value: 11 * 1024 * 1024 });
    await pick(input, big);
    expect(container.querySelector('.error')).not.toBeNull();

    await pick(input, new File(['{"v":1}'], 'good.byoky'));
    expect(container.querySelector('.error')).toBeNull();
    expect(container.querySelector('.btn-file')?.textContent).toBe('good.byoky');
  });
});
