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
import { lockedUntilFrom } from './hooks/useLockoutCountdown';
import { describeOrigin } from './utils/origin';

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
  /** Lifetime tokens per app origin and provider, which allowances are checked against. */
  tokenUsage: Record<string, Record<string, number>>;
  groups: Group[];
  appGroups: AppGroups;
  showRetiredFeaturesNotice: boolean;
  /** The trust state failed its integrity check and was reset (see TrustResetNotice). */
  showTrustResetNotice: boolean;
  currentPage: Page;
  modal: 'add-credential' | null;
  /** Only while the popup first asks the background what state the wallet is in. */
  loading: boolean;
  /** A form is waiting on the background (unlock, setup, adding a key); the page stays up. */
  submitting: boolean;
  error: string | null;
  /** When the password lockout ends (epoch ms), while one is running. */
  lockedUntil: number | null;

  init: () => Promise<void>;
  setup: (password: string) => Promise<void>;
  dismissRetiredFeaturesNotice: () => Promise<void>;
  markRetiredFeaturesNoticeSeen: () => Promise<void>;
  dismissTrustResetNotice: () => Promise<void>;
  markTrustResetNoticeSeen: () => Promise<void>;
  unlock: (password: string) => Promise<boolean>;
  lock: () => Promise<void>;
  /** Record a lockout the background reported (unlock or export re-auth); null ends it. */
  setLockedUntil: (lockedUntil: number | null) => void;
  syncLockState: () => Promise<boolean>;
  navigate: (page: Page) => void;
  openModal: (modal: 'add-credential') => void;
  closeModal: () => void;
  addApiKey: (providerId: string, label: string, apiKey: string, baseUrl?: string) => Promise<void>;
  addSetupToken: (providerId: string, label: string, token: string) => Promise<void>;
  removeCredential: (id: string) => Promise<void>;
  renameCredential: (id: string, label: string) => Promise<boolean>;
  revokeSession: (sessionId: string) => Promise<void>;
  approveConnect: (approvalId: string, trust: boolean) => Promise<void>;
  rejectConnect: (approvalId: string) => Promise<void>;
  removeTrustedSite: (origin: string) => Promise<void>;
  setAllowance: (allowance: TokenAllowance) => Promise<void>;
  removeAllowance: (origin: string) => Promise<void>;
  resetAppUsage: (origin: string) => Promise<void>;
  createGroup: (input: { name: string; providerId: string; credentialId?: string; model?: string }) => Promise<string | null>;
  updateGroup: (id: string, patch: { name?: string; providerId?: string; credentialId?: string | null; model?: string | null }) => Promise<boolean>;
  deleteGroup: (id: string) => Promise<boolean>;
  setAppGroup: (origin: string, groupId: string) => Promise<boolean>;
  resetWallet: () => Promise<void>;
  refreshData: () => Promise<void>;
  /** Only the approval queue, which the background keeps (and reports) while locked. */
  refreshPending: () => Promise<void>;
  clearError: () => void;
}

