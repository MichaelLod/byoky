import { Hono } from 'hono';
import crypto from 'node:crypto';
import { hashPassword, verifyPassword, deriveKey, checkPasswordStrength } from '@byoky/core';
import { createUser, getUserByUsername, createUserSession, deleteUserSession } from '../db/index.js';
import { signJwt, hashToken } from '../jwt.js';
import { cacheKey, evictKey } from '../session-keys.js';
import { authMiddleware } from '../middleware/auth.js';

const SALT_LENGTH = 16;
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const auth = new Hono();

auth.get('/check-username/:username', async (c) => {
  const username = c.req.param('username').toLowerCase().trim();
  if (!/^[a-z0-9][a-z0-9_-]{1,28}[a-z0-9]$/.test(username)) {
    return c.json({ available: false, reason: 'invalid' });
  }
  const existing = await getUserByUsername(username);
  return c.json({ available: !existing });
});

auth.post('/signup', async (c) => {
  const body = await c.req.json<{ username?: string; password?: string }>();
  const { username, password } = body;

  if (!username || !password) {
    return c.json({ error: { code: 'INVALID_INPUT', message: 'Username and password are required' } }, 400);
  }

  const usernameLower = username.toLowerCase().trim();
  if (!/^[a-z0-9][a-z0-9_-]{1,28}[a-z0-9]$/.test(usernameLower)) {
    return c.json({ error: { code: 'INVALID_INPUT', message: 'Username must be 3-30 characters: letters, numbers, hyphens, underscores' } }, 400);
  }

  const strength = checkPasswordStrength(password);
  if (strength.score < 2) {
    return c.json({ error: { code: 'WEAK_PASSWORD', message: 'Password too weak', feedback: strength.feedback } }, 400);
  }

  const existing = await getUserByUsername(usernameLower);
  if (existing) {
    return c.json({ error: { code: 'USERNAME_TAKEN', message: 'This username is already taken' } }, 409);
  }

  const passwordHash = await hashPassword(password);
  const encryptionSalt = Buffer.from(crypto.getRandomValues(new Uint8Array(SALT_LENGTH))).toString('base64');
  const user = await createUser(usernameLower, passwordHash, encryptionSalt);

  // Derive encryption key and cache it
  const saltBytes = Buffer.from(encryptionSalt, 'base64');
  const encryptionKey = await deriveKey(password, new Uint8Array(saltBytes));

  const sessionId = crypto.randomUUID();
  const token = signJwt(user.id, sessionId, SESSION_DURATION_MS);
  await createUserSession(user.id, hashToken(token), Date.now() + SESSION_DURATION_MS, sessionId);

  cacheKey(user.id, encryptionKey);

  return c.json({
    token,
    user: { id: user.id, username: user.username },
    sessionId,
  }, 201);
});

auth.post('/login', async (c) => {
  const body = await c.req.json<{ username?: string; password?: string }>();
  const { username, password } = body;

  if (!username || !password) {
    return c.json({ error: { code: 'INVALID_INPUT', message: 'Username and password are required' } }, 400);
  }

  const usernameLower = username.toLowerCase().trim();
  const user = await getUserByUsername(usernameLower);
  if (!user) {
    return c.json({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid username or password' } }, 401);
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    return c.json({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid username or password' } }, 401);
  }

  // Derive encryption key and cache it
  const saltBytes = Buffer.from(user.encryptionSalt, 'base64');
  const encryptionKey = await deriveKey(password, new Uint8Array(saltBytes));

  const sessionId = crypto.randomUUID();
  const token = signJwt(user.id, sessionId, SESSION_DURATION_MS);
  await createUserSession(user.id, hashToken(token), Date.now() + SESSION_DURATION_MS, sessionId);

  cacheKey(user.id, encryptionKey);

  return c.json({
    token,
    user: { id: user.id, username: user.username },
    sessionId,
  });
});

auth.post('/logout', authMiddleware, async (c) => {
  const userId = c.get('userId');
  const sessionId = c.get('sessionId');
  await deleteUserSession(sessionId);
  evictKey(userId);
  return c.json({ ok: true });
});

export { auth };
