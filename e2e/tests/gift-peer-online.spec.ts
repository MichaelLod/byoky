import { test, expect, type Wallet } from '../fixtures';
import type { Page } from '@playwright/test';

/**
 * Regression coverage for the extension-sender → recipient peer-online dot.
 *
 * The existing COD-13 spec (cross-device-ios-sender.spec.ts) covers the
 * opposite direction (iOS sender, desktop recipient). This spec is the
 * mirror: extension creates a gift, a second extension redeems it, the
 * recipient's peer-online probe must report sender-online. The field bug
 * that triggered this coverage: a gift created by the extension showed
 * as offline on the iOS wallet even while the extension popup was open.
 *
 * Fully desktop — no simulator orchestration needed, because the recipient
 * probe protocol is identical on iOS / Android / extension (auth as
 * `role: 'recipient'` and read `peerOnline` from `relay:auth:result`).
 * Anything broken here would also break the mobile side.
 */

const PASSWORD = 'PeerOnline1234!';

async function setupWallet(w: Wallet) {
  await w.popup.bringToFront();
  await expect(w.popup.locator('button:has-text("Continue with your API keys")')).toBeVisible({ timeout: 15_000 });
  await w.popup.click('button:has-text("Continue with your API keys")');
  await w.popup.waitForSelector('#password', { timeout: 15_000 });
  await w.popup.fill('#password', PASSWORD);
  await w.popup.click('button:has-text("Continue")');
  await w.popup.waitForSelector('#confirm', { timeout: 10_000 });
  await w.popup.fill('#confirm', PASSWORD);
  await w.popup.click('button:has-text("Create wallet")');
  await expect(w.popup.locator('text=No API keys, tokens, or gifts yet')).toBeVisible({ timeout: 30_000 });
}

async function addCredential(w: Wallet, providerId: string, label: string, apiKey: string) {
  await w.popup.bringToFront();
  await w.popup.click('button[title="Wallet"]');
  await w.popup.click('button:has-text("Add credential")');
  await w.popup.waitForSelector('#provider');
  await w.popup.selectOption('#provider', providerId);
  await w.popup.fill('#label', label);
  await w.popup.fill('#apiKey', apiKey);
  await w.popup.click('button:has-text("Save")');
  await expect(w.popup.locator(`text=${label}`).first()).toBeVisible({ timeout: 15_000 });
}

declare const chrome: { runtime: { sendMessage: (m: unknown) => Promise<unknown> } };
async function sendInternalFromPopup<T>(popup: Page, action: string, payload?: Record<string, unknown>): Promise<T> {
  return popup.evaluate(
    async ({ action: a, payload: p }) => {
      return (await chrome.runtime.sendMessage({ type: 'BYOKY_INTERNAL', action: a, payload: p })) as T;
    },
    { action, payload },
  );
}

async function mintGift(w: Wallet, providerId: string, maxTokens = 500): Promise<string> {
  await w.popup.bringToFront();
  await w.popup.click('button[title="Gifts"]');
  await w.popup.click('button:has-text("Create Gift")');
  await w.popup.waitForSelector('#gift-credential', { timeout: 5_000 });

  const { credentials } = await sendInternalFromPopup<{
    credentials: Array<{ id: string; providerId: string }>;
  }>(w.popup, 'getCredentials');
  const target = credentials.find((c) => c.providerId === providerId);
  expect(target, `sender needs ${providerId} credential`).toBeTruthy();
  await w.popup.selectOption('#gift-credential', target!.id);

  const budget = w.popup.locator('input[type="number"]');
  await budget.fill(String(maxTokens));
  await w.popup.click('button:has-text("Create Gift")');
  await expect(w.popup.locator('text=Gift Created')).toBeVisible({ timeout: 15_000 });
  const link = await w.popup.locator('.gift-link-text').innerText();
  expect(link).toMatch(/^https:\/\/byoky\.com\/gift#/);
  await w.popup.click('button:has-text("Done")');
  return link;
}

async function redeemGift(w: Wallet, link: string) {
  await w.popup.bringToFront();
  await w.popup.click('button[title="Gifts"]');
  await w.popup.click('button:has-text("Redeem Gift")');
  await w.popup.waitForSelector('#gift-link', { timeout: 5_000 });
  await w.popup.fill('#gift-link', link);
  await expect(w.popup.locator('.gift-preview')).toBeVisible({ timeout: 5_000 });
  await w.popup.click('button:has-text("Accept Gift")');
  await w.popup.click('button[title="Wallet"]');
  await expect(w.popup.locator('.gift-card')).toBeVisible({ timeout: 10_000 });
}

async function probePeerOnline(w: Wallet, giftId: string): Promise<boolean | undefined> {
  const { online } = await sendInternalFromPopup<{ online: Record<string, boolean> }>(
    w.popup, 'probeGiftPeers',
  );
  return online[giftId];
}

test.describe.configure({ mode: 'serial' });

test.describe('Gift peer-online: extension sender → extension recipient', () => {
  let giftLink = '';
  let giftId = '';

  test('walletA mints gift, walletB redeems', async ({ walletA, walletB, apiKeys }) => {
    await setupWallet(walletA);
    await addCredential(walletA, 'openai', 'PO OpenAI', apiKeys.openai);
    giftLink = await mintGift(walletA, 'openai');

    const { gifts } = await sendInternalFromPopup<{
      gifts: Array<{ id: string; active: boolean; createdAt: number }>;
    }>(walletA.popup, 'getGifts');
    const active = gifts.filter((g) => g.active).sort((a, b) => b.createdAt - a.createdAt);
    expect(active[0], 'walletA should have an active sent gift').toBeTruthy();
    giftId = active[0].id;

    await setupWallet(walletB);
    await redeemGift(walletB, giftLink);
  });

  // The regression: probe must report sender online immediately after mint.
  // Before the coverage existed, a silent failure in connectGiftRelay or a
  // roomId/authToken mismatch would ship unnoticed because desktop→desktop
  // request flows can still succeed via vault fallback even when the dot
  // is wrong.
  test('recipient probe reports sender online after mint', async ({ walletB }) => {
    // Sender's WS is opened via connectGiftRelay on mint; give the relay
    // handshake a beat to settle (room created + sender registered).
    await walletB.popup.waitForTimeout(3000);

    const online = await probePeerOnline(walletB, giftId);
    expect(
      online,
      'sender must be online immediately after the extension creates a gift — ' +
        'red dot here means connectGiftRelay failed silently, the WS is in a bad state, ' +
        'or roomId/authToken diverged between sender and recipient',
    ).toBe(true);

    // Also assert the Dashboard dot renders as success — catches regressions
    // in the UI wiring between the probe map and the rendered class.
    await walletB.popup.bringToFront();
    await walletB.popup.click('button[title="Wallet"]');
    const dot = walletB.popup.locator('.gift-card .status-dot').first();
    await expect(dot).toHaveClass(/success/, { timeout: 10_000 });
  });

  // Negative control: if the sender disconnects its relay WS, the recipient
  // must see offline within a few seconds. revokeGift is the graceful way
  // to close the sender WS without tearing down the whole extension context.
  test('recipient probe reports offline after sender revokes', async ({ walletA, walletB }) => {
    await sendInternalFromPopup(walletA.popup, 'revokeGift', { giftId });
    await walletB.popup.waitForTimeout(2000);

    const online = await probePeerOnline(walletB, giftId);
    expect(
      online,
      'sender should report offline right after revoke (WS closed by disconnectGiftRelay)',
    ).toBe(false);
  });
});