// What the popup drops when the wallet locks.
const LOCKED_STATE = {
  isUnlocked: false,
  credentials: [],
  requestLog: [],
  pendingApprovals: [],
  groups: [],
  appGroups: {},
  currentPage: 'unlock',
  modal: null,
} satisfies Partial<WalletState>;

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
  tokenUsage: {},
  groups: [],
  appGroups: {},
  showRetiredFeaturesNotice: false,
  showTrustResetNotice: false,
  currentPage: 'unlock',
  modal: null,
  loading: true,
  submitting: false,
  error: null,
  lockedUntil: null,

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
    } else if (initialized) {
      // Requests wait out a locked wallet; the unlock screen says so.
      await get().refreshPending();
    }
  },

  setup: async (password: string) => {
    set({ submitting: true, error: null });
    try {
      const hash = await hashPassword(password);
      const created = await sendInternal('setupWallet', { passwordHash: hash });
      if (created.error === 'Wallet already initialized') {
        // Another wallet view finished setup first, with its own password.
        // Unlocking with this one would only count as a wrong guess.
        set({
          isInitialized: true,
          currentPage: 'unlock',
          error: 'This wallet was already set up in another window. Unlock it with the password chosen there.',
        });
        return;
      }
      if (created.error) {
        set({ error: created.error as string });
        return;
      }
      const setupResult = await sendInternal('unlock', { password });
      if (setupResult.success) {
        set({ isInitialized: true, isUnlocked: true, currentPage: 'dashboard' });
      } else {
        set({
          isInitialized: true,
          currentPage: 'unlock',
          error: (setupResult.error as string | undefined) ?? 'Your wallet was created but could not be unlocked. Enter your password to unlock it.',
        });
      }
    } catch (e) {
      set({ error: (e as Error).message });
    } finally {
      set({ submitting: false });
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

  dismissTrustResetNotice: async () => {
    await sendInternal('dismissTrustResetNotice');
    set({ showTrustResetNotice: false });
  },

  // Same as markRetiredFeaturesNoticeSeen: shown once, then only this session.
  markTrustResetNoticeSeen: async () => {
    await sendInternal('dismissTrustResetNotice');
  },

  unlock: async (password: string) => {
    set({ submitting: true, error: null });
    try {
      const unlockResult = await sendInternal('unlock', { password });
      if (unlockResult.success) {
        set({ isUnlocked: true, currentPage: 'dashboard', submitting: false, lockedUntil: null });
        await get().refreshData();
        // Requests that waited for the unlock (trusted sites are approved on
        // their own) go straight to review.
        if (get().pendingApprovals.length > 0) set({ currentPage: 'approval' });
        return true;
      }
      // During the lockout the background refuses even the right password and
      // says for how long; "Incorrect password" would push toward a reset.
      // The failure that starts the lockout reports it too, and the last two
      // tries before it say so.
      const lockedUntil = lockedUntilFrom(unlockResult);
      const attemptsLeft = unlockResult.attemptsLeft;
      let error = (unlockResult.error as string | undefined) ?? 'Incorrect password';
      if (!lockedUntil && !unlockResult.error && (attemptsLeft === 1 || attemptsLeft === 2)) {
        error = `Incorrect password. ${attemptsLeft} ${attemptsLeft === 1 ? 'try' : 'tries'} left before a short lockout.`;
      }
      set({ error, lockedUntil });
      return false;
    } catch (e) {
      set({ error: (e as Error).message });
      return false;
    } finally {
      set({ submitting: false });
    }
  },

  lock: async () => {
    await sendInternal('lock');
    set(LOCKED_STATE);
    await get().refreshPending();
  },

  setLockedUntil: (lockedUntil) => set({ lockedUntil }),

  // The background also locks on its own (auto-lock after idle) and only
  // announces it as a session change, so the popup has to ask.
  syncLockState: async () => {
    const { unlocked } = await sendInternal('isUnlocked');
    if (!unlocked && get().isUnlocked) {
      set({ ...LOCKED_STATE, error: null });
    }
    return unlocked === true;
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
    set({ submitting: true, error: null });
    try {
      const result = await sendInternal('addCredential', {
        providerId, label, value: apiKey, authMethod: 'api_key', baseUrl,
      });
      if (result.error) throw new Error(result.error as string);
      await get().refreshData();
      set({ modal: null });
    } catch (e) {
      set({ error: (e as Error).message });
    } finally {
      set({ submitting: false });
    }
  },

  addSetupToken: async (providerId: string, label: string, token: string) => {
    set({ submitting: true, error: null });
    try {
      const result = await sendInternal('addCredential', {
        providerId, label, value: token, authMethod: 'oauth',
      });
      if (result.error) throw new Error(result.error as string);
      await get().refreshData();
      set({ modal: null });
    } catch (e) {
      set({ error: (e as Error).message });
    } finally {
      set({ submitting: false });
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

  // Both leave the approval page through refreshData once the queue is
  // empty, unless there is an error to read first.
  approveConnect: async (approvalId: string, trust: boolean) => {
    set({ error: null });
    const origin = get().pendingApprovals.find((a) => a.id === approvalId)?.appOrigin;
    const result = await sendInternal('approveConnect', { approvalId, trust });
    if (!result?.success) {
      // The background drops a request after two minutes, and the app has
      // already been told it timed out: approving it now connects nothing.
      set({
        error: result?.error === 'Approval not found'
          ? `The request from ${origin ? describeOrigin(origin).label : 'this app'} expired. Ask the app to connect again.`
          : ((result?.error as string | undefined) ?? 'Could not approve the request'),
      });
    }
    await get().refreshData();
  },

  rejectConnect: async (approvalId: string) => {
    set({ error: null });
    const result = await sendInternal('rejectConnect', { approvalId });
    // A request that is already gone (timed out, or answered in another
    // wallet view) needs no rejecting.
    if (!result?.success && result?.error !== 'Approval not found') {
      set({ error: (result?.error as string | undefined) ?? 'Could not reject the request' });
    }
    await get().refreshData();
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

  resetAppUsage: async (origin: string) => {
    await sendInternal('resetAppUsage', { origin });
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
  tokenUsage: {},
      groups: [],
      appGroups: {},
      showRetiredFeaturesNotice: false,
      showTrustResetNotice: false,
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

    const pendingApprovals = (approvalResult.approvals ?? []) as PendingApproval[];
    // The queue can empty without this view acting on it: approved in another
    // wallet view, timed out, or auto-approved for a trusted site. The
    // approval page has no nav, so don't leave it showing an empty queue,
    // unless it is showing an error the user should read first.
    const leaveApproval = get().currentPage === 'approval' && pendingApprovals.length === 0 && !get().error;

    set({
      ...(leaveApproval ? { currentPage: 'dashboard' as const } : {}),
      credentials: metas,
      sessions: (sessionResult.sessions ?? []) as Session[],
      requestLog: (logResult.log ?? []) as RequestLogEntry[],
      pendingApprovals,
      trustedSites: (trustedResult.sites ?? []) as TrustedSite[],
      // The flag is raised when the background drops the trust state, which
      // checking it for this very call may have done. Once seen, it is
      // cleared in storage, so later refreshes leave the notice as it is.
      showTrustResetNotice: get().showTrustResetNotice || trustedResult.trustReset === true,
      tokenAllowances: (allowanceResult.allowances ?? []) as TokenAllowance[],
      tokenUsage: (allowanceResult.usage ?? {}) as Record<string, Record<string, number>>,
      groups: (groupsResult.groups ?? []) as Group[],
      appGroups: (groupsResult.appGroups ?? {}) as AppGroups,
    });
  },

  refreshPending: async () => {
    const result = await sendInternal('getPendingApprovals');
    set({ pendingApprovals: (result?.approvals ?? []) as PendingApproval[] });
  },

  clearError: () => set({ error: null }),
}));
