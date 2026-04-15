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
  type InstalledApp,
  type MarketplaceApp,
  hashPassword,
} from '@byoky/core';

type Page =
  | 'setup'
  | 'unlock'
  | 'dashboard'
  | 'add-credential'
  | 'activity'
  | 'connected-apps'
  | 'usage'
  | 'request-history'
  | 'approval'
  | 'settings'
  | 'gifts'
  | 'create-gift'
  | 'redeem-gift'
  | 'apps'
  | 'app-store'
  | 'app-view';

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
  giftPeerOnline: Record<string, boolean>;
  giftPreferences: Record<string, string>;
  groups: Group[];
  appGroups: AppGroups;
  cloudVaultEnabled: boolean;
  cloudVaultUsername: string | null;
  cloudVaultLastUsername: string | null;
  cloudVaultTokenExpired: boolean;
  cloudVaultPendingCount: number;
  vaultBannerDismissedAt: number | null;
  installedApps: InstalledApp[];
  activeApp: InstalledApp | null;
  currentPage: Page;
  modal: 'add-credential' | 'redeem-gift' | null;
  loading: boolean;
  error: string | null;

  init: () => Promise<void>;
  setup: (password: string) => Promise<void>;
  vaultBootstrapSignup: (username: string, password: string) => Promise<void>;
  vaultBootstrapLogin: (username: string, password: string) => Promise<void>;
  vaultActivate: (username: string) => Promise<void>;
  dismissVaultBanner: () => Promise<void>;
  unlock: (password: string) => Promise<boolean>;
  lock: () => Promise<void>;
  navigate: (page: Page) => void;
  openModal: (modal: 'add-credential' | 'redeem-gift') => void;
  closeModal: () => void;
  addApiKey: (providerId: string, label: string, apiKey: string) => Promise<void>;
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
  createGift: (credentialId: string, providerId: string, label: string, maxTokens: number, expiresInMs: number, relayUrl: string) => Promise<{ giftLink: string; giftId: string } | null>;
  setGiftMarketplaceToken: (giftId: string, token: string) => Promise<void>;
  revokeGift: (giftId: string) => Promise<void>;
  redeemGift: (giftLinkEncoded: string) => Promise<void>;
  removeGiftedCredential: (id: string) => Promise<void>;
  setGiftPreference: (providerId: string, giftId: string | null) => Promise<void>;
  createGroup: (input: { name: string; providerId: string; credentialId?: string; giftId?: string; model?: string }) => Promise<string | null>;
  updateGroup: (id: string, patch: { name?: string; providerId?: string; credentialId?: string | null; giftId?: string | null; model?: string | null }) => Promise<boolean>;
  deleteGroup: (id: string) => Promise<boolean>;
  setAppGroup: (origin: string, groupId: string) => Promise<boolean>;
  installApp: (app: MarketplaceApp) => void;
  uninstallApp: (id: string) => void;
  toggleApp: (id: string) => void;
  setActiveApp: (app: InstalledApp) => void;
  enableCloudVault: (username: string, password: string, isSignup: boolean) => Promise<void>;
  disableCloudVault: () => Promise<void>;
  deleteVaultAccount: () => Promise<void>;
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
  giftPeerOnline: {},
  giftPreferences: {},
  groups: [],
  appGroups: {},
  cloudVaultEnabled: false,
  cloudVaultUsername: null,
  cloudVaultLastUsername: null,
  cloudVaultTokenExpired: false,
  cloudVaultPendingCount: 0,
  vaultBannerDismissedAt: null,
  installedApps: [],
  activeApp: null,
  currentPage: 'unlock',
  modal: null,
  loading: true,
  error: null,

  init: async () => {
    const initResult = await sendInternal('isInitialized');
    const unlockResult = await sendInternal('isUnlocked');
    const initialized = initResult.initialized as boolean;
    const unlocked = unlockResult.unlocked as boolean;

    const bannerResult = await sendInternal('getVaultBannerDismissedAt');
    const bannerDismissedAt = (bannerResult.dismissedAt as number | null) ?? null;

    let page: Page = 'unlock';
    if (!initialized) page = 'setup';
    else if (unlocked) page = 'dashboard';

    set({
      isInitialized: initialized,
      isUnlocked: unlocked,
      currentPage: page,
      vaultBannerDismissedAt: bannerDismissedAt,
      loading: false,
    });

    if (unlocked) {
      await get().refreshData();
      const appsResult = await sendInternal('getInstalledApps');
      if (appsResult.apps) {
        set({ installedApps: appsResult.apps as InstalledApp[] });
      }
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

  vaultBootstrapSignup: async (username: string, password: string) => {
    set({ loading: true, error: null });
    try {
      const hash = await hashPassword(password);
      const setupRes = await sendInternal('setupWallet', { passwordHash: hash });
      if (setupRes.error) throw new Error(setupRes.error as string);

      const unlockRes = await sendInternal('unlock', { password });
      if (!unlockRes.success) throw new Error((unlockRes.error as string) ?? 'Failed to unlock');

      const vaultRes = await sendInternal('cloudVaultSignup', { username, password });
      if (vaultRes.error) {
        set({
          isInitialized: true,
          isUnlocked: true,
          currentPage: 'dashboard',
          loading: false,
          error: `Vault unavailable: ${vaultRes.error as string}. Wallet set up in offline mode — you can activate vault later.`,
        });
        await get().refreshData();
        return;
      }

      await get().refreshData();
      set({ isInitialized: true, isUnlocked: true, currentPage: 'dashboard', loading: false });
    } catch (e) {
      set({ error: (e as Error).message, loading: false });
    }
  },

  vaultBootstrapLogin: async (username: string, password: string) => {
    set({ loading: true, error: null });
    try {
      const hash = await hashPassword(password);
      const setupRes = await sendInternal('setupWallet', { passwordHash: hash });
      if (setupRes.error) throw new Error(setupRes.error as string);

      const unlockRes = await sendInternal('unlock', { password });
      if (!unlockRes.success) throw new Error((unlockRes.error as string) ?? 'Failed to unlock');

      const vaultRes = await sendInternal('cloudVaultLogin', { username, password });
      if (vaultRes.error) throw new Error(vaultRes.error as string);

      await get().refreshData();
      set({ isInitialized: true, isUnlocked: true, currentPage: 'dashboard', loading: false });
    } catch (e) {
      set({ error: (e as Error).message, loading: false });
    }
  },

  vaultActivate: async (username: string) => {
    set({ loading: true, error: null });
    try {
      const res = await sendInternal('cloudVaultActivate', { username });
      if (res.error) throw new Error(res.error as string);
      await get().refreshData();
      set({ loading: false });
    } catch (e) {
      set({ error: (e as Error).message, loading: false });
    }
  },

  dismissVaultBanner: async () => {
    const now = Date.now();
    await sendInternal('setVaultBannerDismissedAt', { dismissedAt: now });
    set({ vaultBannerDismissedAt: now });
  },

  unlock: async (password: string) => {
    set({ loading: true, error: null });
    const unlockResult = await sendInternal('unlock', { password });
    if (unlockResult.success) {
      set({ isUnlocked: true, currentPage: 'dashboard', loading: false });
      await get().refreshData();
      const appsResult = await sendInternal('getInstalledApps');
      if (appsResult.apps) {
        set({ installedApps: appsResult.apps as InstalledApp[] });
      }
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
      giftPeerOnline: {},
      giftPreferences: {},
      groups: [],
      appGroups: {},
      installedApps: [],
      activeApp: null,
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
    // The credential and gift-redemption flows are popup-style overlays now;
    // route legacy navigate() calls there to the modal so the underlying page
    // stays visible.
    if (page === 'add-credential' || page === 'redeem-gift') {
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

  addApiKey: async (providerId: string, label: string, apiKey: string) => {
    set({ loading: true, error: null });
    try {
      const result = await sendInternal('addCredential', {
        providerId, label, value: apiKey, authMethod: 'api_key',
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

  createGift: async (credentialId, providerId, label, maxTokens, expiresInMs, relayUrl) => {
    set({ error: null });
    try {
      const result = await sendInternal('createGift', {
        credentialId, providerId, label, maxTokens, expiresInMs, relayUrl,
      });
      if (result.error) throw new Error(result.error as string);
      await get().refreshData();
      return { giftLink: result.giftLink as string, giftId: result.giftId as string };
    } catch (e) {
      set({ error: (e as Error).message });
      return null;
    }
  },

  setGiftMarketplaceToken: async (giftId, token) => {
    await sendInternal('setGiftMarketplaceToken', { giftId, token });
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
      set({ modal: null, loading: false });
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

  installApp: async (app: MarketplaceApp) => {
    // Validate URL scheme before installing
    try {
      const parsed = new URL(app.url);
      if (parsed.protocol !== 'https:') {
        set({ error: 'App URL must use HTTPS' });
        return;
      }
    } catch {
      set({ error: 'Invalid app URL' });
      return;
    }

    // Confirm provider access with the user before granting trust
    const providerList = app.providers.join(', ');
    const confirmed = confirm(
      `Install "${app.name}"?\n\nThis app will be trusted to access: ${providerList}`,
    );
    if (!confirmed) return;

    const installed: InstalledApp = {
      id: app.id,
      slug: app.slug,
      name: app.name,
      url: app.url,
      icon: app.icon,
      description: app.description,
      category: app.category,
      providers: app.providers,
      author: app.author,
      verified: app.verified,
      installedAt: Date.now(),
      enabled: true,
    };
    const apps = [...get().installedApps, installed];
    set({ installedApps: apps });
    await sendInternal('setInstalledApps', { apps });
    const origin = new URL(app.url).origin;
    await sendInternal('addTrustedSite', { origin, allowedProviders: app.providers });
    await get().refreshData();
  },

  uninstallApp: async (id: string) => {
    const app = get().installedApps.find((a) => a.id === id);
    const apps = get().installedApps.filter((a) => a.id !== id);
    set({ installedApps: apps });
    await sendInternal('setInstalledApps', { apps });
    if (app) {
      const origin = new URL(app.url).origin;
      await sendInternal('removeTrustedSite', { origin });
      await get().refreshData();
    }
  },

  toggleApp: (id: string) => {
    const apps = get().installedApps.map((a) =>
      a.id === id ? { ...a, enabled: !a.enabled } : a,
    );
    set({ installedApps: apps });
    sendInternal('setInstalledApps', { apps });
  },

  setActiveApp: (app: InstalledApp) => {
    set({ activeApp: app });
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

  deleteVaultAccount: async () => {
    set({ loading: true, error: null });
    try {
      const res = await sendInternal('cloudVaultDeleteAccount');
      if (res.error) throw new Error(res.error as string);
      await get().resetWallet();
      set({ loading: false });
    } catch (e) {
      set({ error: (e as Error).message, loading: false });
    }
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
      giftPeerOnline: {},
      groups: [],
      appGroups: {},
      cloudVaultEnabled: false,
      cloudVaultUsername: null,
      cloudVaultLastUsername: null,
      cloudVaultTokenExpired: false,
      cloudVaultPendingCount: 0,
      installedApps: [],
      activeApp: null,
      currentPage: 'setup',
      modal: null,
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
      cloudVaultLastUsername: (vaultResult.lastUsername as string | null) ?? null,
      cloudVaultTokenExpired: vaultResult.tokenExpired as boolean ?? false,
      cloudVaultPendingCount: vaultResult.pendingCount as number ?? 0,
    });

    // Probe each received gift's relay to refresh the online dot on the
    // Dashboard. Runs after the main refresh so credentials paint first,
    // then online status fills in when the probes complete.
    const giftedCount = ((giftedResult.giftedCredentials ?? []) as GiftedCredential[]).length;
    if (giftedCount > 0) {
      sendInternal('probeGiftPeers').then((probeResult) => {
        set({ giftPeerOnline: (probeResult.online as Record<string, boolean>) ?? {} });
      }).catch(() => { /* non-blocking */ });
    } else {
      set({ giftPeerOnline: {} });
    }
  },

  clearError: () => set({ error: null }),
}));
