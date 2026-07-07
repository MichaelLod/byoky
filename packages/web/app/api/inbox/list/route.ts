import { NextResponse } from 'next/server';
import { checkInboxAuth, noStore } from '@/lib/inbox-auth';
import { listInbox } from '@/lib/mail';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const authError = checkInboxAuth(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const raw = Number(searchParams.get('limit'));
  const limit = Number.isFinite(raw) && raw > 0 ? Math.min(Math.floor(raw), 100) : 30;

  try {
    const items = await listInbox(limit);
    return noStore(NextResponse.json({ items }));
  } catch (e) {
    return noStore(
      NextResponse.json(
        { error: e instanceof Error ? e.message : 'Failed to load inbox' },
        { status: 500 },
      ),
    );
  }
}
