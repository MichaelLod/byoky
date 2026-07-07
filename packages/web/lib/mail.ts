import { Resend } from 'resend';

// Shared mail layer over Resend. Backs both the MCP mail server
// (app/api/mcp/route.ts) and the admin inbox (app/inbox + app/api/inbox/*).
// The API key stays server-side; never import this into a client component.

export const MAIL_FROM_ADDRESS = process.env.MAIL_FROM_ADDRESS ?? 'hi@byoky.com';

function getResend(): Resend {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('RESEND_API_KEY not set');
  return new Resend(key);
}

export interface InboxItem {
  id: string;
  from: string;
  to: string | string[];
  subject: string | null;
  created_at: string;
}

export interface InboxAttachment {
  id: string;
  filename: string | null;
  content_type: string;
  size: number;
}

export interface InboxEmail extends InboxItem {
  text: string | null;
  html: string | null;
  message_id: string | null;
  reply_to: string[] | null;
  attachments: InboxAttachment[];
}

export interface SendEmailInput {
  /** Recipient address, or comma-separated list of addresses. */
  to: string;
  subject: string;
  body: string;
  html?: string;
  /** Inbound email id to reply to — threads via In-Reply-To/References. */
  replyToEmailId?: string;
}

export async function listInbox(limit = 20): Promise<InboxItem[]> {
  const resend = getResend();
  const { data, error } = await resend.emails.receiving.list({ limit });
  if (error) throw new Error(error.message);
  return data.data.map((e) => ({
    id: e.id,
    from: e.from,
    to: e.to,
    subject: e.subject,
    created_at: e.created_at,
  }));
}

export async function readEmail(id: string): Promise<InboxEmail> {
  const resend = getResend();
  const { data, error } = await resend.emails.receiving.get(id);
  if (error) throw new Error(error.message);
  return {
    id: data.id,
    from: data.from,
    to: data.to,
    subject: data.subject,
    created_at: data.created_at,
    text: data.text,
    html: data.html,
    message_id: data.message_id,
    reply_to: data.reply_to,
    attachments: data.attachments.map((a) => ({
      id: a.id,
      filename: a.filename,
      content_type: a.content_type,
      size: a.size,
    })),
  };
}

export async function sendEmail(input: SendEmailInput): Promise<{ id: string | null }> {
  const resend = getResend();
  const headers: Record<string, string> = {};
  let finalSubject = input.subject;

  if (input.replyToEmailId) {
    const { data: original, error: fetchErr } = await resend.emails.receiving.get(input.replyToEmailId);
    if (fetchErr) throw new Error(`reply_to lookup failed: ${fetchErr.message}`);
    if (original.message_id) {
      headers['In-Reply-To'] = original.message_id;
      headers['References'] = original.message_id;
    }
    if (!/^re:/i.test(finalSubject) && original.subject) {
      finalSubject = `Re: ${original.subject}`;
    }
  }

  const { data, error } = await resend.emails.send({
    from: MAIL_FROM_ADDRESS,
    to: input.to.split(',').map((s) => s.trim()).filter(Boolean),
    subject: finalSubject,
    text: input.body,
    html: input.html,
    headers: Object.keys(headers).length ? headers : undefined,
  });
  if (error) throw new Error(error.message);
  return { id: data?.id ?? null };
}
