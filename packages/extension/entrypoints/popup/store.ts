import { create } from 'zustand';
import {
  type AuthMethod,
  type CredentialMeta,
  type Session,
  type RequestLogEntry,
  type PendingApproval,
  type TrustedSite,
  type TokenAllowance,
  type Group,
  type AppGroups,
  hashPassword,
} from '@byoky/core';

type Page =
  | 'setup'
  | 'unlock'
  | 'dashboard'
  | 'add-credential'
  | 'connect'
  | 'connected-apps'
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
  groups: Group[];
  appGroups: AppGroups;
  showRetiredFeaturesNotice: boolean;
  currentPage: Page;
  modal: 'add-credential' | null;
  loading: boolean;
  error: string | null;

  init: () => Promise<void>;
  setup: (password: string) => Promise<void>;
  dismissRetiredFeaturesNotice: () => Promise<void>;
  markRetiredFeaturesNoticeSeen: () => Promise<void>;
  unlock: (password: string) => Promise<boolean>;
  lock: () => Promise<void>;
  navigate: (page: Page) => void;
  openModal: (modal: 'add-credential') => void;
  closeModal: () => void;
  addApiKey: (providerId: string, label: string, apiKey: string, baseUrl?: string) => Promise<void>;
  addSetupToken: (providerId: string, label: string, token: string) => Promise<void>;
  startOAuth: (providerId: string, label: string) => Promise<void>;
  removeCredential: (id: string) => Promise<void>;
  renameCredential: (id: string, label: string) => Promise<boolean>;
  revokeSession: (sessionId: string) => Promise<void>;
  approveConnect: (approvalId: string, trust: boolean) => Promise<void>;
  rejectConnect: (approvalId: string) => Promise<void>;
  removeTrustedSite: (origin: string) => Promise<void>;
  setAllowance: (allowance: TokenAllowance) => Promise<void>;
  removeAllowance: (origin: string) => Promise<void>;
  createGroup: (input: { name: string; providerId: string; credentialId?: string; model?: string }) => Promise<string | null>;
  updateGroup: (id: string, patch: { name?: string; providerId?: string; credentialId?: string | null; model?: string | null }) => Promise<boolean>;
  deleteGroup: (id: string) => Promise<boolean>;
  setAppGroup: (origin: string, groupId: string) => Promise<boolean>;
  resetWallet: () => Promise<void>;
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
  groups: [],
  appGroups: {},
  showRetiredFeaturesNotice: false,
  currentPage: 'unlock',
  modal: null,
  loading: true,
  error: null,

  init: async () => {
    const initResult = await sendInternal('isInitialized');
    const unlockResult = await sendInternal('isUnlocked');
    const initialized = initResult.initialized as boolean;
    const unlocked = unlockResult.unlocked as boolean;
    const noticeResult = await sendInternal('getRetiredFeaturesNotice');

    let page: Page = 'unlock';
    if (!initialized) page = 'setup';
    else if (unlocked) page = 'dashboard';

    set({
      isInitialized: initialized,
      isUnlocked: unlocked,
      currentPage: page,
      showRetiredFeaturesNotice: noticeResult.show === true,
      loading: false,
    });

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
      await sendInternal('setupWallet', { passwordHash: hash });
      const setupResult = await sendInternal('unlock', { password });
      if (setupResult.success) {
        set({ isInitialized: true, isUnlocked: true, currentPage: 'dashboard', loading: false });
      }
    } catch (e) {
      set({ error: (e as Error).message, loading: false });
    }
  },

  dismissRetiredFeaturesNotice: async () => {
    await sendInternal('dismissRetiredFeaturesNotice');
    set({ showRetiredFeaturesNotice: false });
  },

  // Clears the stored flag but keeps the notice on screen for this session,
  // so it shows once and doesn't return the next time the popup opens.
  markRetiredFeaturesNoticeSeen: async () => {
    await sendInternal('dismissRetiredFeaturesNotice');
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
      groups: [],
      appGroups: {},
      currentPage: 'unlock',
      modal: null,
    });
  },

  navigate: (page: Page) => {
    const preAuthPages: Page[] = ['setup', 'unlock'];
    if (!get().isUnlocked && !preAuthPages.includes(page)) {
      set({ currentPage: 'unlock', error: null, modal: null });
      return;
    }
    // The add-credential flow is a popup-style overlay; route navigate()
    // calls there to the modal so the underlying page stays visible.
    if (page === 'add-credential') {
      set({ modal: page, error: null });
      return;
    }
    set({ currentPage: page, error: null, modal: null });
  },

  openModal: (modal) => {
    if (!get().isUnlocked) return;
    set({ modal, error: null });
  },

  closeModal: () => set({ modal: null, error: null }),

  addApiKey: async (providerId: string, label: string, apiKey: string, baseUrl?: string) => {
    set({ loading: true, error: null });
    try {
      const result = await sendInternal('addCredential', {
        providerId, label, value: apiKey, authMethod: 'api_key', baseUrl,
      });
      if (result.error) throw new Error(result.error as string);
      await get().refreshData();
      set({ modal: null, loading: false });
    } catch (e) {
      set({ error: (e as Error).message, loading: false });
    }
  },

  addSetupToken: async (providerId: string, label: string, token: string) => {
    set({ loading: true, error: null });
    try {
      const result = await sendInternal('addCredential', {
        providerId, label, value: token, authMethod: 'oauth',
      });
      if (result.error) throw new Error(result.error as string);
      await get().refreshData();
      set({ modal: null, loading: false });
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
      set({ modal: null, loading: false });
    } catch (e) {
      set({ error: (e as Error).message, loading: false });
    }
  },

  removeCredential: async (id: string) => {
    await sendInternal('removeCredential', { id });
    await get().refreshData();
  },

  renameCredential: async (id: string, label: string) => {
    set({ error: null });
    const result = await sendInternal('renameCredential', { id, label });
    if (result.error) {
      set({ error: result.error as string });
      return false;
    }
    await get().refreshData();
    return true;
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

  createGroup: async (input) => {
    set({ error: null });
    const result = await sendInternal('createGroup', input);
    if (result.error) {
      set({ error: result.error as string });
      return null;
    }
    await get().refreshData();
    return (result.group as Group).id;
  },

  updateGroup: async (id, patch) => {
    set({ error: null });
    const result = await sendInternal('updateGroup', { id, patch });
    if (result.error) {
      set({ error: result.error as string });
      return false;
    }
    await get().refreshData();
    return true;
  },

  deleteGroup: async (id) => {
    set({ error: null });
    const result = await sendInternal('deleteGroup', { id });
    if (result.error) {
      set({ error: result.error as string });
      return false;
    }
    await get().refreshData();
    return true;
  },

  setAppGroup: async (origin, groupId) => {
    set({ error: null });
    const result = await sendInternal('setAppGroup', { origin, groupId });
    if (result.error) {
      set({ error: result.error as string });
      return false;
    }
    await get().refreshData();
    return true;
  },

  resetWallet: async () => {
    await sendInternal('resetWallet');
    set({
      isInitialized: false,
      isUnlocked: false,
      credentials: [],
      sessions: [],
      requestLog: [],
      pendingApprovals: [],
      trustedSites: [],
      tokenAllowances: [],
      groups: [],
      appGroups: {},
      showRetiredFeaturesNotice: false,
      currentPage: 'setup',
      modal: null,
      error: null,
    });
  },

  refreshData: async () => {
    const [credResult, sessionResult, logResult, approvalResult, trustedResult, allowanceResult, groupsResult] = await Promise.all([
      sendInternal('getCredentials'),
      sendInternal('getSessions'),
      sendInternal('getRequestLog'),
      sendInternal('getPendingApprovals'),
      sendInternal('getTrustedSites'),
      sendInternal('getAllowances'),
      sendInternal('getGroups'),
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
      groups: (groupsResult.groups ?? []) as Group[],
      appGroups: (groupsResult.appGroups ?? {}) as AppGroups,
    });
  },

  clearError: () => set({ error: null }),
}));
