import { vi } from 'vitest';
import { credentialAad, deriveWalletMacKey, encrypt, hashPassword, type Credential } from '@byoky/core';
import {
  adoptLegacyRoutingState,
  hasSignedRoutingState,
  signRoutingState,
  signUsageState,
} from '../../lib/routing-state';

/**
 * Runs entrypoints/background.ts under vitest against a small fake of the
 * browser APIs it uses: storage.local/session, runtime messages and ports,
 * native messaging, alarms, action, windows and (Chrome) the side panel.
 *
 * Every startBackground() call imports a fresh copy of the module, so each
 * test gets its own closure: its own sessions, pending approvals and
 * lockout counters. Storage starts from what the test passes in.
 *
 * Captured before any test can install fake timers, so the harness's own
 * waits keep working under vi.useFakeTimers().
 */
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
const realSetImmediate = globalThis.setImmediate;

export const EXTENSION_ID = 'byoky-test-extension';
// Node's URL gives every non-special scheme (chrome-extension:, moz-extension:)
// the origin "null", which the background's sender check relies on, so the
// fake extension pages live under an https origin no web page can have.
export const EXTENSION_ORIGIN = 'https://extension.byoky.invalid';
export const PASSWORD = 'correct horse battery staple';

type Listener = (...args: any[]) => unknown;

export class FakeEvent {
  readonly listeners: Listener[] = [];
  addListener(fn: Listener) { this.listeners.push(fn); }
  removeListener(fn: Listener) {
    const i = this.listeners.indexOf(fn);
    if (i >= 0) this.listeners.splice(i, 1);
  }
  hasListener(fn: Listener) { return this.listeners.includes(fn); }
  emit(...args: unknown[]): unknown[] { return [...this.listeners].map((l) => l(...args)); }
}

/** Extension messaging and storage carry JSON-serializable values only. */
function wire<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function flush(): Promise<void> {
  return new Promise((resolve) => realSetImmediate(resolve));
}

export class FakeStorageArea {
  data: Record<string, unknown>;
  /** Milliseconds each call waits before running; 0 is a microtask. */
  latency: () => number = () => 0;

  constructor(initial: Record<string, unknown> = {}) {
    this.data = wire(initial);
  }

  private async tick() {
    const ms = this.latency();
    if (ms > 0) await new Promise((r) => realSetTimeout(r, ms));
    else await Promise.resolve();
  }

  async get(keys?: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>> {
    await this.tick();
    const out: Record<string, unknown> = {};
    if (keys == null) {
      for (const k of Object.keys(this.data)) out[k] = wire(this.data[k]);
      return out;
    }
    const defaults = typeof keys === 'object' && !Array.isArray(keys) ? keys : undefined;
    const list = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
    for (const k of list) {
      if (k in this.data) out[k] = wire(this.data[k]);
      else if (defaults) out[k] = defaults[k];
    }
    return out;
  }

  async set(items: Record<string, unknown>): Promise<void> {
    await this.tick();
    for (const [k, v] of Object.entries(items)) {
      if (v === undefined) continue;
      this.data[k] = wire(v);
    }
  }

  async remove(keys: string | string[]): Promise<void> {
    await this.tick();
    for (const k of typeof keys === 'string' ? [keys] : keys) delete this.data[k];
  }

  async clear(): Promise<void> {
    await this.tick();
    this.data = {};
  }
}

export interface FakeSender {
  id?: string;
  url?: string;
  origin?: string;
  tab?: { id: number; url?: string };
}

/** Whether a user gesture is being dispatched (Chrome's sidePanel.open() needs one). */
export const gesture = { active: false };

/**
 * One runtime port, seen from both ends. The background holds it as a
 * Runtime.Port; the test drives the other end with send() and close().
 */
export class FakePort {
  readonly onMessage = new FakeEvent();
  readonly onDisconnect = new FakeEvent();
  /** Messages the background posted to the other end. */
  readonly received: any[] = [];
  connected = true;
  closedByBackground = false;
  private waiters = new Set<() => void>();

