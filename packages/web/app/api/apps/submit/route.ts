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

async function checkIframeEmbeddable(url: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  let res: Response;
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 5000);
    res = await fetch(url, { method: 'GET', redirect: 'follow', signal: controller.signal });
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
    if (!name || !slug || !url || !description) {
      return NextResponse.json(
        { error: 'Missing required fields: name, slug, url, description' },
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
