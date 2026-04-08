import { Hono } from 'hono';
import { eq, desc, and, sql, gte } from 'drizzle-orm';
import crypto from 'node:crypto';
import { authMiddleware } from '../middleware/auth.js';
import { getDb } from '../db/index.js';
import { developerApps, transactions } from '../db/billing-schema.js';
import { createConnectAccount, createConnectOnboardingLink, getConnectAccountStatus } from '../billing/stripe.js';
import { getUserById } from '../db/index.js';

const developer = new Hono();

// Auth middleware only applies to non-public routes
developer.use('/*', async (c, next) => {
  // Skip auth for public endpoints
  if (c.req.path.match(/\/apps\/[^/]+\/public$/)) return next();
  return authMiddleware(c, next);
});

// Public endpoint — no auth required (used by SDK PayButton)
developer.get('/apps/:id/public', async (c) => {
  const appId = c.req.param('id');

  const [app] = await getDb()
    .select({
      id: developerApps.id,
      name: developerApps.name,
      discountPercent: developerApps.discountPercent,
      description: developerApps.description,
      category: developerApps.category,
      iconUrl: developerApps.iconUrl,
      totalUsers: developerApps.totalUsers,
    })
    .from(developerApps)
    .where(eq(developerApps.id, appId))
    .limit(1);

  if (!app) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'App not found' } }, 404);
  }

  return c.json(app);
});

// --- Register App ---

developer.post('/apps', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json<{
    name: string;
    origins?: string[];
    discountPercent?: number;
    description?: string;
    category?: string;
    iconUrl?: string;
  }>();

  if (!body.name?.trim()) {
    return c.json({ error: { code: 'INVALID_INPUT', message: 'App name is required' } }, 400);
  }

  const discount = Math.min(Math.max(body.discountPercent ?? 0, 0), 90);
  const id = `app_${crypto.randomUUID().replace(/-/g, '')}`;
  const apiKey = `byoky_${crypto.randomBytes(32).toString('hex')}`;
  const apiKeyHash = crypto.createHash('sha256').update(apiKey).digest('hex');

  // Create Stripe Connect account for developer payouts
  const user = await getUserById(userId);
  let stripeConnectAccountId: string | null = null;
  try {
    const account = await createConnectAccount(userId, user?.username ?? '');
    stripeConnectAccountId = account.id;
  } catch (err) {
    console.error('Failed to create Stripe Connect account:', err);
    // Non-blocking — developer can set up payouts later
  }

  const [app] = await getDb().insert(developerApps).values({
    id,
    developerId: userId,
    name: body.name.trim(),
    apiKeyHash,
    origins: JSON.stringify(body.origins ?? []),
    discountPercent: discount,
    stripeConnectAccountId,
    description: body.description ?? null,
    category: body.category ?? null,
    iconUrl: body.iconUrl ?? null,
    createdAt: Date.now(),
  }).returning();

  return c.json({
    id: app.id,
    name: app.name,
    apiKey, // Only returned once at creation
    discountPercent: app.discountPercent,
    stripeConnectAccountId,
  });
});

// --- List Developer's Apps ---

developer.get('/apps', async (c) => {
  const userId = c.get('userId');
  const apps = await getDb()
    .select({
      id: developerApps.id,
      name: developerApps.name,
      origins: developerApps.origins,
      discountPercent: developerApps.discountPercent,
      totalUsers: developerApps.totalUsers,
      category: developerApps.category,
      description: developerApps.description,
      createdAt: developerApps.createdAt,
    })
    .from(developerApps)
    .where(eq(developerApps.developerId, userId))
    .orderBy(desc(developerApps.createdAt));

  return c.json({
    apps: apps.map((a) => ({
      ...a,
      origins: JSON.parse(a.origins),
    })),
  });
});

// --- App Stats ---

