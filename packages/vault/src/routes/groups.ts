import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import crypto from 'node:crypto';
import { authMiddleware } from '../middleware/auth.js';
import { getDb } from '../db/index.js';
import { groups, appGroups } from '../db/billing-schema.js';

const groupsRouter = new Hono();

groupsRouter.use('/*', authMiddleware);

// --- List groups ---

groupsRouter.get('/', async (c) => {
  const userId = c.get('userId');

  const userGroups = await getDb()
    .select()
    .from(groups)
    .where(eq(groups.userId, userId));

  const userAppGroups = await getDb()
    .select()
    .from(appGroups)
    .where(eq(appGroups.userId, userId));

  // Build map: groupId → origins[]
  const groupApps: Record<string, string[]> = {};
  for (const ag of userAppGroups) {
    (groupApps[ag.groupId] ??= []).push(ag.appOrigin);
  }

  return c.json({
    groups: userGroups.map((g) => ({
      ...g,
      apps: groupApps[g.id] ?? [],
    })),
  });
});

// --- Create group ---

groupsRouter.post('/', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json<{
    name: string;
    providerId: string;
    credentialId?: string;
    model?: string;
    description?: string;
  }>();

  if (!body.name?.trim() || !body.providerId) {
    return c.json({ error: { code: 'INVALID_INPUT', message: 'name and providerId required' } }, 400);
  }

  const id = crypto.randomUUID();
  const [group] = await getDb().insert(groups).values({
    id,
    userId,
    name: body.name.trim(),
    providerId: body.providerId,
    credentialId: body.credentialId ?? null,
    model: body.model ?? null,
    description: body.description ?? null,
    createdAt: Date.now(),
  }).returning();

  return c.json(group, 201);
});

// --- Update group (switch provider, credential, model) ---

groupsRouter.put('/:id', async (c) => {
  const userId = c.get('userId');
  const groupId = c.req.param('id');
  const body = await c.req.json<{
    name?: string;
    providerId?: string;
    credentialId?: string | null;
    model?: string | null;
    description?: string | null;
  }>();

  const [existing] = await getDb()
    .select()
    .from(groups)
    .where(and(eq(groups.id, groupId), eq(groups.userId, userId)))
    .limit(1);

  if (!existing) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Group not found' } }, 404);
  }

  const updates: Partial<typeof groups.$inferInsert> = {};
  if (body.name !== undefined) updates.name = body.name.trim();
  if (body.providerId !== undefined) updates.providerId = body.providerId;
  if (body.credentialId !== undefined) updates.credentialId = body.credentialId;
  if (body.model !== undefined) updates.model = body.model;
  if (body.description !== undefined) updates.description = body.description;

  if (Object.keys(updates).length > 0) {
    await getDb()
      .update(groups)
      .set(updates)
      .where(eq(groups.id, groupId));
  }

  return c.json({ success: true });
});

// --- Delete group ---

groupsRouter.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const groupId = c.req.param('id');

  // Remove app assignments first (cascade should handle, but explicit)
  await getDb()
    .delete(appGroups)
    .where(and(eq(appGroups.groupId, groupId), eq(appGroups.userId, userId)));

  await getDb()
    .delete(groups)
    .where(and(eq(groups.id, groupId), eq(groups.userId, userId)));

  return c.json({ success: true });
});

// --- Assign apps to group ---

groupsRouter.put('/:id/apps', async (c) => {
  const userId = c.get('userId');
  const groupId = c.req.param('id');
  const { origins } = await c.req.json<{ origins: string[] }>();

  if (!Array.isArray(origins)) {
    return c.json({ error: { code: 'INVALID_INPUT', message: 'origins must be an array' } }, 400);
  }

  // Verify group exists and belongs to user
  const [group] = await getDb()
    .select()
    .from(groups)
    .where(and(eq(groups.id, groupId), eq(groups.userId, userId)))
    .limit(1);

  if (!group) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Group not found' } }, 404);
  }

  // Upsert each origin → group mapping
  for (const origin of origins) {
    // Remove existing assignment for this origin
    await getDb()
      .delete(appGroups)
      .where(and(eq(appGroups.userId, userId), eq(appGroups.appOrigin, origin)));

    // Insert new assignment
    await getDb().insert(appGroups).values({
      id: crypto.randomUUID(),
      userId,
      appOrigin: origin,
      groupId,
    });
  }

  return c.json({ success: true });
});

// --- Remove app from group (returns to default) ---

groupsRouter.delete('/:id/apps/:origin', async (c) => {
  const userId = c.get('userId');
  const origin = decodeURIComponent(c.req.param('origin'));

  await getDb()
    .delete(appGroups)
    .where(and(eq(appGroups.userId, userId), eq(appGroups.appOrigin, origin)));

  return c.json({ success: true });
});

export { groupsRouter };
