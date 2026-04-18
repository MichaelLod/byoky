import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { listAppSubmissions } from '@/lib/apps-db';

function checkAdminAuth(request: Request): NextResponse | null {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return NextResponse.json({ error: 'Admin access not configured' }, { status: 503 });
  const auth = request.headers.get('Authorization');
  const expected = `Bearer ${secret}`;
  if (!auth || auth.length !== expected.length || !timingSafeEqual(Buffer.from(auth), Buffer.from(expected))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}

export async function GET(request: Request) {
  const authError = checkAdminAuth(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const statusParam = searchParams.get('status');
  const status = statusParam === 'pending' || statusParam === 'approved' || statusParam === 'rejected' ? statusParam : undefined;

  const rows = await listAppSubmissions(status);
  return NextResponse.json({
    submissions: rows.map((r) => ({
      ...r.payload,
      status: r.status,
      submittedAt: r.submittedAt,
      reviewedAt: r.reviewedAt,
    })),
  });
}
