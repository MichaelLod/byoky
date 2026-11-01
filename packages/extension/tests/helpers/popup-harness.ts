// Shared stand-in for the background script, for jsdom tests that render the
// real popup. The popup reaches the background only through
// browser.runtime.sendMessage and hears from it only through
// browser.runtime.onMessage, so both are faked here.
//
// Import this module before the popup modules: it stubs the `browser` global
// and the browser APIs jsdom lacks (matchMedia for the raven).
import { vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

type Handler = (payload: any) => unknown;
type Listener = (message: unknown) => void;

export interface FakeBackgroundState {
  initialized: boolean;
  unlocked: boolean;
  approvals: unknown[];
  credentials: unknown[];
  sessions: unknown[];
  log: unknown[];
  groups: unknown[];
  appGroups: Record<string, string>;
}

const defaultState = (): FakeBackgroundState => ({
  initialized: true,
  unlocked: true,
  approvals: [],
  credentials: [],
  sessions: [],
  log: [],
  groups: [],
  appGroups: {},
});

export const bg = {
  state: defaultState(),
  /** Per-test overrides, keyed by action. */
  handlers: {} as Record<string, Handler>,
  listeners: new Set<Listener>(),
  reset() {
    this.state = defaultState();
    this.handlers = {};
    sendMessage.mockClear();
  },
  /** Actions sent so far, in order. */
  actions(): string[] {
    return sendMessage.mock.calls.map(([m]) => (m as { action: string }).action);
  },
  /** Payloads sent with `action`. */
  payloads(action: string): unknown[] {
    return sendMessage.mock.calls
      .map(([m]) => m as { action: string; payload?: unknown })
      .filter((m) => m.action === action)
      .map((m) => m.payload);
  },
  /** Broadcast an internal message to every open view, as the background does. */
  async broadcast(action: string) {
    await act(async () => {
      for (const l of [...this.listeners]) l({ type: 'BYOKY_INTERNAL', action });
      await flush();
    });
  },
};

function defaultResponse(action: string): unknown {
  const s = bg.state;
  switch (action) {
    case 'isInitialized': return { initialized: s.initialized };
    case 'isUnlocked': return { unlocked: s.unlocked };
    case 'getRetiredFeaturesNotice': return { show: false };
    case 'getCredentials': return { credentials: s.credentials };
    case 'getSessions': return { sessions: s.sessions };
    case 'getRequestLog': return { log: s.log };
    case 'getPendingApprovals': return { approvals: s.approvals };
    case 'getTrustedSites': return { sites: [], trustReset: false };
    case 'getAllowances': return { allowances: [], usage: {} };
    case 'getGroups': return { groups: s.groups, appGroups: s.appGroups };
    default: return { error: 'Unknown action' };
  }
}

export const sendMessage = vi.fn(async (msg: { action: string; payload?: unknown }) => {
  const handler = bg.handlers[msg.action];
  return handler ? handler(msg.payload) : defaultResponse(msg.action);
});

vi.stubGlobal('browser', {
  runtime: {
    sendMessage,
    onMessage: {
      addListener: (l: Listener) => bg.listeners.add(l),
      removeListener: (l: Listener) => bg.listeners.delete(l),
    },
  },
});

if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Let pending promise chains (store actions awaiting fake messages) settle. */
export async function flush(rounds = 10) {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
}

export interface Mounted {
  root: Root;
  container: HTMLElement;
  unmount: () => void;
}

/** Render a component into a fresh container and let its first effects settle. */
export async function mount(component: React.FunctionComponent | React.ComponentClass): Promise<Mounted> {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(component));
    await flush();
  });
  return {
    root,
    container,
    unmount: () => act(() => root.unmount()),
  };
}

/** Run `fn` (usually a click or a store action) inside act and let it settle. */
export async function run(fn: () => unknown) {
  await act(async () => {
    await fn();
    await flush();
  });
}

/** Set a React-controlled input's value the way a user typing would. */
export function typeInto(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : el instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
}

/** The first button whose visible text is `text` (trimmed), or undefined. */
export function buttonByText(container: ParentNode, text: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);
}

/** A promise with its resolve exposed, to hold a fake background reply. */
export function deferred<T = unknown>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}