  constructor(readonly name: string, readonly sender: FakeSender) {}

  // --- The background's side ---

  postMessage(msg: unknown) {
    if (!this.connected) throw new Error('Attempting to use a disconnected port object');
    this.received.push(wire(msg));
    this.wake();
  }

  /** Like Chrome, closing a port doesn't fire this side's onDisconnect. */
  disconnect() {
    if (!this.connected) return;
    this.connected = false;
    this.closedByBackground = true;
    this.wake();
  }

  // --- The test's side (the content script) ---

  /** Deliver a message to the background, optionally inside a user gesture. */
  send(msg: unknown, opts: { userGesture?: boolean } = {}) {
    if (!this.connected) throw new Error('Attempting to use a disconnected port object');
    gesture.active = opts.userGesture === true;
    try {
      this.onMessage.emit(wire(msg), this);
    } finally {
      gesture.active = false;
    }
  }

  /** The content script closes its end: the background's onDisconnect fires. */
  close() {
    if (!this.connected) return;
    this.connected = false;
    this.onDisconnect.emit(this);
  }

  /** Resolves with the first received message matching `pred`. */
  waitFor(pred: (msg: any) => boolean, timeoutMs = 10_000): Promise<any> {
    return new Promise((resolve, reject) => {
      const check = () => {
        const hit = this.received.find(pred);
        if (hit !== undefined) {
          this.waiters.delete(check);
          realClearTimeout(timer);
          resolve(hit);
        }
      };
      const timer = realSetTimeout(() => {
        this.waiters.delete(check);
        reject(new Error(`${this.name}: no matching message; got ${JSON.stringify(this.received)}`));
      }, timeoutMs);
      this.waiters.add(check);
      check();
    });
  }

  private wake() {
    for (const w of [...this.waiters]) w();
  }
}

/** A native-messaging port to the bridge, seen from both ends. */
export class FakeNativeConnection {
  readonly onMessage = new FakeEvent();
  readonly onDisconnect = new FakeEvent();
  /** Messages the background posted to the host. */
  readonly fromExtension: any[] = [];
  connected = true;
  closedByExtension = false;
  handler: (msg: any, conn: FakeNativeConnection) => void = () => {};

  constructor(readonly name: string) {}

  // --- The background's side ---

  postMessage(msg: unknown) {
    if (!this.connected) throw new Error('Attempting to use a disconnected port object');
    const m = wire(msg);
    this.fromExtension.push(m);
    queueMicrotask(() => { if (this.connected) this.handler(m, this); });
  }

  disconnect() {
    if (!this.connected) return;
    this.connected = false;
    this.closedByExtension = true;
  }

  // --- The host's side ---

  reply(msg: unknown) {
    if (!this.connected) return;
    this.onMessage.emit(wire(msg));
  }

