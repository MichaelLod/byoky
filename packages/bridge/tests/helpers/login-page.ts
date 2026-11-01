/**
 * Runs a login page that `byoky-bridge connect` or the OpenClaw plugin
 * serves, script included, in jsdom against its real server. The page's
 * auth-sdk.js bundle is stood in for by a fake wallet's Byoky class and the
 * real connectCovering; the content script's startBridgeProxy answer comes
 * from the fake wallet too.
 */

import { JSDOM } from 'jsdom';
import { request } from 'node:http';
import { connectCovering } from '../../src/page-session.js';
import type { FakeWallet } from './fake-wallet.js';

export interface LoginPage {
  click(): void;
  status(): string;
  close(): void;
}

export function openLoginPage(html: string, port: number, wallet: FakeWallet): LoginPage {
  const origin = `http://127.0.0.1:${port}`;
  const dom = new JSDOM(html, {
    url: `${origin}/`,
    runScripts: 'dangerously',
    beforeParse(window) {
      const w = window as unknown as Record<string, unknown>;
      w.ByokySDK = { Byoky: wallet.byokyClass(), connectCovering };
      // The page's own same-origin fetches, sent to its server.
      w.fetch = (path: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) =>
        new Promise((resolve, reject) => {
          const req = request({
            host: '127.0.0.1',
            port,
            path: new URL(path, origin).pathname,
            method: init.method ?? 'GET',
            headers: { ...init.headers, origin },
          }, (res) => {
            res.resume();
            res.on('end', () => {
              const status = res.statusCode ?? 0;
              resolve({ ok: status >= 200 && status < 300, status });
            });
          });
          req.on('error', reject);
          req.end(init.body);
        });
      window.addEventListener('message', (event) => {
        const msg = event.data as { type?: string; action?: string; requestId?: string; payload?: { sessionKey: string; port: number } };
        if (msg?.type !== 'BYOKY_INTERNAL_FROM_PAGE' || msg.action !== 'startBridgeProxy' || !msg.payload) return;
        const result = wallet.startBridge(msg.payload.sessionKey);
        window.document.dispatchEvent(new window.CustomEvent('byoky-message', {
          detail: { requestId: msg.requestId, payload: { ...result, port: msg.payload.port } },
        }));
      });
    },
  });
  const doc = dom.window.document;
  return {
    click: () => (doc.getElementById('connect-btn') as HTMLButtonElement).click(),
    status: () => doc.getElementById('status-text')?.textContent ?? '',
    close: () => dom.window.close(),
  };
}
