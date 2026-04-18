import { Hono } from 'hono';
import { DEFAULT_GROUP_ID, getProvider } from '@byoky/core';
import {
  listGroupsByUser,
  getGroupByUserAndId,
  upsertGroup,
  deleteGroup,
  listAppGroupsByUser,
  setAppGroup,
  deleteAppGroup,
  getCredentialById,
} from '../db/index.js';
import { authMiddleware } from '../middleware/auth.js';
import { userRateLimitMiddleware } from '../middleware/rate-limit.js';

const groups = new Hono();

groups.use('/*', authMiddleware);
groups.use('/*', userRateLimitMiddleware);

// ─── Groups CRUD ─────────────────────────────────────────────────────────

groups.get('/', async (c) => {
  const userId = c.get('userId');
  const rows = await listGroupsByUser(userId);
  return c.json({
    groups: rows.map((g) => ({
      id: g.id,
      name: g.name,
      providerId: g.providerId,
      credentialId: g.credentialId,
      giftId: g.giftId,
      model: g.model,
      createdAt: g.createdAt,
    })),
  });
});

groups.put('/:id', async (c) => {
  const userId = c.get('userId');
  const groupId = c.req.param('id');

  const body = await c.req.json<{
    name?: string;
    providerId?: string;
    credentialId?: string | null;
    giftId?: string | null;
    model?: string | null;
  }>();

  if (!body.name || !body.providerId) {
    return c.json({ error: { code: 'INVALID_INPUT', message: 'name and providerId are required' } }, 400);
  }

  // The default group is allowed to bind to an empty providerId — that's
  // its uninitialised state. Real groups must point at a known provider.
  if (groupId !== DEFAULT_GROUP_ID && !getProvider(body.providerId)) {
    return c.json({ error: { code: 'INVALID_PROVIDER', message: `Unknown provider: ${body.providerId}` } }, 400);
  }

  // credentialId and giftId are mutually exclusive — a group pins to an
  // owned credential XOR a received gift, never both.
  if (body.credentialId && body.giftId) {
    return c.json({ error: { code: 'INVALID_INPUT', message: 'credentialId and giftId are mutually exclusive' } }, 400);
  }

  // If a credential pin is supplied, verify it exists and belongs to the
  // user (cross-user pin would be a routing leak).
  if (body.credentialId) {
    const cred = await getCredentialById(userId, body.credentialId);
    if (!cred) {
      return c.json({ error: { code: 'INVALID_CREDENTIAL', message: 'credential not found' } }, 400);
    }
  }

  const row = await upsertGroup(
    userId,
    groupId,
    body.name,
    body.providerId,
    body.credentialId ?? null,
    body.giftId ?? null,
    body.model ?? null,
  );

  return c.json({
    group: {
      id: row.id,
      name: row.name,
      providerId: row.providerId,
      credentialId: row.credentialId,
      giftId: row.giftId,
      model: row.model,
      createdAt: row.createdAt,
    },
  });
});

groups.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const groupId = c.req.param('id');

  if (groupId === DEFAULT_GROUP_ID) {
    return c.json({ error: { code: 'INVALID_INPUT', message: 'Cannot delete the default group' } }, 400);
  }

  const ok = await deleteGroup(userId, groupId);
  if (!ok) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Group not found' } }, 404);
  }

  return c.json({ ok: true });
});

// ─── App → group bindings ────────────────────────────────────────────────
//
// Surfaces the per-origin routing config. The vault never auto-creates
// app_groups rows — apps without explicit bindings transparently fall back
// to the default group at /proxy time. Clients write here when the user
// drags an app between groups in the UI.

groups.get('/apps', async (c) => {
  const userId = c.get('userId');
  const rows = await listAppGroupsByUser(userId);
  return c.json({
    apps: rows.map((a) => ({
      origin: a.origin,
      groupId: a.groupId,
      createdAt: a.createdAt,
    })),
  });
});

groups.put('/apps/:origin', async (c) => {
  const userId = c.get('userId');
  const origin = decodeURIComponent(c.req.param('origin'));
  const body = await c.req.json<{ groupId?: string }>();

  if (!body.groupId) {
    return c.json({ error: { code: 'INVALID_INPUT', message: 'groupId is required' } }, 400);
  }

  // The target group must exist for this user (preventing orphaned
  // bindings that the resolver would have to ignore).
  const group = await getGroupByUserAndId(userId, body.groupId);
  if (!group) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Group not found' } }, 404);
  }

  const row = await setAppGroup(userId, origin, body.groupId);
  return c.json({
    app: {
      origin: row.origin,
      groupId: row.groupId,
      createdAt: row.createdAt,
    },
  });
});

groups.delete('/apps/:origin', async (c) => {
  const userId = c.get('userId');
  const origin = decodeURIComponent(c.req.param('origin'));
  await deleteAppGroup(userId, origin);
  return c.json({ ok: true });
});

export { groups };
