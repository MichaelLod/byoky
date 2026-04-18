import { PROVIDERS } from './providers.js';

// --- Gift (sender side) ---

export interface Gift {
  id: string;
  credentialId: string;
  providerId: string;
  label: string;
  authToken: string;
  maxTokens: number;
  usedTokens: number;
  expiresAt: number;
  createdAt: number;
  active: boolean;
  relayUrl: string;
  /** Marketplace management token — only set if the gift was listed publicly.
   * Clients send it with `/gifts/:id/heartbeat` so the marketplace shows the
   * gift as online; the vault holds an encrypted copy so it can heartbeat
   * while every device is backgrounded. */
  marketplaceManagementToken?: string;
}

// --- Gift link (shareable payload) ---

export interface GiftLink {
  v: 1;
  id: string;
  p: string;    // providerId
  n: string;    // provider display name
  s: string;    // sender label
  t: string;    // auth token
  m: number;    // max tokens
  e: number;    // expires at (unix ms)
  r: string;    // relay URL
}

// --- Gifted credential (recipient side) ---

export interface GiftedCredential {
  id: string;
  giftId: string;
  providerId: string;
  providerName: string;
  senderLabel: string;
  authToken: string;
  maxTokens: number;
  usedTokens: number;
  expiresAt: number;
  relayUrl: string;
  createdAt: number;
}

// --- Relay protocol ---

export interface RelayAuth {
  type: 'relay:auth';
  roomId: string;
  authToken: string;
  role: 'sender' | 'recipient';
  /** Sender priority — higher value wins. Default 1 (primary). Vault fallback uses 0. */
  priority?: number;
}

export interface RelayAuthResult {
  type: 'relay:auth:result';
  success: boolean;
  error?: string;
  peerOnline?: boolean;
}

export interface RelayPeerStatus {
  type: 'relay:peer:status';
  online: boolean;
}

export interface RelayUsageUpdate {
  type: 'relay:usage';
  roomId: string;
  usedTokens: number;
}

export type RelayProtocolMessage =
  | RelayAuth
  | RelayAuthResult
  | RelayPeerStatus
  | RelayUsageUpdate;

// --- Encoding / decoding ---

export function encodeGiftLink(link: GiftLink): string {
  const json = JSON.stringify(link);
  const bytes = new TextEncoder().encode(json);
  return base64UrlEncode(bytes);
}

const MAX_GIFT_LINK_SIZE = 8_192; // 8 KB

export function decodeGiftLink(encoded: string): GiftLink | null {
  try {
    if (encoded.length > MAX_GIFT_LINK_SIZE) return null;
    const clean = encoded.replace(/^byoky:\/\/gift\//, '').replace(/^https:\/\/byoky\.com\/gift[#/]/, '');
    const bytes = base64UrlDecode(clean);
    const json = new TextDecoder().decode(bytes);
    const parsed = JSON.parse(json);
    if (parsed.v !== 1) return null;
    return parsed as GiftLink;
  } catch {
    return null;
  }
}

export function giftLinkToUrl(encoded: string): string {
  return `https://byoky.com/gift/${encoded}`;
}

// --- Validation ---

export function validateGiftLink(link: GiftLink): { valid: boolean; reason?: string } {
  if (link.v !== 1) return { valid: false, reason: 'Unsupported gift version' };
  if (!link.id || typeof link.id !== 'string') return { valid: false, reason: 'Missing gift ID' };
  if (!link.p || typeof link.p !== 'string') return { valid: false, reason: 'Missing provider' };
  if (!link.t || typeof link.t !== 'string') return { valid: false, reason: 'Missing auth token' };
  if (!link.r || typeof link.r !== 'string') return { valid: false, reason: 'Missing relay URL' };
  if (typeof link.m !== 'number' || link.m <= 0) return { valid: false, reason: 'Invalid token budget' };
  if (typeof link.e !== 'number' || link.e <= Date.now()) return { valid: false, reason: 'Gift has expired' };

  try {
    const url = new URL(link.r);
    const isLoopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
    if (url.protocol !== 'wss:' && !(url.protocol === 'ws:' && isLoopback)) {
      return { valid: false, reason: 'Relay URL must use wss://' };
    }
  } catch {
    return { valid: false, reason: 'Invalid relay URL' };
  }

  return { valid: true };
}

export function isGiftExpired(gift: { expiresAt: number }): boolean {
  return gift.expiresAt <= Date.now();
}

export function isGiftBudgetExhausted(gift: { usedTokens: number; maxTokens: number }): boolean {
  return gift.usedTokens >= gift.maxTokens;
}

export function giftBudgetRemaining(gift: { usedTokens: number; maxTokens: number }): number {
  return Math.max(0, gift.maxTokens - gift.usedTokens);
}

export function giftBudgetPercent(gift: { usedTokens: number; maxTokens: number }): number {
  if (gift.maxTokens === 0) return 100;
  return Math.min(100, Math.round((gift.usedTokens / gift.maxTokens) * 100));
}

export function createGiftLink(gift: Gift): { encoded: string; link: GiftLink } {
  const provider = PROVIDERS[gift.providerId];
  const link: GiftLink = {
    v: 1,
    id: gift.id,
    p: gift.providerId,
    n: provider?.name ?? gift.providerId,
    s: gift.label,
    t: gift.authToken,
    m: gift.maxTokens,
    e: gift.expiresAt,
    r: gift.relayUrl,
  };
  return { encoded: encodeGiftLink(link), link };
}

// --- Pairing payload (mobile wallet relay connect) ---

export interface PairPayload {
  v: 1;
  r: string;    // relay URL (wss://...)
  id: string;   // room ID
  t: string;    // auth token
  o: string;    // app origin
}

export function encodePairPayload(payload: PairPayload): string {
  const json = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(json);
  return base64UrlEncode(bytes);
}

export function decodePairPayload(encoded: string): PairPayload | null {
  try {
    if (encoded.length > 2048) return null;
    const bytes = base64UrlDecode(encoded);
    const json = new TextDecoder().decode(bytes);
    const parsed = JSON.parse(json);
    if (parsed.v !== 1) return null;
    return parsed as PairPayload;
  } catch {
    return null;
  }
}

// --- Base64url helpers ---

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
