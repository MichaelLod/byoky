// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { bg, mount, run, buttonByText, typeInto, type Mounted } from './helpers/popup-harness';

// The raven as a stand-in that shows the state App gives it.
vi.mock('../entrypoints/popup/components/Raven', async () => {
  const { createElement } = await import('react');
  return {
    Raven: ({ state, view }: { state?: string; view?: string }) =>
      createElement('svg', { 'data-state': state ?? 'watching', 'data-view': view ?? 'full' }),
  };
});

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

const req = (id: string) => ({ id, appOrigin: 'https://app.example', providers: [{ id: 'anthropic' }], timestamp: 1 });

/** The status-strip raven's state, or null while the strip is hidden. */
function stripRaven(): string | null {
  return view!.container.querySelector('.status-strip svg')?.getAttribute('data-state') ?? null;
}

/** A request arrives and the popup shows it. */
async function arrives(id: string) {
  bg.state.approvals = [req(id)];
  await bg.broadcast('newPendingApproval');
  expect(useWalletStore.getState().currentPage).toBe('approval');
  expect(stripRaven()).toBeNull();
}

beforeEach(() => {
  bg.reset();
  useWalletStore.setState(initial, true);
  document.body.innerHTML = '';
  // The background's approve/reject: drop the request from the queue.
  const drop = (p: { approvalId: string }) => {
    bg.state.approvals = (bg.state.approvals as Array<{ id: string }>).filter((a) => a.id !== p.approvalId);
    return { success: true };
  };
  bg.handlers.approveConnect = drop;
  bg.handlers.rejectConnect = drop;
});

afterEach(() => {
  view?.unmount();
  view = null;
});

// R2-12: the strip's raven nodded again each time the strip came back (after
// another request was rejected), because what it nodded for was never reset.
describe('the status-strip raven nods once per approval and unlock', () => {
  it('nods after an approval, not again when the strip comes back after a rejection', async () => {
    bg.state.approvals = [req('a1')];
    view = await mount(App);
    await run(() => buttonByText(view!.container, 'Approve')!.click());
    expect(useWalletStore.getState().currentPage).toBe('dashboard');
    expect(stripRaven()).toBe('nod-then-watching');
    // Data refreshing mid-nod doesn't cut the nod short.
    await bg.broadcast('usageUpdated');
    expect(stripRaven()).toBe('nod-then-watching');

    await arrives('a2');
    await run(() => buttonByText(view!.container, 'Reject')!.click());
    expect(useWalletStore.getState().currentPage).toBe('dashboard');
    expect(stripRaven()).toBe('watching');

    await arrives('a3');
    await run(() => buttonByText(view!.container, 'Approve')!.click());
    expect(stripRaven()).toBe('nod-then-watching');
  });

  it('nods after an unlock, not again when the strip comes back after a rejection', async () => {
    bg.state.unlocked = false;
    bg.handlers.unlock = () => {
      bg.state.unlocked = true;
      return { success: true };
    };
    view = await mount(App);
    expect(useWalletStore.getState().currentPage).toBe('unlock');
    typeInto(view.container.querySelector<HTMLInputElement>('#password')!, 'right');
    await run(() => {});
    await run(() => view!.container.querySelector<HTMLButtonElement>('button[type=submit]')!.click());
    expect(useWalletStore.getState().currentPage).toBe('dashboard');
    expect(stripRaven()).toBe('nod-then-watching');

    await arrives('a1');
    await run(() => buttonByText(view!.container, 'Reject')!.click());
    expect(stripRaven()).toBe('watching');
  });

  it('just watches in a popup opened on an unlocked wallet', async () => {
    view = await mount(App);
    expect(stripRaven()).toBe('watching');
  });
});