developer.get('/apps/:id/stats', async (c) => {
  const userId = c.get('userId');
  const appId = c.req.param('id');

  const [app] = await getDb()
    .select()
    .from(developerApps)
    .where(and(eq(developerApps.id, appId), eq(developerApps.developerId, userId)))
    .limit(1);

  if (!app) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'App not found' } }, 404);
  }

  // Aggregate transaction stats for last 30 days
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

  const [stats] = await getDb()
    .select({
      totalRequests: sql<number>`count(*)::int`,
      totalAmountCents: sql<number>`coalesce(sum(${transactions.amountCents}), 0)::int`,
      totalInputTokens: sql<number>`coalesce(sum(${transactions.inputTokens}), 0)::int`,
      totalOutputTokens: sql<number>`coalesce(sum(${transactions.outputTokens}), 0)::int`,
      uniqueUsers: sql<number>`count(distinct ${transactions.userId})::int`,
    })
    .from(transactions)
    .where(and(
      eq(transactions.appId, appId),
      eq(transactions.type, 'charge'),
      gte(transactions.createdAt, thirtyDaysAgo),
    ));

  return c.json({
    app: {
      id: app.id,
      name: app.name,
      discountPercent: app.discountPercent,
      totalUsers: app.totalUsers,
    },
    last30Days: stats ?? {
      totalRequests: 0,
      totalAmountCents: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      uniqueUsers: 0,
    },
  });
});

// --- Rotate API Key ---

developer.post('/apps/:id/rotate-key', async (c) => {
  const userId = c.get('userId');
  const appId = c.req.param('id');

  const [app] = await getDb()
    .select()
    .from(developerApps)
    .where(and(eq(developerApps.id, appId), eq(developerApps.developerId, userId)))
    .limit(1);

  if (!app) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'App not found' } }, 404);
  }

  const newApiKey = `byoky_${crypto.randomBytes(32).toString('hex')}`;
  const newHash = crypto.createHash('sha256').update(newApiKey).digest('hex');

  await getDb()
    .update(developerApps)
    .set({ apiKeyHash: newHash })
    .where(eq(developerApps.id, appId));

  return c.json({ apiKey: newApiKey });
});

// --- Stripe Connect Onboarding Link ---

developer.post('/apps/:id/connect-onboarding', async (c) => {
  const userId = c.get('userId');
  const appId = c.req.param('id');
  const { returnUrl, refreshUrl } = await c.req.json<{
    returnUrl: string;
    refreshUrl: string;
  }>();

  const [app] = await getDb()
    .select()
    .from(developerApps)
    .where(and(eq(developerApps.id, appId), eq(developerApps.developerId, userId)))
    .limit(1);

  if (!app?.stripeConnectAccountId) {
    return c.json({ error: { code: 'NO_CONNECT_ACCOUNT', message: 'No Stripe Connect account' } }, 400);
  }

  const url = await createConnectOnboardingLink(
    app.stripeConnectAccountId,
    returnUrl,
    refreshUrl,
  );

  return c.json({ url });
});

// --- Connect Account Status ---

developer.get('/apps/:id/connect-status', async (c) => {
  const userId = c.get('userId');
  const appId = c.req.param('id');

  const [app] = await getDb()
    .select()
    .from(developerApps)
    .where(and(eq(developerApps.id, appId), eq(developerApps.developerId, userId)))
    .limit(1);

  if (!app?.stripeConnectAccountId) {
    return c.json({ chargesEnabled: false, payoutsEnabled: false });
  }

  const status = await getConnectAccountStatus(app.stripeConnectAccountId);
  return c.json(status);
});

// --- Update App ---

developer.put('/apps/:id', async (c) => {
  const userId = c.get('userId');
  const appId = c.req.param('id');
  const body = await c.req.json<{
    name?: string;
    origins?: string[];
    discountPercent?: number;
    description?: string;
    category?: string;
    iconUrl?: string;
  }>();

  const [app] = await getDb()
    .select()
    .from(developerApps)
    .where(and(eq(developerApps.id, appId), eq(developerApps.developerId, userId)))
    .limit(1);

  if (!app) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'App not found' } }, 404);
  }

  const updates: Partial<typeof developerApps.$inferInsert> = {};
  if (body.name !== undefined) updates.name = body.name.trim();
  if (body.origins !== undefined) updates.origins = JSON.stringify(body.origins);
  if (body.discountPercent !== undefined) updates.discountPercent = Math.min(Math.max(body.discountPercent, 0), 90);
  if (body.description !== undefined) updates.description = body.description;
  if (body.category !== undefined) updates.category = body.category;
  if (body.iconUrl !== undefined) updates.iconUrl = body.iconUrl;

  if (Object.keys(updates).length > 0) {
    await getDb()
      .update(developerApps)
      .set(updates)
      .where(eq(developerApps.id, appId));
  }

  return c.json({ success: true });
});

export { developer };
