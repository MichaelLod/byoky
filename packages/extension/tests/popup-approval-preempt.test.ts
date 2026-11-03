// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { bg, mount, run, typeInto, buttonByText, type Mounted } from './helpers/popup-harness';

// F054: a connection request switched the view to the approval screen
// whatever the user was doing: the add-credential sheet (with a pasted key),
// the export form or a group editor were unmounted and what was typed lost,
// and after the answer the wallet went to the dashboard.

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

const request = (id: string, appOrigin: string) => ({ id, appOrigin, providers: [{ id: 'openai', required: true }], timestamp: 1 });

beforeEach(() => {
  bg.reset();
  bg.state.credentials = [{ id: 'a1', providerId: 'anthropic', label: 'Personal', authMethod: 'api_key', createdAt: 1 }];
  // The background's approve/reject: the request leaves the queue.
  const answer = (p: { approvalId: string }) => {
    bg.state.approvals = (bg.state.approvals as Array<{ id: string }>).filter((a) => a.id !== p.approvalId);
    return { success: true };
  };
  bg.handlers.approveConnect = answer;
  bg.handlers.rejectConnect = answer;
  useWalletStore.setState(initial, true);
  document.body.innerHTML = '';
});

afterEach(() => {
  view?.unmount();
  view = null;
});

/** An app asks to connect while the view is open. */
async function requestArrives(...origins: string[]) {
  bg.state.approvals = origins.map((o, i) => request(`r${i}`, o));
  await bg.broadcast('newPendingApproval');
}

const banner = (c: HTMLElement) => c.querySelector('.pending-banner');
const page = () => useWalletStore.getState().currentPage;

describe('an incoming request doesn\'t take over a form in use (F054)', () => {
  it('keeps the add-credential sheet and what was typed, and shows a banner', async () => {
    view = await mount(App);
    const { container } = view;
    await run(() => useWalletStore.getState().openModal('add-credential'));
    typeInto(container.querySelector<HTMLSelectElement>('#provider')!, 'openai');
    typeInto(container.querySelector<HTMLInputElement>('#label')!, 'My OpenAI');
    typeInto(container.querySelector<HTMLTextAreaElement>('#apiKey')!, 'sk-proj-typed');
    await run(() => {});

    await requestArrives('https://app.example', 'https://other.example');
    expect(page()).toBe('dashboard');
    expect(useWalletStore.getState().modal).toBe('add-credential');
    expect(container.querySelector<HTMLInputElement>('#label')!.value).toBe('My OpenAI');
    expect(container.querySelector<HTMLTextAreaElement>('#apiKey')!.value).toBe('sk-proj-typed');
    expect(banner(container)?.textContent).toContain('app.example wants to connect (+1 more)');
    expect(banner(container)?.querySelector('svg')?.getAttribute('aria-label')).toBe('Muninn the raven, on alert');
  });

  it('stays in Settings; Review shows the request, and the answer goes back there', async () => {
    view = await mount(App);
    const { container } = view;
    await run(() => useWalletStore.getState().navigate('settings'));
    await requestArrives('https://app.example');
    expect(page()).toBe('settings');
    expect(banner(container)?.textContent).toContain('app.example wants to connect');

    await run(() => buttonByText(banner(container)!, 'Review')!.click());
    expect(page()).toBe('approval');
    expect(banner(container)).toBeNull();
    await run(() => buttonByText(container, 'Approve')!.click());
    expect(page()).toBe('settings');
    expect(banner(container)).toBeNull();
  });

  it('keeps an open group editor on the Connect page, and goes back to it after a reject', async () => {
    view = await mount(App);
    const { container } = view;
    await run(() => useWalletStore.getState().navigate('connect'));
    await run(() => buttonByText(container, '+ New group')!.click());
    const name = () => container.querySelector<HTMLInputElement>('input[placeholder="e.g. Engineering"]');
    typeInto(name()!, 'Engineering');
    await run(() => {});

    await requestArrives('https://app.example');
    expect(page()).toBe('connect');
    expect(name()?.value).toBe('Engineering');

    await run(() => buttonByText(banner(container)!, 'Review')!.click());
    await run(() => buttonByText(container, 'Reject')!.click());
    expect(page()).toBe('connect');
  });

  it('keeps a credential being renamed on the dashboard', async () => {
    view = await mount(App);
    const { container } = view;
    await run(() => container.querySelector<HTMLElement>('[aria-label="Rename credential"]')!.click());
    expect(useWalletStore.getState().formsInUse).toBe(1);
    await requestArrives('https://app.example');
    expect(page()).toBe('dashboard');
    expect(banner(container)).not.toBeNull();
  });

  it('still shows the request at once over a page without a form in use', async () => {
    view = await mount(App);
    const { container } = view;
    await run(() => useWalletStore.getState().navigate('request-history'));
    await requestArrives('https://app.example');
    expect(page()).toBe('approval');
    await run(() => buttonByText(container, 'Reject')!.click());
    expect(page()).toBe('request-history');
  });
});
