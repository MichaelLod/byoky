// Persistent storage for the app registry. Vercel's Node runtime filesystem
// is read-only, so submissions and listings live in Postgres rather than a
// JSON file. One database, two tables, shared between the public submit
// endpoint, the storefront listing, and the admin review UI.

import postgres, { type Sql } from 'postgres';

let sql: Sql | null = null;
let migrationsRan = false;

function getClient(): Sql {
  if (sql) return sql;
  const url = process.env.APPS_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('APPS_DATABASE_URL (or DATABASE_URL) env var is required');
  sql = postgres(url, { max: 1, idle_timeout: 20, connect_timeout: 10 });
  return sql;
}

async function ensureMigrated(): Promise<Sql> {
  const s = getClient();
  if (migrationsRan) return s;
  await s`
    CREATE TABLE IF NOT EXISTS app_submissions (
      slug TEXT PRIMARY KEY,
      payload JSONB NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      author_email TEXT NOT NULL,
      submitted_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
      reviewed_at BIGINT
    )
  `;
  await s`
    CREATE TABLE IF NOT EXISTS apps (
      slug TEXT PRIMARY KEY,
      payload JSONB NOT NULL,
      verified BOOLEAN NOT NULL DEFAULT FALSE,
      featured BOOLEAN NOT NULL DEFAULT FALSE,
      created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
    )
  `;
  await s`
    CREATE INDEX IF NOT EXISTS app_submissions_status_idx
      ON app_submissions (status, submitted_at DESC)
  `;
  // Seed the first-party Byoky Chat listing so a brand-new DB isn't empty.
  // ON CONFLICT DO NOTHING keeps this idempotent on re-runs.
  const byokyChat: AppPayload = {
    name: 'Byoky Chat',
    slug: 'byoky-chat',
    url: 'https://chat.byoky.com',
    icon: 'https://byoky.com/icons/byoky-chat.png',
    description: 'Multi-provider AI chat powered by your own API keys. Switch between Claude, GPT, and Gemini in one conversation.',
    category: 'chat',
    providers: ['anthropic', 'openai', 'gemini'],
    author: { name: 'Byoky', email: 'hello@byoky.com', website: 'https://byoky.com' },
  };
  await s`
    INSERT INTO apps (slug, payload, verified, featured)
    VALUES (${byokyChat.slug}, ${JSON.stringify(byokyChat)}::jsonb, TRUE, TRUE)
    ON CONFLICT (slug) DO NOTHING
  `;
  migrationsRan = true;
  return s;
}

export interface AppPayload {
  name: string;
  slug: string;
  url: string;
  icon?: string;
  description: string;
  category: string;
  providers: string[];
  author: { name: string; email: string; website?: string };
}

export interface AppSubmissionRow {
  slug: string;
  payload: AppPayload;
  status: 'pending' | 'approved' | 'rejected';
  submittedAt: number;
  reviewedAt: number | null;
}

export interface AppRow {
  slug: string;
  payload: AppPayload;
  verified: boolean;
  featured: boolean;
  createdAt: number;
}

// postgres.js's JSONValue type is too strict for our narrow-typed payloads.
// Stringify + cast to ::jsonb keeps the query safe while letting TypeScript
// accept arbitrary shapes without weakening the exported interface.
function json(payload: AppPayload): string {
  return JSON.stringify(payload);
}

export async function addAppSubmission(
  payload: AppPayload,
): Promise<'inserted' | 'replaced-rejected' | 'conflict'> {
  const s = await ensureMigrated();
  const existing = await s`SELECT status FROM app_submissions WHERE slug = ${payload.slug}`;
  if (existing.length > 0) {
    const status = existing[0].status as string;
    if (status !== 'rejected') return 'conflict';
    await s`
      UPDATE app_submissions
      SET payload = ${json(payload)}::jsonb,
          status = 'pending',
          author_email = ${payload.author.email},
          submitted_at = ${Date.now()},
          reviewed_at = NULL
      WHERE slug = ${payload.slug}
    `;
    return 'replaced-rejected';
  }
  await s`
    INSERT INTO app_submissions (slug, payload, author_email)
    VALUES (${payload.slug}, ${json(payload)}::jsonb, ${payload.author.email})
  `;
  return 'inserted';
}

