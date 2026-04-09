import { create } from 'zustand';
import {
  type AuthMethod,
  type CredentialMeta,
  type Session,
  type RequestLogEntry,
  type PendingApproval,
  type TrustedSite,
  type TokenAllowance,
  type Gift,
  type GiftedCredential,
  type Group,
  type AppGroups,
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
  | 'settings'
  | 'gifts'
  | 'create-gift'
  | 'redeem-gift';

interface WalletState {
  isInitialized: boolean;
  isUnlocked: boolean;
  credentials: CredentialMeta[];
  sessions: Session[];
  requestLog: RequestLogEntry[];
  pendingApprovals: PendingApproval[];
  trustedSites: TrustedSite[];
  tokenAllowances: TokenAllowance[];
  gifts: Gift[];
  giftedCredentials: GiftedCredential[];
  giftPreferences: Record<string, string>;
  groups: Group[];
  appGroups: AppGroups;
  cloudVaultEnabled: boolean;
  cloudVaultUsername: string | null;
  cloudVaultTokenExpired: boolean;
  cloudVaultPendingCount: number;
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
  createGift: (credentialId: string, providerId: string, label: string, maxTokens: number, expiresInMs: number, relayUrl: string) => Promise<string | null>;
  revokeGift: (giftId: string) => Promise<void>;
  redeemGift: (giftLinkEncoded: string) => Promise<void>;
  removeGiftedCredential: (id: string) => Promise<void>;
  setGiftPreference: (providerId: string, giftId: string | null) => Promise<void>;
  createGroup: (input: { name: string; providerId: string; credentialId?: string; model?: string }) => Promise<string | null>;
  updateGroup: (id: string, patch: { name?: string; providerId?: string; credentialId?: string | null; model?: string | null }) => Promise<boolean>;
  deleteGroup: (id: string) => Promise<boolean>;
  setAppGroup: (origin: string, groupId: string) => Promise<boolean>;
  enableCloudVault: (username: string, password: string, isSignup: boolean) => Promise<void>;
  disableCloudVault: () => Promise<void>;
  reloginCloudVault: (password: string) => Promise<void>;
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
  gifts: [],
  giftedCredentials: [],
  giftPreferences: {},
  groups: [],
  appGroups: {},
  cloudVaultEnabled: false,
  cloudVaultUsername: null,
  cloudVaultTokenExpired: false,
  cloudVaultPendingCount: 0,
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
      await sendInternal('setupWallet', { passwordHash: hash });
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
      gifts: [],
      giftedCredentials: [],
      giftPreferences: {},
      groups: [],
      appGroups: {},
      currentPage: 'unlock',
    });
  },

  navigate: (page: Page) => {
    if (!get().isUnlocked && page !== 'setup' && page !== 'unlock') {
      set({ currentPage: 'unlock', error: null });
      return;
    }
    set({ currentPage: page, error: null });
  },

  addApiKey: async (providerId: string, label: string, apiKey: string) => {
    set({ loading: true, error: null });
    try {
      const result = await sendInternal('addCredential', {
        providerId, label, value: apiKey, authMethod: 'api_key',
      });
      if (result.error) throw new Error(result.error as string);
      await get().refreshData();
      set({ currentPage: 'dashboard', loading: false });
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
    await sendInternal('removeCredential', { id });
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

  createGift: async (credentialId, providerId, label, maxTokens, expiresInMs, relayUrl) => {
    set({ error: null });
    try {
      const result = await sendInternal('createGift', {
        credentialId, providerId, label, maxTokens, expiresInMs, relayUrl,
      });
      if (result.error) throw new Error(result.error as string);
      await get().refreshData();
      return result.giftLink as string;
    } catch (e) {
      set({ error: (e as Error).message });
      return null;
    }
  },

  revokeGift: async (giftId: string) => {
    await sendInternal('revokeGift', { giftId });
    await get().refreshData();
  },

  redeemGift: async (giftLinkEncoded: string) => {
    set({ loading: true, error: null });
    try {
      const result = await sendInternal('redeemGift', { giftLinkEncoded });
      if (result.error) throw new Error(result.error as string);
      await get().refreshData();
      set({ currentPage: 'gifts', loading: false });
    } catch (e) {
      set({ error: (e as Error).message, loading: false });
    }
  },

  removeGiftedCredential: async (id: string) => {
    await sendInternal('removeGiftedCredential', { id });
    await get().refreshData();
  },

  setGiftPreference: async (providerId: string, giftId: string | null) => {
    await sendInternal('setGiftPreference', { providerId, giftId });
    const result = await sendInternal('getGiftPreferences');
    set({ giftPreferences: (result.preferences as Record<string, string>) ?? {} });
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

  enableCloudVault: async (username: string, password: string, isSignup: boolean) => {
    set({ loading: true, error: null });
    try {
      const action = isSignup ? 'cloudVaultSignup' : 'cloudVaultLogin';
      const result = await sendInternal(action, { username, password });
      if (result.error) throw new Error(result.error as string);
      await get().refreshData();
      set({ loading: false });
    } catch (e) {
      set({ error: (e as Error).message, loading: false });
    }
  },

  disableCloudVault: async () => {
    await sendInternal('cloudVaultDisable');
    set({ cloudVaultEnabled: false, cloudVaultUsername: null, cloudVaultTokenExpired: false, cloudVaultPendingCount: 0 });
  },

  reloginCloudVault: async (password: string) => {
    set({ loading: true, error: null });
    try {
      const result = await sendInternal('cloudVaultRelogin', { password });
      if (result.error) throw new Error(result.error as string);
      await get().refreshData();
      set({ loading: false });
    } catch (e) {
      set({ error: (e as Error).message, loading: false });
    }
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
      gifts: [],
      giftedCredentials: [],
      groups: [],
      appGroups: {},
      cloudVaultEnabled: false,
      cloudVaultUsername: null,
      cloudVaultTokenExpired: false,
      cloudVaultPendingCount: 0,
      currentPage: 'setup',
      error: null,
    });
  },

  refreshData: async () => {
    const [credResult, sessionResult, logResult, approvalResult, trustedResult, allowanceResult, giftResult, giftedResult, giftPrefResult, groupsResult, vaultResult] = await Promise.all([
      sendInternal('getCredentials'),
      sendInternal('getSessions'),
      sendInternal('getRequestLog'),
      sendInternal('getPendingApprovals'),
      sendInternal('getTrustedSites'),
      sendInternal('getAllowances'),
      sendInternal('getGifts'),
      sendInternal('getGiftedCredentials'),
      sendInternal('getGiftPreferences'),
      sendInternal('getGroups'),
      sendInternal('cloudVaultStatus'),
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
      gifts: (giftResult.gifts ?? []) as Gift[],
      giftedCredentials: (giftedResult.giftedCredentials ?? []) as GiftedCredential[],
      giftPreferences: (giftPrefResult.preferences as Record<string, string>) ?? {},
      groups: (groupsResult.groups ?? []) as Group[],
      appGroups: (groupsResult.appGroups ?? {}) as AppGroups,
      cloudVaultEnabled: vaultResult.enabled as boolean ?? false,
      cloudVaultUsername: vaultResult.username as string ?? null,
      cloudVaultTokenExpired: vaultResult.tokenExpired as boolean ?? false,
      cloudVaultPendingCount: vaultResult.pendingCount as number ?? 0,
    });
  },

  clearError: () => set({ error: null }),
}));
