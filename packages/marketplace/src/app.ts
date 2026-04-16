import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { timingSafeEqual } from 'node:crypto';
import {
  listGifts, addGift, removeGift, updateGiftUsage, heartbeat,
  getGiftById, getGiftMgmtHash, generateManagementToken, hashToken,
} from './db.js';

export const app = new Hono();

// CORS: read-only routes open to all, write routes restricted
const ALLOWED_ORIGINS = [
  'https://byoky.com',
  /^chrome-extension:\/\//,
  /^moz-extension:\/\//,
  /^safari-web-extension:\/\//,
];

function isAllowedOrigin(origin: string): boolean {
  return ALLOWED_ORIGINS.some((o) => (typeof o === 'string' ? o === origin : o.test(origin)));
}

app.use('/gifts', cors({
  origin: (origin) => isAllowedOrigin(origin) ? origin : 'https://byoky.com',
}));

app.use('/gifts/*', cors({
  origin: (origin) => isAllowedOrigin(origin) ? origin : 'https://byoky.com',
}));

// --- Rate limiting (in-memory, per-IP) ---
const redeemAttempts = new Map<string, { count: number; resetAt: number }>();
const REDEEM_WINDOW = 60_000; // 1 minute
const REDEEM_MAX = 10; // max redeems per window per IP

function checkRedeemRate(ip: string): boolean {
  const now = Date.now();
  const entry = redeemAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    redeemAttempts.set(ip, { count: 1, resetAt: now + REDEEM_WINDOW });
    return true;
  }
  if (entry.count >= REDEEM_MAX) return false;
  entry.count++;
  return true;
}

// Clean up rate limit map periodically
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of redeemAttempts) {
    if (now > entry.resetAt) redeemAttempts.delete(ip);
  }
}, 60_000);

// --- Input validation helpers ---
const MAX_ID = 128;
const MAX_PROVIDER = 64;
const MAX_NAME = 100;
const MAX_URL = 2048;

function isValidWssUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === 'wss:';
  } catch {
    return false;
  }
}

function isPositiveInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n > 0;
}

// --- Management token auth helper ---
function extractBearerToken(c: { req: { header: (name: string) => string | undefined } }): string | null {
  const auth = c.req.header('Authorization');
  if (!auth?.startsWith('Bearer ')) return null;
  return auth.slice(7);
}

async function verifyMgmtToken(id: string, c: { req: { header: (name: string) => string | undefined } }): Promise<boolean> {
  const token = extractBearerToken(c);
  if (!token) return false;
  const storedHash = await getGiftMgmtHash(id);
  if (!storedHash) return false;
  const a = Buffer.from(hashToken(token));
  const b = Buffer.from(storedHash);
  return a.length === b.length && timingSafeEqual(a, b);
}

// --- Routes ---

// List all public gifts (paginated)
app.get('/gifts', async (c) => {
  const limit = Math.min(Math.max(1, parseInt(c.req.query('limit') ?? '100', 10) || 100), 200);
  const offset = Math.max(0, parseInt(c.req.query('offset') ?? '0', 10) || 0);

  const gifts = await listGifts(limit, offset);
  const now = Date.now();
  const ONLINE_THRESHOLD = 5 * 60 * 1000;

  const strip = (g: typeof gifts[number]) => ({
    ...g,
    giftLink: undefined,
    tokensRemaining: Math.max(0, g.tokenBudget - g.tokensUsed),
  });

  const active = gifts
    .filter((g) => !g.unlisted && g.expiresAt > now && g.tokensUsed < g.tokenBudget)
    .map((g) => ({ ...strip(g), online: now - g.lastSeenAt < ONLINE_THRESHOLD }));

  const expired = gifts
    .filter((g) => !g.unlisted && (g.expiresAt <= now || g.tokensUsed >= g.tokenBudget))
    .slice(0, 20)
    .map((g) => ({ ...strip(g), online: false }));

  // Surface recently-revoked gifts so the UI can show a "Removed" badge
  // instead of silently dropping them from the list.
  const removed = gifts
    .filter((g) => g.unlisted)
    .slice(0, 20)
    .map((g) => ({ ...strip(g), online: false }));

  return c.json({ active, expired, removed });
});