  /** The host process dies: the background's onDisconnect fires. */
  crash() {
    if (!this.connected) return;
    this.connected = false;
    this.onDisconnect.emit(this);
  }
}

/** A host that answers the availability probe and nothing else. */
export function pingHost(msg: any, conn: FakeNativeConnection) {
  if (msg.type === 'ping') conn.reply({ type: 'pong' });
}

export interface HarnessOptions {
  /** storage.local contents at start. */
  local?: Record<string, unknown>;
  /** storage.session contents at start (MV3 only). */
  session?: Record<string, unknown>;
  /** Chrome: chrome.sidePanel, action.openPopup and runtime.getContexts exist. */
  chrome?: boolean;
  /** Firefox MV2: no storage.session, a sidebar instead of a side panel. */
  firefox?: boolean;
}

export interface ProxyResult {
  meta?: any;
  chunks: any[];
  text: string;
  done: boolean;
  error?: any;
  messages: any[];
}

export interface Harness {
  browser: any;
  chrome: any;
  local: FakeStorageArea;
  session: FakeStorageArea | undefined;
  /** Every runtime.sendMessage broadcast, in order. */
  broadcasts: any[];
  fetch: ReturnType<typeof vi.fn>;
  nativeConnections: FakeNativeConnection[];
  /** Handles messages the background posts to native hosts. */
  nativeHost: (msg: any, conn: FakeNativeConnection) => void;
  /** Send a BYOKY_INTERNAL message as the popup (or as `sender`). */
  internal(action: string, payload?: unknown, sender?: FakeSender): Promise<any>;
  unlock(password?: string): Promise<any>;
  /** A port opened by a content script in a frame of `origin` (null: opaque). */
  openPort(name: string, origin: string | null, tabId?: number): FakePort;
  /** Send a connect request; resolves with the background's reply. */
  connect(origin: string | null, payload?: Record<string, unknown>, opts?: { userGesture?: boolean; tabId?: number }): { port: FakePort; response: Promise<any> };
  /** Send a proxy request; resolves once it finished, failed or the port closed. */
  proxy(origin: string, req: Record<string, unknown>): { port: FakePort; result: Promise<ProxyResult> };
  /** Let pending callbacks and microtasks run. */
  settle(rounds?: number): Promise<void>;
  /** Poll `cond` until it holds. */
  until(cond: () => boolean | Promise<boolean>, timeoutMs?: number, what?: string): Promise<void>;
}

export function senderFor(origin: string | null, tabId = 1): FakeSender {
  if (origin === null) {
    // A sandboxed frame: Chrome reports the opaque origin as "null".
    return { id: EXTENSION_ID, url: 'about:srcdoc', origin: 'null', tab: { id: tabId, url: 'https://host.example/' } };
  }
  return { id: EXTENSION_ID, url: `${origin}/`, origin, tab: { id: tabId, url: `${origin}/` } };
}

export const POPUP_SENDER: FakeSender = { id: EXTENSION_ID, url: `${EXTENSION_ORIGIN}/popup.html` };

export async function startBackground(opts: HarnessOptions = {}): Promise<Harness> {
  vi.resetModules();
  gesture.active = false;

  const local = new FakeStorageArea(opts.local);
  const session = opts.firefox ? undefined : new FakeStorageArea(opts.session);
  const broadcasts: any[] = [];
  const nativeConnections: FakeNativeConnection[] = [];

  const runtime = {
    id: EXTENSION_ID,
    getURL: (path: string) => `${EXTENSION_ORIGIN}${path.startsWith('/') ? path : `/${path}`}`,
    onMessage: new FakeEvent(),
    onConnect: new FakeEvent(),
    onInstalled: new FakeEvent(),
    sendMessage: vi.fn(async (msg: unknown) => { broadcasts.push(wire(msg)); return undefined; }),
    // The background's keepalive call while it holds the worker.
    getPlatformInfo: vi.fn(async () => ({ os: 'mac', arch: 'arm64' })),
    connectNative: vi.fn((host: string) => {
      const conn = new FakeNativeConnection(host);
      conn.handler = (m, c) => harness.nativeHost(m, c);
      nativeConnections.push(conn);
      return conn;
    }),
  };

  const browser: any = {
    runtime,
    storage: { local, ...(session ? { session } : {}) },
    windows: { create: vi.fn(async () => ({ id: 99 })) },
    alarms: { create: vi.fn(), clear: vi.fn(async () => true), onAlarm: new FakeEvent() },
  };
  if (opts.firefox) {
    // MV2: browserAction, and no action.
    browser.sidebarAction = { toggle: vi.fn() };
    browser.browserAction = { onClicked: new FakeEvent(), setBadgeText: vi.fn(), setBadgeBackgroundColor: vi.fn() };
  } else {
    browser.action = { setBadgeText: vi.fn(), setBadgeBackgroundColor: vi.fn() };
  }

  const chrome = opts.chrome
    ? {
        sidePanel: {
          setPanelBehavior: vi.fn(),
          open: vi.fn(async (_o: { tabId: number }) => {
            if (!gesture.active) throw new Error('`sidePanel.open()` may only be called in response to a user gesture.');
          }),
        },
        action: { openPopup: vi.fn(async () => {}) },
        runtime: { getContexts: vi.fn(async () => [] as unknown[]) },
      }
    : undefined;

  const fetchMock = vi.fn(async (input: unknown) => {
    throw new Error(`unexpected fetch: ${String(input)}`);
  });

  vi.stubGlobal('browser', browser);
  vi.stubGlobal('chrome', chrome);
  vi.stubGlobal('defineBackground', (fn: () => void) => fn);
  vi.stubGlobal('fetch', fetchMock);

  const harness: Harness = {
    browser,
    chrome,
    local,
    session,
    broadcasts,
    fetch: fetchMock,
    nativeConnections,
    nativeHost: pingHost,

    async internal(action, payload, sender = POPUP_SENDER) {
      const results = runtime.onMessage.emit({ type: 'BYOKY_INTERNAL', action, payload }, sender);
      return await results.find((r) => r !== undefined);
    },

    unlock(password = PASSWORD) {
      return harness.internal('unlock', { password });
    },

    openPort(name, origin, tabId = 1) {
      const port = new FakePort(name, senderFor(origin, tabId));
      runtime.onConnect.emit(port);
      return port;
    },

    connect(origin, payload = {}, { userGesture = false, tabId = 1 } = {}) {
      const port = harness.openPort('byoky-message', origin, tabId);
      const id = crypto.randomUUID();
      port.send({ type: 'BYOKY_CONNECT_REQUEST', id, requestId: id, payload }, { userGesture });
      return { port, response: port.waitFor(() => true, 30_000) };
    },

    proxy(origin, req) {
      const port = harness.openPort('byoky-proxy', origin);
      const requestId = (req.requestId as string | undefined) ?? crypto.randomUUID();
      const result = new Promise<ProxyResult>((resolve, reject) => {
        const timer = realSetTimeout(() => reject(new Error(`proxy ${requestId} did not finish: ${JSON.stringify(port.received)}`)), 30_000);
        const finish = () => {
          const messages = port.received;
          const chunks = messages.filter((m) => m.type === 'BYOKY_PROXY_RESPONSE_CHUNK');
          realClearTimeout(timer);
          resolve({
            meta: messages.find((m) => m.type === 'BYOKY_PROXY_RESPONSE_META'),
            chunks,
            text: chunks.map((c) => c.chunk).join(''),
            done: messages.some((m) => m.type === 'BYOKY_PROXY_RESPONSE_DONE'),
            error: messages.find((m) => m.type === 'BYOKY_PROXY_RESPONSE_ERROR'),
            messages,
          });
        };
        port.waitFor((m) => m.type === 'BYOKY_PROXY_RESPONSE_DONE' || m.type === 'BYOKY_PROXY_RESPONSE_ERROR', 30_000)
          .then(finish, () => {});
      });
      port.send({
        type: 'BYOKY_PROXY_REQUEST',
        requestId,
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        ...req,
      });
      return { port, result };
    },

    async settle(rounds = 10) {
      for (let i = 0; i < rounds; i++) await flush();
    },

    async until(cond, timeoutMs = 10_000, what = 'condition') {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        if (await cond()) return;
        if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
        await new Promise((r) => realSetTimeout(r, 5));
      }
    },
  };

