import { Hono } from 'hono';
import { cors } from 'hono/cors';

// Temporary compatibility shim. The authoritative token pool now lives on
// the vault (`GET /pool`, `POST /pool/list`, `POST /pool/unlist`). This
// service only exists to absorb requests from already-installed extensions
// and mobile apps that still POST to marketplace.byoky.com. Delete once
// the next extension + app releases are out in the wild.

export const app = new Hono();

const VAULT_URL = process.env.VAULT_URL ?? 'https://vault.byoky.com';

const ALLOWED_ORIGINS = [
  'https://byoky.com',
  /^chrome-extension:\/\//,
  /^moz-extension:\/\//,
  /^safari-web-extension:\/\//,
];

function isAllowedOrigin(origin: string): boolean {
  return ALLOWED_ORIGINS.some((o) => (typeof o === 'string' ? o === origin : o.test(origin)));
}

app.use('/*', cors({
  origin: (origin) => isAllowedOrigin(origin) ? origin : 'https://byoky.com',
}));

const MAX_ID = 128;
const MAX_URL = 2048;

function base64UrlDecode(s: string): Uint8Array | null {
  try {
    const padded = s.replace(/-/g, '+').replace(/_/g, '/');
    return Uint8Array.from(Buffer.from(padded, 'base64'));
  } catch {
    return null;
  }
}

/**
 * Pull the bearer authToken out of a share URL the old client posted. Old
 * extensions send the full short-link or long URL; both ultimately carry
 * the encoded GiftLink blob whose `t` field IS the authToken.
 */
function extractAuthTokenFromGiftLink(giftLink: string): string | null {
  const shortMatch = giftLink.match(/^https?:\/\/[^/]+\/g\/([A-Za-z0-9]{8,32})\/?$/);
  if (shortMatch) {
    // Short links resolve via the vault; we'd need an extra round-trip.
    // Old clients that used short links had cloud-vault enabled anyway,
    // so their gift is already in the vault and will get listed when the
    // upgraded extension/app ships. Silent no-op here is safe.
    return null;
  }
  const longMatch = giftLink.match(/byoky\.com\/gift[#/]([A-Za-z0-9_-]+)/);
  const encoded = longMatch?.[1];
  if (!encoded || encoded.length > 8192) return null;
  const bytes = base64UrlDecode(encoded);
  if (!bytes) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as { v?: number; t?: unknown };
    if (parsed.v !== 1 || typeof parsed.t !== 'string') return null;
    return parsed.t;
  } catch {
    return null;
  }
}

// Legacy public-listing endpoint. New clients use POST /gifts on the vault
// directly with the user's auth token — they skip this shim entirely.
app.post('/gifts', async (c) => {
  const body = await c.req.json<{
    id?: string;
    gifterName?: string;
    giftLink?: string;
  }>();
  if (!body.id || typeof body.id !== 'string' || body.id.length > MAX_ID) {
    return c.json({ error: 'Missing or invalid id' }, 400);
  }
  if (!body.giftLink || typeof body.giftLink !== 'string' || body.giftLink.length > MAX_URL) {
    return c.json({ error: 'Missing or invalid giftLink' }, 400);
  }

  const authToken = extractAuthTokenFromGiftLink(body.giftLink);
  if (!authToken) {
    // Short-link case or malformed blob. Accept silently so the old client
    // doesn't retry storm — the gift will still work via the relay, just
    // won't surface on /token-pool until the user upgrades.
    return c.json({ success: true, managementToken: '' });
  }

  const res = await fetch(`${VAULT_URL}/pool/list`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      giftId: body.id,
      authToken,
      gifterName: body.gifterName,
    }),
  });
  if (!res.ok) {
    // Vault may not yet have the gift (extension's vault-sync queue races
    // the marketplace POST). Return success to old client anyway — the
    // gift still works; it just won't appear on /token-pool this time.
    return c.json({ success: true, managementToken: authToken });
  }

  // Use the authToken itself as the managementToken so later heartbeat /
  // DELETE calls can be validated against the vault the same way.
  return c.json({ success: true, managementToken: authToken });
});

// Heartbeat no-op — the vault now tracks live status via the relay
// WebSocket connection, no periodic ping needed.
app.post('/gifts/:id/heartbeat', (c) => c.json({ success: true }));

app.delete('/gifts/:id', async (c) => {
  const auth = c.req.header('Authorization');
  const authToken = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
  const giftId = c.req.param('id');
  if (!authToken) return c.json({ error: 'Unauthorized' }, 401);

  const res = await fetch(`${VAULT_URL}/pool/unlist`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ giftId, authToken }),
  });
  if (!res.ok) return c.json({ error: 'Unauthorized' }, 401);
  return c.json({ success: true });
});

// Legacy listing read — web /token-pool now reads directly from the
// vault's /pool, so this just returns empty shells for any stray caller.
app.get('/gifts', (c) => c.json({ active: [], expired: [], removed: [] }));
app.get('/gifts/:id/redeem', (c) => c.json({ error: 'Redeem via byoky.com/token-pool' }, 410));
