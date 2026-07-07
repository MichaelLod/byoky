import { NextResponse } from 'next/server';
import { checkInboxAuth, noStore } from '@/lib/inbox-auth';
import { sendEmail } from '@/lib/mail';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const authError = checkInboxAuth(request);
  if (authError) return authError;

  let body: {
    to?: string;
    subject?: string;
    body?: string;
    html?: string;
    replyToEmailId?: string;
  };
  try {
    body = await request.json();
  } catch {
    return noStore(NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }));
  }

  if (!body.to?.trim() || !body.subject?.trim() || !body.body?.trim()) {
    return noStore(
      NextResponse.json({ error: 'to, subject, and body are required' }, { status: 400 }),
    );
  }

  try {
    const { id } = await sendEmail({
      to: body.to,
      subject: body.subject,
      body: body.body,
      html: body.html,
      replyToEmailId: body.replyToEmailId,
    });
    return noStore(NextResponse.json({ id }));
  } catch (e) {
    return noStore(
      NextResponse.json(
        { error: e instanceof Error ? e.message : 'Failed to send' },
        { status: 500 },
      ),
    );
  }
}
