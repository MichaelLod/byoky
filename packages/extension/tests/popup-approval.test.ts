// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { bg, mount, run, buttonByText, type Mounted } from './helpers/popup-harness';

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

interface FakeApproval { id: string; appOrigin: string; providers: unknown; timestamp: number }

function approval(id: string, appOrigin: string, providers: unknown = [{ id: 'anthropic', required: false }]): FakeApproval {
  return { id, appOrigin, providers, timestamp: 1 };
}

/** The background's approve/reject: drop the request from the queue. */
function resolveQueued() {
  const drop = (p: { approvalId: string }) => {
    const before = bg.state.approvals.length;
    bg.state.approvals = (bg.state.approvals as FakeApproval[]).filter((a) => a.id !== p.approvalId);
    return before === bg.state.approvals.length
      ? { success: false, error: 'Approval not found' }
      : { success: true };
  };
  bg.handlers.approveConnect = drop;
  bg.handlers.rejectConnect = drop;
}

function trustBox(container: HTMLElement) {
  return container.querySelector<HTMLInputElement>('.approval-trust input[type=checkbox]')!;
}

beforeEach(() => {
  bg.reset();
  bg.state.credentials = [{ id: 'c1', providerId: 'anthropic', label: 'Personal', authMethod: 'api_key', createdAt: 1 }];
  useWalletStore.setState(initial, true);
  document.body.innerHTML = '';
  resolveQueued();
});

afterEach(() => {
  view?.unmount();
  view = null;
});

describe('trust checkbox is per request (F011)', () => {
  it('does not carry a tick over to the next queued origin after approve', async () => {
    bg.state.approvals = [approval('a1', 'http://127.0.0.1:5173'), approval('a2', 'http://localhost:3000')];
    view = await mount(App);
    const { container } = view;
    expect(useWalletStore.getState().currentPage).toBe('approval');

    await run(() => trustBox(container).click());
    expect(trustBox(container).checked).toBe(true);
    await run(() => buttonByText(container, 'Approve')!.click());

    expect(bg.payloads('approveConnect')[0]).toEqual({ approvalId: 'a1', trust: true });
    expect(container.querySelector('.approval-full-origin')?.textContent).toBe('http://localhost:3000');
    expect(trustBox(container).checked).toBe(false);

    await run(() => buttonByText(container, 'Approve')!.click());
    expect(bg.payloads('approveConnect')[1]).toEqual({ approvalId: 'a2', trust: false });
  });

  it('does not carry a tick over after reject either', async () => {
    bg.state.approvals = [approval('a1', 'http://127.0.0.1:5173'), approval('a2', 'http://localhost:3000')];
    view = await mount(App);
    const { container } = view;
    await run(() => trustBox(container).click());
    await run(() => buttonByText(container, 'Reject')!.click());
    expect(container.querySelector('.approval-full-origin')?.textContent).toBe('http://localhost:3000');
    expect(trustBox(container).checked).toBe(false);
  });
});

describe('approval headline names the full origin (F093)', () => {
  it('keeps the port and flags plain http', async () => {
    bg.state.approvals = [approval('a1', 'http://example.com:8080')];
    view = await mount(App);
    const { container } = view;
    expect(container.querySelector('.approval-origin')?.textContent).toBe('example.com:8080');
    expect(container.querySelector('.result-tag.alarm')?.textContent?.trim()).toBe('Not secure');
  });

  it('does not flag a loopback app', async () => {
    bg.state.approvals = [approval('a1', 'http://localhost:3000')];
    view = await mount(App);
    expect(view.container.querySelector('.approval-origin')?.textContent).toBe('localhost:3000');
    expect(view.container.querySelector('.result-tag.alarm')).toBeNull();
  });
});
