import { test, expect, type Wallet } from '../fixtures';
import fs from 'fs';
import path from 'path';

/**
 * Desktop-recipient half of the iOS-sender cross-device gift flow.
 *
 * This spec is **orchestrated** — it doesn't launch the iOS simulator or
 * the XCUITest itself. The runner script (scripts/run-cross-device-ios.sh)
 * runs ByokyCrossDeviceTests first, which drops the generated gift link to
 * disk, then runs this spec which redeems it from a desktop extension
 * wallet and probes the sender.
 *
 * Today this spec is expected to FAIL at the online probe: iOS has no
 * sender-side relay code (see Linear COD-13). The failure is the
 * point — it's the regression test that tracks the bug. Once COD-13
 * is fixed the test will start passing and we flip the `.fixme` off.
 */

const GIFT_LINK_PATH =
  process.env.BYOKY_GIFT_LINK_IN ?? '/tmp/byoky-ios-gift-link.txt';

function readGiftLink(): string {
  if (!fs.existsSync(GIFT_LINK_PATH)) {
    throw new Error(
      `Gift link file missing at ${GIFT_LINK_PATH} — run the iOS XCUITest first (ByokyCrossDeviceTests.testIOSSenderCreatesGift).`,
    );
  }
  const raw = fs.readFileSync(GIFT_LINK_PATH, 'utf-8').trim();
  if (!raw) throw new Error(`Gift link file is empty: ${GIFT_LINK_PATH}`);
  return raw;
}

async function setupWallet(w: Wallet, password: string) {
  await w.popup.bringToFront();
  // Unified Setup lands in vault mode; click the BYOK toggle to go offline.
  await expect(w.popup.locator('button:has-text("Got API keys?")')).toBeVisible({ timeout: 15_000 });
  await w.popup.click('button:has-text("Got API keys?")');
  await w.popup.waitForSelector('#password', { timeout: 15_000 });
  await w.popup.fill('#password', password);
  await w.popup.click('button:has-text("Continue")');
  await w.popup.waitForSelector('#confirm', { timeout: 10_000 });
  await w.popup.fill('#confirm', password);
  await w.popup.click('button:has-text("Create wallet")');
  await expect(w.popup.locator('text=No API keys, tokens, or gifts yet')).toBeVisible({ timeout: 30_000 });
}

test.describe.configure({ mode: 'serial' });

test.describe('Cross-device: iOS-sender → desktop-recipient', () => {
  let giftLink = '';

  test('read gift link from iOS XCUITest output', async () => {
    giftLink = readGiftLink();
    console.log(`[cross-device] picked up gift link: ${giftLink.slice(0, 60)}…`);
    expect(giftLink).toMatch(/^(https:\/\/byoky\.com\/gift|byoky:\/\/gift)/);
  });

  test('desktop wallet B — create wallet offline', async ({ walletB }) => {
    await setupWallet(walletB, 'DesktopRecip1234!');
  });

  test('desktop wallet B — redeem the iOS-created gift link', async ({ walletB }) => {
    await walletB.popup.bringToFront();
    await walletB.popup.click('button[title="Gifts"]');
    await walletB.popup.click('button:has-text("Redeem Gift")');
    await walletB.popup.waitForSelector('#gift-link', { timeout: 5_000 });
    await walletB.popup.fill('#gift-link', giftLink);
    await expect(walletB.popup.locator('.gift-preview')).toBeVisible({ timeout: 5_000 });
    await walletB.popup.click('button:has-text("Accept Gift")');
    // Jump to Wallet — received gifts render inline there.
    await walletB.popup.click('button[title="Wallet"]');
    await expect(walletB.popup.locator('.gift-card')).toBeVisible({ timeout: 10_000 });
  });

  // This is the test that captures COD-13. Marked fixme so the suite is
  // green while the bug is open; flip to a plain test() once the iOS
  // sender-side relay ships.
  test.fixme('desktop wallet B — gift sender should report online (COD-13)', async ({ walletB }) => {
    await walletB.popup.bringToFront();
    // Give the peer-probe a beat to settle — desktop probes on Wallet
    // appear and again on an interval.
    await walletB.popup.waitForTimeout(3000);
    // The gift-card online dot renders a title attribute with the
    // sender status. Expect it to say online; today it says offline
    // because the iOS app never connected as role:sender.
    const dot = walletB.popup.locator('.gift-card .peer-online-dot').first();
    await expect(dot).toHaveAttribute('data-status', 'online', { timeout: 20_000 });
  });

  test('cleanup — remove redeemed gift link file', async () => {
    // Ensure we don't accidentally reuse an old link on the next run.
    try { fs.unlinkSync(GIFT_LINK_PATH); } catch { /* ignore */ }
  });
});
