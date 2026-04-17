import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { timingSafeEqual } from 'node:crypto';
import { Resend } from 'resend';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function requireEnv(key: string) {
  const v = process.env[key];
  if (!v) throw new Error(`${key} not set`);
  return v;
}

function authOk(req: Request) {
  const secret = process.env.MAIL_MCP_SECRET;
  if (!secret || secret.length < 32) return false;
  const header = req.headers.get('authorization') ?? '';
  const prefix = 'Bearer ';
  if (!header.startsWith(prefix)) return false;
  const provided = header.slice(prefix.length);
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function notFound() {
  return new Response('Not Found', { status: 404 });
}

function buildServer() {
  const resend = new Resend(requireEnv('RESEND_API_KEY'));
  const fromAddress = process.env.MAIL_FROM_ADDRESS ?? 'hi@byoky.com';

  const server = new McpServer({
    name: 'byoky-mail',
    version: '0.1.0',
  });

  server.registerTool(
    'list_inbox',
    {
      title: 'List inbox',
      description: `List recent emails received at ${fromAddress}. Returns id, from, subject, created_at (no bodies). Use read_email to fetch a full message.`,
      inputSchema: {
        limit: z.number().int().min(1).max(100).optional(),
      },
    },
    async ({ limit }) => {
      const { data, error } = await resend.emails.receiving.list({
        limit: limit ?? 20,
      });
      if (error) throw new Error(error.message);
      const items = data.data.map((e) => ({
        id: e.id,
        from: e.from,
        to: e.to,
        subject: e.subject,
        created_at: e.created_at,
      }));
      return {
        content: [{ type: 'text', text: JSON.stringify(items, null, 2) }],
      };
    },
  );

  server.registerTool(
    'read_email',
    {
      title: 'Read email',
      description: 'Fetch the full content (subject, text, html, headers) of an inbound email by id.',
      inputSchema: {
        id: z.string().describe('Email id from list_inbox'),
      },
    },
    async ({ id }) => {
      const { data, error } = await resend.emails.receiving.get(id);
      if (error) throw new Error(error.message);
      const email = {
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
      return {
        content: [{ type: 'text', text: JSON.stringify(email, null, 2) }],
      };
    },
  );

  server.registerTool(
    'send_email',
    {
      title: 'Send email',
      description: `Send an email from ${fromAddress}. Pass reply_to_email_id to thread the reply with an inbound email.`,
      inputSchema: {
        to: z.string().describe('Recipient address or comma-separated list'),
        subject: z.string(),
        body: z.string().describe('Plain text body'),
        html: z.string().optional().describe('Optional HTML body'),
        reply_to_email_id: z.string().optional().describe('Inbound email id to reply to (threads by In-Reply-To)'),
      },
    },
    async ({ to, subject, body, html, reply_to_email_id }) => {
      const headers: Record<string, string> = {};
      let finalSubject = subject;
      if (reply_to_email_id) {
        const { data: original, error: fetchErr } =
          await resend.emails.receiving.get(reply_to_email_id);
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
        from: fromAddress,
        to: to.split(',').map((s) => s.trim()),
        subject: finalSubject,
        text: body,
        html,
        headers: Object.keys(headers).length ? headers : undefined,
      });
      if (error) throw new Error(error.message);
      return {
        content: [{ type: 'text', text: `sent: ${data?.id}` }],
      };
    },
  );

  return server;
}

async function handle(req: Request) {
  if (!authOk(req)) return notFound();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  const server = buildServer();
  await server.connect(transport);
  return transport.handleRequest(req);
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
