/**
 * A wallet as the login pages see it through the SDK: one origin, at most
 * one session for it, and the connect answers of two extension generations.
 *
 * - 'reuses-any-session': extensions up to 1.1.1. A live session is handed
 *   back whatever the connect asks for, listing only the providers it has
 *   a key for.
 * - 'widens-session': with F081. A session is reused only when it covers
 *   the request; otherwise the user is asked about the old and new
 *   providers together and the session is widened in place. Every
 *   approved provider is listed, unavailable ones included.
 */

import type { ProviderRequirement } from '@byoky/core';
import type { ByokySession } from '@byoky/sdk';

export type WalletKind = 'reuses-any-session' | 'widens-session';

export interface FakeWalletOptions {
  kind: WalletKind;
  /** Providers the wallet holds a key for. */
  keys: string[];
  /** Drops BYOKY_DISCONNECT, so the session stays. */
  ignoresDisconnect?: boolean;
  /** The user's answer to each approval prompt (default: approve). */
  approve?: (providers: string[]) => boolean;
}

interface Session {
  key: string;
  requested: string[];
}

export class FakeWallet {
  session: Session | null = null;
  /** The provider sets the user was asked to approve. */
  prompts: string[][] = [];
  /** The provider ids of every connect. */
  connects: string[][] = [];
  disconnects = 0;
  /** Session key the bridge proxy was started with. */
  bridgeSessionKey: string | null = null;
  private count = 0;

  constructor(private readonly opts: FakeWalletOptions) {}

  async connect(request: { providers?: ProviderRequirement[] }): Promise<ByokySession> {
    const ids = (request.providers ?? []).map((p) => p.id);
    this.connects.push(ids);
    const existing = this.session;
    if (existing && (this.opts.kind === 'reuses-any-session' || ids.every((id) => existing.requested.includes(id)))) {
      return this.answer(existing, this.opts.kind === 'widens-session');
    }
    const asked = existing ? [...new Set([...existing.requested, ...ids])] : ids;
    this.prompts.push(asked);
    if (!(this.opts.approve?.(asked) ?? true)) throw new Error('User cancelled');
    if (existing) {
      existing.requested = asked;
      return this.answer(existing, true);
    }
    this.session = { key: `byk_${++this.count}`, requested: asked };
    // A new session lists every requested provider in both generations.
    return this.answer(this.session, true);
  }

  /** The SDK's Byoky class, as the page's bundle exposes it. */
  byokyClass(): new (opts?: unknown) => { connect(request: { providers?: ProviderRequirement[] }): Promise<ByokySession> } {
    const wallet = this;
    return class {
      connect(request: { providers?: ProviderRequirement[] }) { return wallet.connect(request); }
    };
  }

  /** The extension's startBridgeProxy check: only a live session. */
  startBridge(sessionKey: string): { success: boolean; error?: string } {
    if (this.session?.key !== sessionKey) return { success: false, error: 'Invalid session' };
    this.bridgeSessionKey = sessionKey;
    return { success: true };
  }

  private answer(session: Session, listUnavailable: boolean): ByokySession {
    const providers: ByokySession['providers'] = {};
    for (const id of session.requested) {
      const available = this.opts.keys.includes(id);
      if (available || listUnavailable) providers[id] = { available, authMethod: 'api_key' };
    }
    const { key } = session;
    return {
      sessionKey: key,
      proxyUrl: 'extension-proxy',
      providers,
      // Like the SDK's: posted to the wallet, no answer, handled a moment later.
      disconnect: () => {
        this.disconnects++;
        if (this.opts.ignoresDisconnect) return;
        setTimeout(() => {
          if (this.session?.key === key) this.session = null;
        }, 40);
      },
      isConnected: async () => this.session?.key === key,
    } as unknown as ByokySession;
  }
}
