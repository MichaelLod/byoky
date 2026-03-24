import { Hono } from 'hono';
import crypto from 'node:crypto';
import { hashPassword, verifyPassword, deriveKey, checkPasswordStrength } from '@byoky/core';
import { createUser, getUserByEmail, createSession, deleteSession } from '../db/index.js';
import { signJwt, hashToken } from '../jwt.js';
import { cacheKey, evictKey } from '../session-keys.js';
import { authMiddleware } from '../middleware/auth.js';

const SALT_LENGTH = 16;
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const auth = new Hono();

auth.post('/signup', async (c) => {
  const body = await c.req.json<{ email?: string; password?: string }>();
  const { email, password } = body;

  if (!email || !password) {
    return c.json({ error: { code: 'INVALID_INPUT', message: 'Email and password are required' } }, 400);
  }

  const emailLower = email.toLowerCase().trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailLower)) {
    return c.json({ error: { code: 'INVALID_INPUT', message: 'Invalid email address' } }, 400);
  }

  const strength = checkPasswordStrength(password);
  if (strength.score < 2) {
    return c.json({ error: { code: 'WEAK_PASSWORD', message: 'Password too weak', feedback: strength.feedback } }, 400);
  }

  if (getUserByEmail(emailLower)) {
    return c.json({ error: { code: 'EMAIL_EXISTS', message: 'An account with this email already exists' } }, 409);
  }

  const passwordHash = await hashPassword(password);
  const encryptionSalt = Buffer.from(crypto.getRandomValues(new Uint8Array(SALT_LENGTH))).toString('base64');
  const user = createUser(emailLower, passwordHash, encryptionSalt);

  // Derive encryption key and cache it
  const saltBytes = Buffer.from(encryptionSalt, 'base64');
  const encryptionKey = await deriveKey(password, new Uint8Array(saltBytes));

  // Create session with proper session ID in token
  const tempToken = signJwt(user.id, 'pending', SESSION_DURATION_MS);
  const session = createSession(user.id, hashToken(tempToken), Date.now() + SESSION_DURATION_MS);

  // Re-sign with actual session ID
  deleteSession(session.id);
  const finalToken = signJwt(user.id, session.id, SESSION_DURATION_MS);
  const finalSession = createSession(user.id, hashToken(finalToken), Date.now() + SESSION_DURATION_MS);

  cacheKey(user.id, encryptionKey);

  return c.json({
    token: finalToken,
    user: { id: user.id, email: user.email },
    sessionId: finalSession.id,
  }, 201);
});

auth.post('/login', async (c) => {
  const body = await c.req.json<{ email?: string; password?: string }>();
  const { email, password } = body;

  if (!email || !password) {
    return c.json({ error: { code: 'INVALID_INPUT', message: 'Email and password are required' } }, 400);
  }

  const emailLower = email.toLowerCase().trim();
  const user = getUserByEmail(emailLower);
  if (!user) {
    return c.json({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' } }, 401);
  }

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    return c.json({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' } }, 401);
  }

  // Derive encryption key and cache it
  const saltBytes = Buffer.from(user.encryption_salt, 'base64');
  const encryptionKey = await deriveKey(password, new Uint8Array(saltBytes));

  // Create session with proper session ID in token
  const tempToken = signJwt(user.id, 'pending', SESSION_DURATION_MS);
  const session = createSession(user.id, hashToken(tempToken), Date.now() + SESSION_DURATION_MS);

  deleteSession(session.id);
  const finalToken = signJwt(user.id, session.id, SESSION_DURATION_MS);
  const finalSession = createSession(user.id, hashToken(finalToken), Date.now() + SESSION_DURATION_MS);

  cacheKey(user.id, encryptionKey);

  return c.json({
    token: finalToken,
    user: { id: user.id, email: user.email },
    sessionId: finalSession.id,
  });
});

auth.post('/logout', authMiddleware, async (c) => {
  const userId = c.get('userId');
  const sessionId = c.get('sessionId');
  deleteSession(sessionId);
  evictKey(userId);
  return c.json({ ok: true });
});

export { auth };