export async function listAppSubmissions(
  status?: 'pending' | 'approved' | 'rejected',
): Promise<AppSubmissionRow[]> {
  const s = await ensureMigrated();
  const rows = status
    ? await s`
        SELECT slug, payload, status, submitted_at, reviewed_at
        FROM app_submissions
        WHERE status = ${status}
        ORDER BY submitted_at DESC
      `
    : await s`
        SELECT slug, payload, status, submitted_at, reviewed_at
        FROM app_submissions
        ORDER BY submitted_at DESC
      `;
  return rows.map(toSubmissionRow);
}

export async function getAppSubmission(slug: string): Promise<AppSubmissionRow | null> {
  const s = await ensureMigrated();
  const rows = await s`
    SELECT slug, payload, status, submitted_at, reviewed_at
    FROM app_submissions WHERE slug = ${slug}
  `;
  if (rows.length === 0) return null;
  return toSubmissionRow(rows[0]);
}

export async function updateAppSubmissionStatus(
  slug: string,
  status: 'approved' | 'rejected',
): Promise<AppSubmissionRow | null> {
  const s = await ensureMigrated();
  const rows = await s`
    UPDATE app_submissions
    SET status = ${status}, reviewed_at = ${Date.now()}
    WHERE slug = ${slug}
    RETURNING slug, payload, status, submitted_at, reviewed_at
  `;
  if (rows.length === 0) return null;
  return toSubmissionRow(rows[0]);
}

export async function listApps(opts: { category?: string; search?: string }): Promise<AppRow[]> {
  const s = await ensureMigrated();
  const like = opts.search ? `%${opts.search.toLowerCase()}%` : null;
  const rows = opts.category && like
    ? await s`
        SELECT slug, payload, verified, featured, created_at FROM apps
        WHERE payload->>'category' = ${opts.category}
          AND (lower(payload->>'name') LIKE ${like} OR lower(payload->>'description') LIKE ${like})
        ORDER BY featured DESC, created_at DESC
      `
    : opts.category
    ? await s`
        SELECT slug, payload, verified, featured, created_at FROM apps
        WHERE payload->>'category' = ${opts.category}
        ORDER BY featured DESC, created_at DESC
      `
    : like
    ? await s`
        SELECT slug, payload, verified, featured, created_at FROM apps
        WHERE lower(payload->>'name') LIKE ${like}
           OR lower(payload->>'description') LIKE ${like}
        ORDER BY featured DESC, created_at DESC
      `
    : await s`
        SELECT slug, payload, verified, featured, created_at FROM apps
        ORDER BY featured DESC, created_at DESC
      `;
  return rows.map(toAppRow);
}

export async function getApp(slug: string): Promise<AppRow | null> {
  const s = await ensureMigrated();
  const rows = await s`
    SELECT slug, payload, verified, featured, created_at FROM apps WHERE slug = ${slug}
  `;
  if (rows.length === 0) return null;
  return toAppRow(rows[0]);
}

export async function upsertApp(row: {
  slug: string;
  payload: AppPayload;
  verified?: boolean;
  featured?: boolean;
}): Promise<void> {
  const s = await ensureMigrated();
  await s`
    INSERT INTO apps (slug, payload, verified, featured)
    VALUES (${row.slug}, ${json(row.payload)}::jsonb, ${row.verified ?? false}, ${row.featured ?? false})
    ON CONFLICT (slug) DO UPDATE
    SET payload = EXCLUDED.payload,
        verified = apps.verified OR EXCLUDED.verified,
        featured = apps.featured OR EXCLUDED.featured
  `;
}

// postgres.js occasionally returns JSONB as a raw string on Vercel serverless — parse defensively so `{...payload}` can't produce char-indexed garbage.
function parsePayload(value: unknown): AppPayload {
  return typeof value === 'string' ? (JSON.parse(value) as AppPayload) : (value as AppPayload);
}

function toSubmissionRow(row: Record<string, unknown>): AppSubmissionRow {
  return {
    slug: row.slug as string,
    payload: parsePayload(row.payload),
    status: row.status as AppSubmissionRow['status'],
    submittedAt: Number(row.submitted_at),
    reviewedAt: row.reviewed_at === null ? null : Number(row.reviewed_at),
  };
}

function toAppRow(row: Record<string, unknown>): AppRow {
  return {
    slug: row.slug as string,
    payload: parsePayload(row.payload),
    verified: row.verified === true,
    featured: row.featured === true,
    createdAt: Number(row.created_at),
  };
}
