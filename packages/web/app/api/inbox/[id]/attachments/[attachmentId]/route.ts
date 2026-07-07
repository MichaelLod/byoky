import { NextResponse } from 'next/server';
import { checkInboxAuth, noStore } from '@/lib/inbox-auth';
import { getAttachment } from '@/lib/mail';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Build a Content-Disposition that can't be used for header injection: the
// filename is attacker-controlled (from the email), so the ASCII form is
// stripped of quotes/backslash/control chars and the unicode form is
// percent-encoded (RFC 6266). Always "attachment" so nothing renders inline.
function contentDisposition(name: string | null): string {
  const raw = name && name.trim() ? name : 'attachment';
  const ascii = raw.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_') || 'attachment';
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(raw)}`;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; attachmentId: string }> },
) {
  const authError = checkInboxAuth(request);
  if (authError) return authError;

  const { id, attachmentId } = await params;
  try {
    const att = await getAttachment(id, attachmentId);
    const headers = new Headers();
    headers.set('Content-Type', att.contentType || 'application/octet-stream');
    headers.set('Content-Disposition', contentDisposition(att.filename));
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Cache-Control', 'no-store');
    return new Response(att.body, { headers });
  } catch (e) {
    return noStore(
      NextResponse.json(
        { error: e instanceof Error ? e.message : 'Failed to fetch attachment' },
        { status: 500 },
      ),
    );
  }
}
