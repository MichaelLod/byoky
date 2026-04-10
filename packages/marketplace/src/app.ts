import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { listGifts, addGift, removeGift, updateGiftUsage, heartbeat } from './db.js';

export const app = new Hono();

app.use('/gifts/*', cors());
app.use('/gifts', cors());

// List all public gifts
app.get('/gifts', async (c) => {
  const gifts = await listGifts();
  const now = Date.now();
  const ONLINE_THRESHOLD = 5 * 60 * 1000;

  const active = gifts
    .filter((g) => g.expiresAt > now && g.tokensUsed < g.tokenBudget)
    .map((g) => ({
      ...g,
      giftLink: undefined,
      online: now - g.lastSeenAt < ONLINE_THRESHOLD,
      tokensRemaining: g.tokenBudget - g.tokensUsed,
    }));

  const expired = gifts
    .filter((g) => g.expiresAt <= now || g.tokensUsed >= g.tokenBudget)
    .slice(0, 20)
    .map((g) => ({
      ...g,
      giftLink: undefined,
      online: false,
      tokensRemaining: Math.max(0, g.tokenBudget - g.tokensUsed),
    }));

  return c.json({ active, expired });
});

// Get gift link for redemption
app.get('/gifts/:id/redeem', async (c) => {
  const gifts = await listGifts();
  const gift = gifts.find((g) => g.id === c.req.param('id'));
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

  if (!body.id || !body.providerId || !body.giftLink || !body.relayUrl || !body.tokenBudget || !body.expiresAt) {
    return c.json({ error: 'Missing required fields' }, 400);
  }

  if (body.expiresAt <= Date.now()) {
    return c.json({ error: 'Gift is already expired' }, 400);
  }

  try {
    await addGift({
      id: body.id,
      providerId: body.providerId,
      gifterName: body.gifterName?.trim() || 'Anonymous',
      giftLink: body.giftLink,
      relayUrl: body.relayUrl,
      tokenBudget: body.tokenBudget,
      expiresAt: body.expiresAt,
    });
    return c.json({ success: true });
  } catch {
    return c.json({ error: 'Gift already listed or invalid' }, 409);
  }
});

// Unlist a gift
app.delete('/gifts/:id', async (c) => {
  const removed = await removeGift(c.req.param('id'));
  if (!removed) return c.json({ error: 'Gift not found' }, 404);
  return c.json({ success: true });
});

// Update usage
app.patch('/gifts/:id/usage', async (c) => {
  const body = await c.req.json<{ tokensUsed: number }>();
  if (typeof body.tokensUsed !== 'number') return c.json({ error: 'Invalid tokensUsed' }, 400);
  const updated = await updateGiftUsage(c.req.param('id'), body.tokensUsed);
  if (!updated) return c.json({ error: 'Gift not found' }, 404);
  return c.json({ success: true });
});

// Heartbeat
app.post('/gifts/:id/heartbeat', async (c) => {
  const ok = await heartbeat(c.req.param('id'));
  if (!ok) return c.json({ error: 'Gift not found' }, 404);
  return c.json({ success: true });
});
