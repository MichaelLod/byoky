import { create } from 'zustand';
import {
  type CredentialMeta,
  type Session,
  type RequestLogEntry,
  hashPassword,
  encrypt,
  maskKey,
} from '@byoky/core';

type Page =
  | 'setup'
  | 'unlock'
  | 'dashboard'
  | 'add-credential'
  | 'request-history';

interface WalletState {
  isInitialized: boolean;
  isUnlocked: boolean;
  credentials: CredentialMeta[];
  sessions: Session[];
  requestLog: RequestLogEntry[];
  currentPage: Page;
  loading: boolean;
  error: string | null;

  init: () => Promise<void>;
  setup: (password: string) => Promise<void>;
  unlock: (password: string) => Promise<boolean>;
  lock: () => Promise<void>;
  navigate: (page: Page) => void;
  addApiKey: (providerId: string, label: string, apiKey: string) => Promise<void>;
  addSetupToken: (providerId: string, label: string, token: string) => Promise<void>;
  startOAuth: (providerId: string, label: string) => Promise<void>;
  removeCredential: (id: string) => Promise<void>;
  revokeSession: (sessionId: string) => Promise<void>;
  refreshData: () => Promise<void>;
  clearError: () => void;
}

async function sendInternal(action: string, payload?: unknown) {
  return browser.runtime.sendMessage({
    type: 'BYOKY_INTERNAL',
    action,
    payload,
  });
}

export const useWalletStore = create<WalletState>((set, get) => ({
  isInitialized: false,
  isUnlocked: false,
  credentials: [],
  sessions: [],
  requestLog: [],
  currentPage: 'unlock',
  loading: true,
  error: null,

  init: async () => {
    const { initialized } = await sendInternal('isInitialized');
    const { unlocked } = await sendInternal('isUnlocked');

    let page: Page = 'unlock';
    if (!initialized) page = 'setup';
    else if (unlocked) page = 'dashboard';

    set({ isInitialized: initialized, isUnlocked: unlocked, currentPage: page, loading: false });

    if (unlocked) {
      await get().refreshData();
    }
  },

  setup: async (password: string) => {
    set({ loading: true, error: null });
    try {
      const hash = await hashPassword(password);
      await browser.storage.local.set({ passwordHash: hash, credentials: [] });
      const { success } = await sendInternal('unlock', { password });
      if (success) {
        set({ isInitialized: true, isUnlocked: true, currentPage: 'dashboard', loading: false });
      }
    } catch (e) {
      set({ error: (e as Error).message, loading: false });
    }
  },

  unlock: async (password: string) => {
    set({ loading: true, error: null });
    const { success } = await sendInternal('unlock', { password });
    if (success) {
      set({ isUnlocked: true, currentPage: 'dashboard', loading: false });
      await get().refreshData();
      return true;
    }
    set({ error: 'Incorrect password', loading: false });
    return false;
  },

  lock: async () => {
    await sendInternal('lock');
    set({
      isUnlocked: false,
      credentials: [],
      sessions: [],
      requestLog: [],
      currentPage: 'unlock',
    });
  },

  navigate: (page: Page) => set({ currentPage: page, error: null }),

  addApiKey: async (providerId: string, label: string, apiKey: string) => {
    set({ loading: true, error: null });
    try {
      // Get password from background to encrypt
      const data = await browser.storage.local.get('credentials');
      const credentials = (data.credentials ?? []) as Array<Record<string, unknown>>;

      // We need the password to encrypt — request it from background
      // For now, we encrypt client-side by asking user to enter password again
      // TODO: Use session-stored derived key
      const cleanKey = apiKey.replace(/\s+/g, '');
      const encryptedKey = await encrypt(cleanKey, await getSessionPassword());

      const newCred = {
        id: crypto.randomUUID(),
        providerId,
        label,
        authMethod: 'api_key' as const,
        encryptedKey,
        createdAt: Date.now(),
      };

      credentials.push(newCred);
      await browser.storage.local.set({ credentials });

      await get().refreshData();
      set({ currentPage: 'dashboard', loading: false });
    } catch (e) {
      set({ error: (e as Error).message, loading: false });
    }
  },

  addSetupToken: async (providerId: string, label: string, token: string) => {
    set({ loading: true, error: null });
    try {
      const data = await browser.storage.local.get('credentials');
      const credentials = (data.credentials ?? []) as Array<Record<string, unknown>>;

      const cleanToken = token.replace(/\s+/g, '');
      const encryptedAccessToken = await encrypt(cleanToken, await getSessionPassword());

      const newCred = {
        id: crypto.randomUUID(),
        providerId,
        label,
        authMethod: 'oauth' as const,
        encryptedAccessToken,
        createdAt: Date.now(),
      };

      credentials.push(newCred);
      await browser.storage.local.set({ credentials });

      await get().refreshData();
      set({ currentPage: 'dashboard', loading: false });
    } catch (e) {
      set({ error: (e as Error).message, loading: false });
    }
  },

  startOAuth: async (providerId: string, label: string) => {
    set({ loading: true, error: null });
    try {
      const result = await sendInternal('startOAuth', { providerId, label });
      if (!result.success) {
        throw new Error(result.error || 'OAuth flow failed');
      }
      await get().refreshData();
      set({ currentPage: 'dashboard', loading: false });
    } catch (e) {
      set({ error: (e as Error).message, loading: false });
    }
  },

  removeCredential: async (id: string) => {
    const data = await browser.storage.local.get('credentials');
    const credentials = (data.credentials ?? []) as Array<{ id: string }>;
    await browser.storage.local.set({
      credentials: credentials.filter((c) => c.id !== id),
    });
    await get().refreshData();
  },

  revokeSession: async (sessionId: string) => {
    await sendInternal('revokeSession', { sessionId });
    await get().refreshData();
  },

  refreshData: async () => {
    const [credResult, sessionResult, logResult] = await Promise.all([
      sendInternal('getCredentials'),
      sendInternal('getSessions'),
      sendInternal('getRequestLog'),
    ]);

    const metas: CredentialMeta[] = (credResult.credentials ?? []).map(
      (c: Record<string, unknown>) => ({
        id: c.id,
        providerId: c.providerId,
        label: c.label,
        authMethod: c.authMethod,
        createdAt: c.createdAt,
        lastUsedAt: c.lastUsedAt,
        maskedKey: c.authMethod === 'api_key' ? '••••••••' : c.authMethod === 'oauth' ? 'Setup Token' : undefined,
      }),
    );

    set({
      credentials: metas,
      sessions: sessionResult.sessions ?? [],
      requestLog: (logResult.log ?? []).slice(0, 50),
    });
  },

  clearError: () => set({ error: null }),
}));

// Temporary helper — in production this would use a session-stored derived key
let cachedPassword: string | null = null;

export function setSessionPassword(pw: string) {
  cachedPassword = pw;
}

async function getSessionPassword(): Promise<string> {
  if (cachedPassword) return cachedPassword;
  throw new Error('Session password not available');
}
