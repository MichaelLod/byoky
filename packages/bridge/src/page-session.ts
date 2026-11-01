/**
 * The wallet connect of the login pages that `byoky-bridge connect` and the
 * OpenClaw plugin serve. Runs in the browser: both pages' auth-sdk.js
 * bundles export it next to Byoky.
 *
 * The pages' origins are fixed (so caps and routing groups stay with the
 * app), which means the wallet can still hold a session for the page from
 * an earlier login that asked for other providers. Extensions up to 1.1.1
 * hand that session back whatever the new login asks for, and their answer
 * leaves out every provider the session has no key for. Newer extensions
 * ask the user about the wider set and list every requested provider,
 * available or not. A requested provider missing from the answer therefore
 * means an older wallet reused a session that does not cover this login.
 */

import type { ProviderRequirement } from '@byoky/core';
import type { Byoky, ByokySession } from '@byoky/sdk';

export type PageConnectRequest = NonNullable<Parameters<Byoky['connect']>[0]> & {
  providers: ProviderRequirement[];
};

export interface PageConnectOptions {
  /** Told which providers the old session lacked, before the wallet is asked again. */
  onRetry?: (missing: string[]) => void;
  /** How long to wait for the wallet to drop the old session. */
  dropTimeoutMs?: number;
}

/**
 * `byoky.connect(request)` that ends with a session listing every
 * requested provider. When an older wallet hands back a session without
 * some of them, that session is dropped and the wallet asked again for the
 * requested providers plus the old session's, so the user approves the
 * whole set and the bridge keeps serving what it served before (newer
 * wallets widen the session in place the same way).
 */
export async function connectCovering(
  byoky: Pick<Byoky, 'connect'>,
  request: PageConnectRequest,
  opts: PageConnectOptions = {},
): Promise<ByokySession> {
  const first = await byoky.connect(request);
  const missing = missingProviders(first, request.providers);
  if (missing.length === 0) return first;

  opts.onRetry?.(missing);
  const wanted = new Set(request.providers.map((p) => p.id));
  const earlier = Object.keys(first.providers ?? {})
    .filter((id) => !wanted.has(id))
    .map((id): ProviderRequirement => ({ id, required: false }));
  first.disconnect();
  await waitUntilDropped(first, opts.dropTimeoutMs ?? 3000);

  const second = await byoky.connect({ ...request, providers: [...request.providers, ...earlier] });
  if (second.sessionKey === first.sessionKey && missingProviders(second, request.providers).length > 0) {
    const page = typeof location === 'undefined' ? 'this page' : location.origin;
    throw new Error(
      `Your Byoky wallet kept its earlier session for ${page}, which lacks ${missing.join(', ')}. ` +
        'Disconnect it in the wallet and try again.',
    );
  }
  return second;
}

function missingProviders(session: ByokySession, providers: ProviderRequirement[]): string[] {
  const listed = session.providers ?? {};
  return providers
    .map((p) => p.id)
    .filter((id) => !Object.prototype.hasOwnProperty.call(listed, id));
}

/** disconnect() gets no answer, so ask until the wallet no longer knows the session. */
async function waitUntilDropped(session: ByokySession, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const left = deadline - Date.now();
    if (left <= 0) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const connected = await Promise.race([
      session.isConnected().catch(() => false),
      new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(true), left); }),
    ]);
    clearTimeout(timer);
    if (!connected) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