  // defineBackground is stubbed to return its argument, so the default
  // export is the background's main function itself.
  const mod = (await import('../../entrypoints/background')) as unknown as { default: () => void };
  mod.default();
  await harness.settle();
  return harness;
}

// --- Wallet fixtures ---

export interface CredentialSpec {
  id: string;
  providerId: string;
  key: string;
  label?: string;
  baseUrl?: string;
  authMethod?: 'api_key' | 'oauth';
  createdAt?: number;
  lastUsedAt?: number;
}

let passwordHash: Promise<string> | undefined;

/** The format-2 hash of PASSWORD, computed once per test file. */
export function walletPasswordHash(): Promise<string> {
  passwordHash ??= hashPassword(PASSWORD);
  return passwordHash;
}

let macKey: Promise<CryptoKey> | undefined;

/** The wallet MAC key under walletPasswordHash(), which signs the wallet's trust, routing and usage state. */
export function walletKey(): Promise<CryptoKey> {
  macKey ??= walletPasswordHash().then(async (hash) => (await deriveWalletMacKey(PASSWORD, hash))!);
  return macKey;
}

/** A stored credential record, its secret bound to it as the wallet stores it. */
export async function storedCredential(spec: CredentialSpec): Promise<Credential> {
  const authMethod = spec.authMethod ?? 'api_key';
  const field = authMethod === 'api_key' ? 'encryptedKey' : 'encryptedAccessToken';
  const record = { id: spec.id, providerId: spec.providerId, ...(spec.baseUrl ? { baseUrl: spec.baseUrl } : {}) };
  const secret = await encrypt(spec.key, PASSWORD, credentialAad(record, field));
  return {
    ...record,
    label: spec.label ?? spec.id,
    authMethod,
    createdAt: spec.createdAt ?? 1_760_000_000_000,
    ...(spec.lastUsedAt ? { lastUsedAt: spec.lastUsedAt } : {}),
    [field]: secret,
  } as Credential;
}

