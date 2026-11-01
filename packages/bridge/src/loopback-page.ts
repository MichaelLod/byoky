/**
 * Guards for the login pages that `byoky-bridge connect` and the OpenClaw
 * plugin serve on 127.0.0.1. Only the served page may report back to the
 * CLI: not another web page, and not one that rebinds its own hostname to
 * 127.0.0.1.
 *
 * No env lookups or child_process here: the OpenClaw plugin bundles this
 * file, and OpenClaw's install-time scanner blocks plugins that mix those
 * with network calls.
 */

import type { IncomingMessage } from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** A per-run secret that is only in the served page. */
export function createPageNonce(): string {
  return randomBytes(24).toString('base64url');
}

/** Constant-time compare; hashing first keeps differing lengths from leaking. */
export function sameSecret(a: string, b: string): boolean {
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
}

function pageHosts(port: number): string[] {
  return [`127.0.0.1:${port}`, `localhost:${port}`];
}

/** The request names the page's own host (a rebinding page would not). */
export function isPageHost(req: IncomingMessage, port: number): boolean {
  return pageHosts(port).includes(req.headers.host ?? '');
}

/**
 * The request is JSON from the page's own origin. A same-origin POST
 * carries the page's Origin; JSON from any other origin needs a CORS
 * preflight, which these servers never grant.
 */
export function isFromPage(req: IncomingMessage, port: number): boolean {
  const contentType = req.headers['content-type'] ?? '';
  if (!/^application\/json\b/i.test(contentType)) return false;
  const origin = req.headers['origin'];
  if (typeof origin === 'string') return pageHosts(port).some((h) => origin === `http://${h}`);
  return req.headers['sec-fetch-site'] === 'same-origin';
}

/**
 * Text the page reports, made safe to print: no control characters (an
 * escape sequence could rewrite the terminal) and no longer than 300.
 */
export function cleanPageMessage(text: string): string {
  // C0, DEL, C1 and the bidi overrides/isolates.
  const cleaned = text.replace(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g, '').trim();
  return cleaned.length > 300 ? `${cleaned.slice(0, 299)}…` : cleaned;
}
