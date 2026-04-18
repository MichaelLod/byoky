import crypto from 'node:crypto';

export type JwtAudience = 'user' | 'app';

interface JwtPayload {
  sub: string;
  sid: string;
  iat: number;
  exp: number;
  aud?: JwtAudience;
}

function getSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET env var must be set (minimum 32 characters)');
  }
  return secret;
}

function base64url(data: Buffer | string): string {
  const buf = typeof data === 'string' ? Buffer.from(data) : data;
  return buf.toString('base64url');
}

export function signJwt(
  userId: string,
  sessionId: string,
  expiresInMs: number = 7 * 24 * 60 * 60 * 1000,
  audience: JwtAudience = 'user',
): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: JwtPayload = {
    sub: userId,
    sid: sessionId,
    iat: now,
    exp: now + Math.floor(expiresInMs / 1000),
    aud: audience,
  };

  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64url(JSON.stringify(payload));
  const signature = crypto
    .createHmac('sha256', getSecret())
    .update(`${header}.${body}`)
    .digest('base64url');

  return `${header}.${body}.${signature}`;
}

/**
 * Verify a JWT and return its payload, or null if invalid/expired.
 *
 * `expectedAudience` enforces aud-claim binding (defense in depth so a token
 * minted for one middleware can't be replayed at another). Tokens minted
 * before the aud claim was introduced have no `aud` and pass any expectation
 * — this keeps existing sessions valid through the rollout.
 */
export function verifyJwt(token: string, expectedAudience?: JwtAudience): JwtPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [header, body, signature] = parts;

  // Reject anything but HS256. Without this, a future code path that delegated
  // to a JOSE library could be tricked by alg=none / alg=RS256-with-public-key
  // confusion. We only ever sign HS256, so anything else is suspicious.
  let parsedHeader: { alg?: unknown; typ?: unknown };
  try {
    parsedHeader = JSON.parse(Buffer.from(header, 'base64url').toString()) as { alg?: unknown; typ?: unknown };
  } catch {
    return null;
  }
  if (parsedHeader.alg !== 'HS256') return null;

  const expected = crypto
    .createHmac('sha256', getSecret())
    .update(`${header}.${body}`)
    .digest();

  // Decode the presented signature to raw bytes so timingSafeEqual compares
  // HMAC bytes, not base64url strings (avoids subtle length/encoding edge
  // cases — e.g. an attacker presenting `=` padding or different casing).
  let sigBuf: Buffer;
  try {
    sigBuf = Buffer.from(signature, 'base64url');
  } catch {
    return null;
  }
  if (sigBuf.length !== expected.length || !crypto.timingSafeEqual(sigBuf, expected)) {
    return null;
  }

  let payload: JwtPayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as JwtPayload;
  } catch {
    return null;
  }
  if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null;

  // aud check is enforced only when the token actually carries an aud claim.
  // Legacy tokens minted before this rollout have no aud and remain valid
  // until they expire (max 7 days for user sessions, 24h for app sessions).
  if (expectedAudience && payload.aud != null && payload.aud !== expectedAudience) {
    return null;
  }

  return payload;
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
