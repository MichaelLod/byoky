import { NextResponse } from 'next/server';
import * as fs from 'node:fs';
import * as path from 'node:path';

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/;
const VALID_CATEGORIES = ['chat', 'coding', 'trading', 'productivity', 'research', 'creative', 'other'];
const MAX_NAME = 100;
const MAX_DESC = 1000;
const MAX_URL = 2048;
const MAX_SLUG = 64;
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

// Block private / loopback / link-local hosts so the embed-check fetch can't be
// used to probe internal networks. Covers bare-IP hostnames; DNS-resolved
// hostnames would need runtime resolution, which is beyond a pre-flight check.
function isPrivateOrReservedHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') || h.endsWith('.local')) return true;
  // IPv6 loopback / link-local / ULA
  if (h === '::1' || h === '[::1]') return true;
  if (h.startsWith('[fe80:') || h.startsWith('fe80:') || h.startsWith('[fc') || h.startsWith('fc') || h.startsWith('[fd') || h.startsWith('fd')) return true;
  // IPv4 literals
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (v4) {
    const [a, b] = [parseInt(v4[1], 10), parseInt(v4[2], 10)];
    if (a === 10) return true;                    // 10.0.0.0/8
    if (a === 127) return true;                   // loopback
    if (a === 0) return true;                     // 0.0.0.0/8
    if (a === 169 && b === 254) return true;      // link-local (AWS IMDS)
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true;      // 192.168.0.0/16
    if (a >= 224) return true;                    // multicast + reserved
  }
  return false;
}

async function checkIframeEmbeddable(url: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: 'Invalid URL.' };
  }
  if (isPrivateOrReservedHost(parsed.hostname)) {
    return { ok: false, reason: 'App URL must resolve to a public host.' };
  }

  let res: Response;
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 5000);
    // manual redirect: re-validate each hop's host so redirects can't escape
    // the private-host guard. Up to 5 hops.
    let current = parsed.toString();
    let hops = 0;
    for (;;) {
      res = await fetch(current, { method: 'GET', redirect: 'manual', signal: controller.signal });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        if (!loc || hops >= 5) {
          clearTimeout(t);
          return { ok: false, reason: 'App URL redirects too many times or is missing a Location header.' };
        }
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
    return { ok: false, reason: `App URL sets X-Frame-Options: ${xfo}, which blocks iframe embedding. Remove it or replace with a CSP frame-ancestors directive allowing the Byoky extension.` };
  }

  const csp = res.headers.get('content-security-policy');
  if (csp) {
    const fa = /frame-ancestors\s+([^;]+)/i.exec(csp)?.[1]?.trim().toLowerCase();
    if (fa) {
      const sources = fa.split(/\s+/);
      if (sources.includes("'none'")) {
        return { ok: false, reason: "App URL sets Content-Security-Policy: frame-ancestors 'none', which blocks iframe embedding." };
      }
      const allowsAny = sources.some((s) => s === '*' || s === 'https:' || s.includes('byoky.com') || s.startsWith('chrome-extension:') || s.startsWith('moz-extension:'));
      if (!allowsAny) {
        return { ok: false, reason: `App URL's CSP frame-ancestors (${fa}) does not allow the Byoky extension. Add * or https: or a chrome-extension:/moz-extension: source.` };
      }
    }
  }

  return { ok: true };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const slug = typeof body.slug === 'string' ? body.slug.trim() : '';
    const url = typeof body.url === 'string' ? body.url.trim() : '';
    const icon = typeof body.icon === 'string' ? body.icon.trim() : '';
    const description = typeof body.description === 'string' ? body.description.trim() : '';
    const category = typeof body.category === 'string' ? body.category.trim() : '';
    const providers = Array.isArray(body.providers) ? body.providers.filter((p): p is string => typeof p === 'string' && p.length > 0) : [];
    const author = body.author as Record<string, unknown> | undefined;
    const authorName = typeof author?.name === 'string' ? author.name.trim() : '';
    const authorEmail = typeof author?.email === 'string' ? author.email.trim() : '';
    const authorWebsite = typeof author?.website === 'string' ? author.website.trim() : undefined;

    // Required fields
    if (!name || !slug || !url || !description || !authorName || !authorEmail) {
      return NextResponse.json(
        { error: 'Missing required fields: name, slug, url, description, author.name, author.email' },
        { status: 400 },
      );
    }

    // Length limits
    if (name.length > MAX_NAME) return NextResponse.json({ error: `Name must be under ${MAX_NAME} characters` }, { status: 400 });
    if (slug.length > MAX_SLUG) return NextResponse.json({ error: `Slug must be under ${MAX_SLUG} characters` }, { status: 400 });
    if (description.length > MAX_DESC) return NextResponse.json({ error: `Description must be under ${MAX_DESC} characters` }, { status: 400 });
    if (url.length > MAX_URL) return NextResponse.json({ error: `URL must be under ${MAX_URL} characters` }, { status: 400 });
    if (authorName.length > MAX_AUTHOR_NAME) return NextResponse.json({ error: `Author name must be under ${MAX_AUTHOR_NAME} characters` }, { status: 400 });
    if (authorEmail.length > MAX_AUTHOR_EMAIL) return NextResponse.json({ error: `Author email must be under ${MAX_AUTHOR_EMAIL} characters` }, { status: 400 });

    // Slug format
    if (!SLUG_RE.test(slug)) {
      return NextResponse.json(
        { error: 'Slug must be lowercase alphanumeric with hyphens (2-63 chars)' },
        { status: 400 },
      );
    }

    // URL must be HTTPS
    if (!isValidHttpsUrl(url)) {
      return NextResponse.json(
        { error: 'App URL must be a valid HTTPS URL' },
        { status: 400 },
      );
    }

    // Icon URL must be HTTPS if provided
    if (icon && !isValidHttpsUrl(icon)) {
      return NextResponse.json(
        { error: 'Icon URL must be a valid HTTPS URL' },
        { status: 400 },
      );
    }

    // Author website must be HTTPS if provided
    if (authorWebsite && !isValidHttpsUrl(authorWebsite)) {
      return NextResponse.json(
        { error: 'Author website must be a valid HTTPS URL' },
        { status: 400 },
      );
    }

    // Category validation
    if (!VALID_CATEGORIES.includes(category)) {
      return NextResponse.json(
        { error: `Category must be one of: ${VALID_CATEGORIES.join(', ')}` },
        { status: 400 },
      );
    }

    // Providers validation
    if (providers.length === 0) {
      return NextResponse.json(
        { error: 'At least one provider is required' },
        { status: 400 },
      );
    }

    // Verify the app URL allows iframe embedding (required for display in the extension popup)
    const embed = await checkIframeEmbeddable(url);
    if (!embed.ok) {
      return NextResponse.json({ error: embed.reason }, { status: 400 });
    }

    // Append to submissions file for review
    const submissionsPath = path.join(process.cwd(), 'data', 'submissions.json');
    let submissions: unknown[] = [];
    try {
      const existing = fs.readFileSync(submissionsPath, 'utf-8');
      submissions = JSON.parse(existing);
    } catch {
      // File doesn't exist yet
    }

    submissions.push({
      id: slug,
      name,
      slug,
      url,
      icon,
      description,
      category,
      providers,
      author: { name: authorName, email: authorEmail, website: authorWebsite },
      status: 'pending',
      verified: false,
      featured: false,
      submittedAt: Date.now(),
    });

    fs.writeFileSync(submissionsPath, JSON.stringify(submissions, null, 2), 'utf-8');

    return NextResponse.json({ success: true, message: 'Submitted for review' });
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
}
