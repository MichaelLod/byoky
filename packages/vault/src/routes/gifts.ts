import { Hono } from 'hono';
import { PROVIDERS } from '@byoky/core';
import {
  createGift,
  getGiftsByUser,
  getGiftById,
  deleteGift,
  countActiveGiftsByUser,
  updateGiftMarketplaceToken,
} from '../db/index.js';
import { encryptGiftSecret } from '../gift-crypto.js';
import { authMiddleware } from '../middleware/auth.js';
import { connectGift, disconnectGift } from '../gift-relay.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_GIFTS_PER_USER = 50;
const MAX_STRING_LENGTH = 4096;

const gifts = new Hono();

gifts.use('/*', authMiddleware);

gifts.post('/', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json<{
    giftId?: string;
    providerId?: string;
    authMethod?: string;
    apiKey?: string;
    relayAuthToken?: string;
    relayUrl?: string;
    maxTokens?: number;
    usedTokens?: number;
    expiresAt?: number;
    marketplaceManagementToken?: string;
  }>();

  const { giftId, providerId, authMethod, apiKey, relayAuthToken, relayUrl, maxTokens, usedTokens, expiresAt, marketplaceManagementToken } = body;

  if (!giftId || !providerId || !authMethod || !apiKey || !relayAuthToken || !relayUrl || !maxTokens || !expiresAt) {
    return c.json({ error: { code: 'INVALID_INPUT', message: 'Missing required fields' } }, 400);
  }

  // Format validation
  if (!UUID_RE.test(giftId)) {
    return c.json({ error: { code: 'INVALID_INPUT', message: 'giftId must be a UUID' } }, 400);
  }
  if (!PROVIDERS[providerId]) {
    return c.json({ error: { code: 'INVALID_INPUT', message: 'Unknown provider' } }, 400);
  }
  if (authMethod !== 'api_key' && authMethod !== 'oauth') {
    return c.json({ error: { code: 'INVALID_INPUT', message: 'Invalid authMethod' } }, 400);
  }
  if (apiKey.length > MAX_STRING_LENGTH || relayAuthToken.length > MAX_STRING_LENGTH) {
    return c.json({ error: { code: 'INVALID_INPUT', message: 'Field too long' } }, 400);
  }

  // Numeric bounds
  if (!Number.isFinite(maxTokens) || maxTokens <= 0 || maxTokens > 100_000_000) {
    return c.json({ error: { code: 'INVALID_INPUT', message: 'maxTokens must be 1–100M' } }, 400);
  }
  const safeUsedTokens = Math.max(0, Math.floor(usedTokens ?? 0));

  // Relay URL validation — only wss:// in production, ws:// only for localhost
  try {
    const parsed = new URL(relayUrl);
    if (parsed.protocol === 'ws:') {
      if (parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1' && parsed.hostname !== '[::1]') {
        return c.json({ error: { code: 'INVALID_INPUT', message: 'ws:// only allowed for localhost' } }, 400);
      }
    } else if (parsed.protocol !== 'wss:') {
      return c.json({ error: { code: 'INVALID_INPUT', message: 'Relay URL must use wss://' } }, 400);
    }
  } catch {
    return c.json({ error: { code: 'INVALID_INPUT', message: 'Invalid relay URL' } }, 400);
  }

  if (expiresAt <= Date.now()) {
    return c.json({ error: { code: 'INVALID_INPUT', message: 'Gift already expired' } }, 400);
  }

  // Per-user gift count limit
  const activeCount = await countActiveGiftsByUser(userId);
  if (activeCount >= MAX_GIFTS_PER_USER) {
    return c.json({ error: { code: 'LIMIT_EXCEEDED', message: `Maximum ${MAX_GIFTS_PER_USER} active gifts allowed` } }, 429);
  }

  if (marketplaceManagementToken !== undefined &&
      (typeof marketplaceManagementToken !== 'string' || marketplaceManagementToken.length > MAX_STRING_LENGTH)) {
    return c.json({ error: { code: 'INVALID_INPUT', message: 'Invalid marketplaceManagementToken' } }, 400);
  }

  const encryptedApiKey = await encryptGiftSecret(apiKey);
  const encryptedRelayToken = await encryptGiftSecret(relayAuthToken);
  const encryptedMarketplaceMgmtToken = marketplaceManagementToken
    ? await encryptGiftSecret(marketplaceManagementToken)
    : null;

  let gift;
  try {
    gift = await createGift(
      giftId, userId, providerId, authMethod,
      encryptedApiKey, encryptedRelayToken, relayUrl,
      maxTokens, safeUsedTokens, expiresAt,
      encryptedMarketplaceMgmtToken,
    );
  } catch (err: unknown) {
    // Handle duplicate gift ID (unique constraint violation)
    const message = err instanceof Error ? err.message : '';
    if (message.includes('unique') || message.includes('duplicate')) {
      return c.json({ error: { code: 'DUPLICATE', message: 'Gift already registered' } }, 409);
    }
    throw err;
  }

  connectGift(gift);

  return c.json({ gift: { id: gift.id, usedTokens: gift.usedTokens } }, 201);
});

gifts.get('/', async (c) => {
  const userId = c.get('userId');
  const rows = await getGiftsByUser(userId);
  return c.json({
    gifts: rows.map((g) => ({
      id: g.id,
      providerId: g.providerId,
      maxTokens: g.maxTokens,
      usedTokens: g.usedTokens,
      expiresAt: g.expiresAt,
      active: g.active,
    })),
  });
});

gifts.get('/:id', async (c) => {
  const userId = c.get('userId');
  const giftId = c.req.param('id');
  const gift = await getGiftById(userId, giftId);
  if (!gift) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Gift not found' } }, 404);
  }
  return c.json({
    gift: {
      id: gift.id,
      providerId: gift.providerId,
      maxTokens: gift.maxTokens,
      usedTokens: gift.usedTokens,
      expiresAt: gift.expiresAt,
      active: gift.active,
    },
  });
});

gifts.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const giftId = c.req.param('id');
  disconnectGift(giftId);
  await deleteGift(userId, giftId);
  return c.json({ success: true });
});

gifts.patch('/:id/marketplace-token', async (c) => {
  const userId = c.get('userId');
  const giftId = c.req.param('id');
  const body = await c.req.json<{ marketplaceManagementToken?: string }>();
  const token = body.marketplaceManagementToken;
  if (typeof token !== 'string' || token.length === 0 || token.length > MAX_STRING_LENGTH) {
    return c.json({ error: { code: 'INVALID_INPUT', message: 'Invalid marketplaceManagementToken' } }, 400);
  }
  const existing = await getGiftById(userId, giftId);
  if (!existing) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Gift not found' } }, 404);
  }
  const encrypted = await encryptGiftSecret(token);
  await updateGiftMarketplaceToken(userId, giftId, encrypted);
  return c.json({ success: true });
});

export { gifts };
