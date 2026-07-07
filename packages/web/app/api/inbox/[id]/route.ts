import { NextResponse } from 'next/server';
import { checkInboxAuth, noStore } from '@/lib/inbox-auth';
import { readEmail } from '@/lib/mail';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = checkInboxAuth(request);
  if (authError) return authError;

  const { id } = await params;
  try {
    const email = await readEmail(id);
    return noStore(NextResponse.json({ email }));
  } catch (e) {
    return noStore(
      NextResponse.json(
        { error: e instanceof Error ? e.message : 'Failed to load email' },
        { status: 500 },
      ),
    );
  }
}
