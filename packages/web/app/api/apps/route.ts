import { NextResponse } from 'next/server';
import { listApps } from '@/lib/apps-db';

const VALID_CATEGORIES = ['chat', 'coding', 'trading', 'productivity', 'research', 'creative', 'other'];

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const category = searchParams.get('category') ?? undefined;
  const search = searchParams.get('search') ?? undefined;
  if (category && !VALID_CATEGORIES.includes(category)) {
    return NextResponse.json({ error: 'Invalid category' }, { status: 400 });
  }
  try {
    const rows = await listApps({ category, search });
    return NextResponse.json({
      apps: rows.map((r) => ({
        ...r.payload,
        id: r.slug,
        status: 'approved',
        verified: r.verified,
        featured: r.featured,
        createdAt: r.createdAt,
      })),
    });
  } catch (err) {
    console.error('listApps failed', err);
    return NextResponse.json({ apps: [] });
  }
}