/**
 * storage.local for an upgraded (1.1.2) wallet holding `creds`. Groups, app
 * bindings, allowances and usage totals in `extra` are signed at epoch 1, as
 * the wallet keeps them (lib/routing-state.ts), unless `extra` brings its own
 * MAC or `unsignedRouting` asks for them as an earlier build left them.
 */
export async function walletStorage(
  creds: CredentialSpec[],
  extra: Record<string, unknown> = {},
  { unsignedRouting = false }: { unsignedRouting?: boolean } = {},
): Promise<Record<string, unknown>> {
  const wallet = {
    passwordHash: await walletPasswordHash(),
    credentials: await Promise.all(creds.map(storedCredential)),
    ...extra,
  };
  if (unsignedRouting || hasSignedRoutingState(extra)) return wallet;
  const { routing, usage } = adoptLegacyRoutingState(extra);
  const key = await walletKey();
  return { ...wallet, ...(await signRoutingState(routing, key, 1)), ...(await signUsageState(usage, key, 1)) };
}

/** A fetch Response with `body` and the given content type. */
export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

// --- Flows ---

/** Wait for the next pending approval and approve it from the popup. */
export async function approveNext(h: Harness, trust = false): Promise<void> {
  let approvals: Array<{ id: string }> = [];
  await h.until(async () => {
    approvals = (await h.internal('getPendingApprovals')).approvals;
    return approvals.length > 0;
  }, 10_000, 'a pending approval');
  const result = await h.internal('approveConnect', { approvalId: approvals[0].id, trust });
  if (!result?.success) throw new Error(`approveConnect failed: ${JSON.stringify(result)}`);
}

/** Connect `origin` and approve it; resolves with the BYOKY_CONNECT_RESPONSE. */
export async function connectApproved(
  h: Harness,
  origin: string,
  payload: Record<string, unknown> = {},
  trust = false,
): Promise<any> {
  const { response } = h.connect(origin, payload);
  await approveNext(h, trust);
  const reply = await response;
  if (reply.type !== 'BYOKY_CONNECT_RESPONSE') throw new Error(`connect failed: ${JSON.stringify(reply)}`);
  return reply;
}

/** The request log as stored. */
export function requestLog(h: Harness): any[] {
  return (h.local.data.requestLog as any[]) ?? [];
}
