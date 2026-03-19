import { create } from 'zustand';
import {
  type AuthMethod,
  type CredentialMeta,
  type Session,
  type RequestLogEntry,
  type PendingApproval,
  type TrustedSite,
  type TokenAllowance,
  hashPassword,
} from '@byoky/core';

type Page =
  | 'setup'
  | 'unlock'
  | 'dashboard'
  | 'add-credential'
  | 'connected-apps'
  | 'usage'
  | 'request-history'
  | 'approval'
  | 'settings';

interface WalletState {
  isInitialized: boolean;
  isUnlocked: boolean;
  credentials: CredentialMeta[];
  sessions: Session[];
  requestLog: RequestLogEntry[];
  pendingApprovals: PendingApproval[];
  trustedSites: TrustedSite[];
  tokenAllowances: TokenAllowance[];
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
  approveConnect: (approvalId: string, trust: boolean) => Promise<void>;
  rejectConnect: (approvalId: string) => Promise<void>;
  removeTrustedSite: (origin: string) => Promise<void>;
  setAllowance: (allowance: TokenAllowance) => Promise<void>;
  removeAllowance: (origin: string) => Promise<void>;
  refreshData: () => Promise<void>;
  clearError: () => void;
}

async function sendInternal(action: string, payload?: unknown): Promise<Record<string, unknown>> {
  return browser.runtime.sendMessage({
    type: 'BYOKY_INTERNAL',
    action,
    payload,
  }) as Promise<Record<string, unknown>>;
}

export const useWalletStore = create<WalletState>((set, get) => ({
  isInitialized: false,
  isUnlocked: false,
  credentials: [],
  sessions: [],
  requestLog: [],
  pendingApprovals: [],
  trustedSites: [],
  tokenAllowances: [],
  currentPage: 'unlock',
  loading: true,
  error: null,

  init: async () => {
    const initResult = await sendInternal('isInitialized');
    const unlockResult = await sendInternal('isUnlocked');
    const initialized = initResult.initialized as boolean;
    const unlocked = unlockResult.unlocked as boolean;

    let page: Page = 'unlock';
    if (!initialized) page = 'setup';
    else if (unlocked) page = 'dashboard';

    set({ isInitialized: initialized, isUnlocked: unlocked, currentPage: page, loading: false });

    if (unlocked) {
      await get().refreshData();
      if (get().pendingApprovals.length > 0) {
        set({ currentPage: 'approval' });
      }
    }
  },

  setup: async (password: string) => {
    set({ loading: true, error: null });
    try {
      const hash = await hashPassword(password);
      await browser.storage.local.set({ passwordHash: hash, credentials: [] });
      const setupResult = await sendInternal('unlock', { password });
      if (setupResult.success) {
        set({ isInitialized: true, isUnlocked: true, currentPage: 'dashboard', loading: false });
      }
    } catch (e) {
      set({ error: (e as Error).message, loading: false });
    }
  },

  unlock: async (password: string) => {
    set({ loading: true, error: null });
    const unlockResult = await sendInternal('unlock', { password });
    if (unlockResult.success) {
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
      requestLog: [],
      pendingApprovals: [],
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
      const encResult = await sendInternal('encryptValue', { value: cleanKey });
      if (encResult.error) throw new Error(encResult.error as string);
      const encryptedKey = encResult.encrypted as string;

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
      const encResult = await sendInternal('encryptValue', { value: cleanToken });
      if (encResult.error) throw new Error(encResult.error as string);
      const encryptedAccessToken = encResult.encrypted as string;

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
      const oauthResult = await sendInternal('startOAuth', { providerId, label });
      if (!oauthResult.success) {
        throw new Error((oauthResult.error as string) || 'OAuth flow failed');
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

  approveConnect: async (approvalId: string, trust: boolean) => {
    await sendInternal('approveConnect', { approvalId, trust });
    await get().refreshData();
    if (get().pendingApprovals.length === 0) {
      set({ currentPage: 'dashboard' });
    }
  },

  rejectConnect: async (approvalId: string) => {
    await sendInternal('rejectConnect', { approvalId });
    await get().refreshData();
    if (get().pendingApprovals.length === 0) {
      set({ currentPage: 'dashboard' });
    }
  },

  removeTrustedSite: async (origin: string) => {
    await sendInternal('removeTrustedSite', { origin });
    await get().refreshData();
  },

  setAllowance: async (allowance: TokenAllowance) => {
    await sendInternal('setAllowance', { allowance });
    await get().refreshData();
  },

  removeAllowance: async (origin: string) => {
    await sendInternal('removeAllowance', { origin });
    await get().refreshData();
  },

  refreshData: async () => {
    const [credResult, sessionResult, logResult, approvalResult, trustedResult, allowanceResult] = await Promise.all([
      sendInternal('getCredentials'),
      sendInternal('getSessions'),
      sendInternal('getRequestLog'),
      sendInternal('getPendingApprovals'),
      sendInternal('getTrustedSites'),
      sendInternal('getAllowances'),
    ]);

    const metas: CredentialMeta[] = ((credResult.credentials ?? []) as Array<Record<string, unknown>>).map(
      (c: Record<string, unknown>) => ({
        id: c.id as string,
        providerId: c.providerId as string,
        label: c.label as string,
        authMethod: c.authMethod as AuthMethod,
        createdAt: c.createdAt as number,
        lastUsedAt: c.lastUsedAt as number | undefined,
        maskedKey: c.authMethod === 'api_key' ? '••••••••' : c.authMethod === 'oauth' ? 'Setup Token' : undefined,
      }),
    );

    set({
      credentials: metas,
      sessions: (sessionResult.sessions ?? []) as Session[],
      requestLog: (logResult.log ?? []) as RequestLogEntry[],
      pendingApprovals: (approvalResult.approvals ?? []) as PendingApproval[],
      trustedSites: (trustedResult.sites ?? []) as TrustedSite[],
      tokenAllowances: (allowanceResult.allowances ?? []) as TokenAllowance[],
    });
  },

  clearError: () => set({ error: null }),
}));

