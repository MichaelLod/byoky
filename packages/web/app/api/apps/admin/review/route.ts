import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { getAppSubmission, updateAppSubmissionStatus, upsertApp } from '@/lib/apps-db';

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

export async function POST(request: Request) {
  const authError = checkAdminAuth(request);
  if (authError) return authError;

  let body: { slug?: string; action?: 'approve' | 'reject' };
  try { body = (await request.json()) as { slug?: string; action?: 'approve' | 'reject' }; }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }

  const slug = body.slug;
  const action = body.action;
  if (!slug || (action !== 'approve' && action !== 'reject')) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const submission = await getAppSubmission(slug);
  if (!submission) return NextResponse.json({ error: 'Submission not found' }, { status: 404 });

  await updateAppSubmissionStatus(slug, action === 'approve' ? 'approved' : 'rejected');
  if (action === 'approve') {
    await upsertApp({ slug, payload: submission.payload });
  }
  return NextResponse.json({ success: true });
}