// Get gift link for redemption (rate-limited)
app.get('/gifts/:id/redeem', async (c) => {
  const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
    ?? c.req.header('x-real-ip')
    ?? 'unknown';

  if (!checkRedeemRate(ip)) {
    return c.json({ error: 'Too many requests. Try again later.' }, 429);
  }

  const gift = await getGiftById(c.req.param('id'));
  if (!gift) return c.json({ error: 'Gift not found' }, 404);
  if (gift.expiresAt <= Date.now()) return c.json({ error: 'Gift expired' }, 410);
  if (gift.tokensUsed >= gift.tokenBudget) return c.json({ error: 'Gift depleted' }, 410);
  return c.json({ giftLink: gift.giftLink });
});

// List a gift publicly
app.post('/gifts', async (c) => {
  const body = await c.req.json<{
    id: string;
    providerId: string;
    gifterName?: string;
    giftLink: string;
    relayUrl: string;
    tokenBudget: number;
    expiresAt: number;
  }>();

  // Required fields
  if (!body.id || !body.providerId || !body.giftLink || !body.relayUrl || !body.tokenBudget || !body.expiresAt) {
    return c.json({ error: 'Missing required fields' }, 400);
  }

  // Length limits
  if (typeof body.id !== 'string' || body.id.length > MAX_ID) {
    return c.json({ error: `id must be a string under ${MAX_ID} chars` }, 400);
  }
  if (typeof body.providerId !== 'string' || body.providerId.length > MAX_PROVIDER) {
    return c.json({ error: `providerId must be a string under ${MAX_PROVIDER} chars` }, 400);
  }
  if (body.gifterName && (typeof body.gifterName !== 'string' || body.gifterName.length > MAX_NAME)) {
    return c.json({ error: `gifterName must be under ${MAX_NAME} chars` }, 400);
  }
  if (typeof body.giftLink !== 'string' || body.giftLink.length > MAX_URL) {
    return c.json({ error: `giftLink must be under ${MAX_URL} chars` }, 400);
  }

  // Relay URL must be wss://
  if (!isValidWssUrl(body.relayUrl)) {
    return c.json({ error: 'relayUrl must be a valid wss:// URL' }, 400);
  }

  // Numeric validation
  if (!isPositiveInt(body.tokenBudget)) {
    return c.json({ error: 'tokenBudget must be a positive integer' }, 400);
  }
  if (!isPositiveInt(body.expiresAt)) {
    return c.json({ error: 'expiresAt must be a positive integer' }, 400);
  }
  if (body.expiresAt <= Date.now()) {
    return c.json({ error: 'Gift is already expired' }, 400);
  }

  // Generate management token for the gift creator
  const { token: mgmtToken, hash: mgmtTokenHash } = generateManagementToken();

  try {
    await addGift({
      id: body.id,
      providerId: body.providerId,
      gifterName: body.gifterName?.trim() || 'Anonymous',
      giftLink: body.giftLink,
      relayUrl: body.relayUrl,
      tokenBudget: body.tokenBudget,
      expiresAt: body.expiresAt,
      mgmtTokenHash,
    });
    return c.json({ success: true, managementToken: mgmtToken });
  } catch {
    return c.json({ error: 'Gift already listed or invalid' }, 409);
  }
});

// Unlist a gift (requires management token)
app.delete('/gifts/:id', async (c) => {
  const id = c.req.param('id');
  if (!await verifyMgmtToken(id, c)) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  const removed = await removeGift(id);
  if (!removed) return c.json({ error: 'Gift not found' }, 404);
  return c.json({ success: true });
});

// Update usage (requires management token)
app.patch('/gifts/:id/usage', async (c) => {
  const id = c.req.param('id');
  if (!await verifyMgmtToken(id, c)) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  const body = await c.req.json<{ tokensUsed: number }>();
  if (typeof body.tokensUsed !== 'number' || body.tokensUsed < 0) {
    return c.json({ error: 'tokensUsed must be a non-negative number' }, 400);
  }
  const updated = await updateGiftUsage(id, body.tokensUsed);
  if (!updated) return c.json({ error: 'Gift not found' }, 404);
  return c.json({ success: true });
});

// Heartbeat (requires management token)
app.post('/gifts/:id/heartbeat', async (c) => {
  const id = c.req.param('id');
  if (!await verifyMgmtToken(id, c)) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  const ok = await heartbeat(id);
  if (!ok) return c.json({ error: 'Gift not found' }, 404);
  return c.json({ success: true });
});
