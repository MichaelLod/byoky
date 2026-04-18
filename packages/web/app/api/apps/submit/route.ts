import { NextResponse } from 'next/server';
import { addAppSubmission, type AppPayload } from '@/lib/apps-db';

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/;
const VALID_CATEGORIES = ['chat', 'coding', 'trading', 'productivity', 'research', 'creative', 'other'];
const MAX_NAME = 100;
const MAX_DESC = 1000;
const MAX_URL = 2048;
const MAX_AUTHOR_NAME = 100;
const MAX_AUTHOR_EMAIL = 320;

function isValidHttpsUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === 'https:';
  } catch {
    return false;
  }
}

// Deny-list for the embed fetch so a submission can't probe internal hosts.
// Only covers bare-IP hostnames; a resolved DNS name that points into a
// private range would still get through — acceptable for a public submission
// flow where we care about trivially-obvious abuse.
function isPrivateOrReservedHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') || h.endsWith('.local')) return true;
  if (h === '::1' || h === '[::1]') return true;
  if (h.startsWith('[fe80:') || h.startsWith('fe80:') || h.startsWith('[fc') || h.startsWith('fc') || h.startsWith('[fd') || h.startsWith('fd')) return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (v4) {
    const [a, b] = [parseInt(v4[1], 10), parseInt(v4[2], 10)];
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a >= 224) return true;
  }
  return false;
}

async function checkIframeEmbeddable(url: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return { ok: false, reason: 'Invalid URL.' }; }
  if (isPrivateOrReservedHost(parsed.hostname)) {
    return { ok: false, reason: 'App URL must resolve to a public host.' };
  }
  let res: Response;
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 5000);
    let current = parsed.toString();
    let hops = 0;
    for (;;) {
      res = await fetch(current, { method: 'GET', redirect: 'manual', signal: controller.signal });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        if (!loc || hops >= 5) { clearTimeout(t); return { ok: false, reason: 'App URL redirects too many times or is missing a Location header.' }; }
        const next = new URL(loc, current);
        if (next.protocol !== 'https:' || isPrivateOrReservedHost(next.hostname)) {
          clearTimeout(t);
          return { ok: false, reason: 'App URL redirects to a non-public or non-HTTPS host.' };
        }
        current = next.toString();
        hops++;
        continue;
      }
      break;
    }
    clearTimeout(t);
  } catch {
    return { ok: false, reason: 'Could not reach the app URL. Make sure it is publicly accessible.' };
  }

  const xfo = res.headers.get('x-frame-options')?.toLowerCase().trim();
  if (xfo === 'deny' || xfo === 'sameorigin') {
    return { ok: false, reason: `App URL sets X-Frame-Options: ${xfo}, which blocks iframe embedding.` };
  }
  const csp = res.headers.get('content-security-policy');
  if (csp) {
    const fa = /frame-ancestors\s+([^;]+)/i.exec(csp)?.[1]?.trim().toLowerCase();
    if (fa) {
      const sources = fa.split(/\s+/);
      if (sources.includes("'none'")) return { ok: false, reason: "App URL sets Content-Security-Policy: frame-ancestors 'none'." };
      const allowsAny = sources.some((s) => s === '*' || s === 'https:' || s.includes('byoky.com') || s.startsWith('chrome-extension:') || s.startsWith('moz-extension:'));
      if (!allowsAny) return { ok: false, reason: `App URL's CSP frame-ancestors (${fa}) does not allow the Byoky extension.` };
    }
  }
  return { ok: true };
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const slug = typeof body.slug === 'string' ? body.slug.trim() : '';
  const url = typeof body.url === 'string' ? body.url.trim() : '';
  const icon = typeof body.icon === 'string' ? body.icon.trim() : '';
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  const category = typeof body.category === 'string' ? body.category.trim() : '';
  const providers = Array.isArray(body.providers)
    ? body.providers.filter((p): p is string => typeof p === 'string' && p.length > 0)
    : [];
  const author = body.author as Record<string, unknown> | undefined;
  const authorName = typeof author?.name === 'string' ? author.name.trim() : '';
  const authorEmail = typeof author?.email === 'string' ? author.email.trim() : '';
  const authorWebsite = typeof author?.website === 'string' ? author.website.trim() : undefined;

  if (!name || !slug || !url || !description || !authorName || !authorEmail) {
    return NextResponse.json({ error: 'Missing required fields: name, slug, url, description, author.name, author.email' }, { status: 400 });
  }
  if (name.length > MAX_NAME) return NextResponse.json({ error: `Name must be under ${MAX_NAME} characters` }, { status: 400 });
  if (description.length > MAX_DESC) return NextResponse.json({ error: `Description must be under ${MAX_DESC} characters` }, { status: 400 });
  if (url.length > MAX_URL) return NextResponse.json({ error: `URL must be under ${MAX_URL} characters` }, { status: 400 });
  if (authorName.length > MAX_AUTHOR_NAME) return NextResponse.json({ error: `Author name must be under ${MAX_AUTHOR_NAME} characters` }, { status: 400 });
  if (authorEmail.length > MAX_AUTHOR_EMAIL) return NextResponse.json({ error: `Author email must be under ${MAX_AUTHOR_EMAIL} characters` }, { status: 400 });
  if (!SLUG_RE.test(slug)) return NextResponse.json({ error: 'Slug must be lowercase alphanumeric with hyphens (2-63 chars)' }, { status: 400 });
  if (!isValidHttpsUrl(url)) return NextResponse.json({ error: 'App URL must be a valid HTTPS URL' }, { status: 400 });
  if (icon && !isValidHttpsUrl(icon)) return NextResponse.json({ error: 'Icon URL must be a valid HTTPS URL' }, { status: 400 });
  if (authorWebsite && !isValidHttpsUrl(authorWebsite)) return NextResponse.json({ error: 'Author website must be a valid HTTPS URL' }, { status: 400 });
  if (!VALID_CATEGORIES.includes(category)) {
    return NextResponse.json({ error: `Category must be one of: ${VALID_CATEGORIES.join(', ')}` }, { status: 400 });
  }
  if (providers.length === 0) return NextResponse.json({ error: 'At least one provider is required' }, { status: 400 });

  const embed = await checkIframeEmbeddable(url);
  if (!embed.ok) return NextResponse.json({ error: embed.reason }, { status: 400 });

  const payload: AppPayload = {
    name, slug, url,
    ...(icon ? { icon } : {}),
    description, category, providers,
    author: { name: authorName, email: authorEmail, ...(authorWebsite ? { website: authorWebsite } : {}) },
  };

  try {
    const result = await addAppSubmission(payload);
    if (result === 'conflict') {
      return NextResponse.json({ error: 'An app with that slug is already submitted or approved' }, { status: 409 });
    }
    return NextResponse.json({ success: true, message: 'Submitted for review' });
  } catch (err) {
    console.error('addAppSubmission failed', err);
    return NextResponse.json({ error: 'Could not store submission' }, { status: 500 });
  }
}
