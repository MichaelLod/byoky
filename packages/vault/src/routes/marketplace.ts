import { Hono } from 'hono';
import { eq, desc, sql } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { developerApps, transactions } from '../db/billing-schema.js';

const marketplace = new Hono();

// All marketplace routes are public (no auth)

marketplace.get('/apps', async (c) => {
  const category = c.req.query('category');
  const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 100);
  const offset = parseInt(c.req.query('offset') ?? '0', 10);

  let query = getDb()
    .select({
      id: developerApps.id,
      name: developerApps.name,
      description: developerApps.description,
      category: developerApps.category,
      iconUrl: developerApps.iconUrl,
      discountPercent: developerApps.discountPercent,
      totalUsers: developerApps.totalUsers,
    })
    .from(developerApps)
    .orderBy(desc(developerApps.totalUsers))
    .limit(limit)
    .offset(offset);

  if (category && category !== 'All') {
    query = query.where(eq(developerApps.category, category)) as typeof query;
  }

  const apps = await query;
  return c.json({ apps });
});

marketplace.get('/apps/:id', async (c) => {
  const appId = c.req.param('id');

  const [app] = await getDb()
    .select({
      id: developerApps.id,
      name: developerApps.name,
      description: developerApps.description,
      category: developerApps.category,
      iconUrl: developerApps.iconUrl,
      discountPercent: developerApps.discountPercent,
      totalUsers: developerApps.totalUsers,
      createdAt: developerApps.createdAt,
    })
    .from(developerApps)
    .where(eq(developerApps.id, appId))
    .limit(1);

  if (!app) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'App not found' } }, 404);
  }

  return c.json({ app });
});

marketplace.get('/trending', async (c) => {
  // Apps with most transactions in the last 7 days
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

  const trending = await getDb()
    .select({
      appId: transactions.appId,
      requestCount: sql<number>`count(*)::int`,
    })
    .from(transactions)
    .where(sql`${transactions.createdAt} >= ${sevenDaysAgo} AND ${transactions.appId} IS NOT NULL`)
    .groupBy(transactions.appId)
    .orderBy(sql`count(*) DESC`)
    .limit(10);

  const appIds = trending.map((t) => t.appId).filter(Boolean) as string[];
  if (appIds.length === 0) return c.json({ apps: [] });

  const apps = await getDb()
    .select({
      id: developerApps.id,
      name: developerApps.name,
      description: developerApps.description,
      category: developerApps.category,
      iconUrl: developerApps.iconUrl,
      discountPercent: developerApps.discountPercent,
      totalUsers: developerApps.totalUsers,
    })
    .from(developerApps)
    .where(sql`${developerApps.id} IN (${sql.join(appIds.map(id => sql`${id}`), sql`, `)})`);

  return c.json({ apps });
});

export { marketplace };
