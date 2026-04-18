import { NextResponse } from 'next/server';
import { getApp } from '@/lib/apps-db';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  if (slug === 'submit' || slug === 'admin') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const row = await getApp(slug);
  if (!row) return NextResponse.json({ error: 'App not found' }, { status: 404 });
  return NextResponse.json({
    ...row.payload,
    id: row.slug,
    status: 'approved',
    verified: row.verified,
    featured: row.featured,
    createdAt: row.createdAt,
  });
}
