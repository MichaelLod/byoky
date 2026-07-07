import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { MAIL_FROM_ADDRESS, listInbox, readEmail, sendEmail } from '@/lib/mail';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
  const fromAddress = MAIL_FROM_ADDRESS;

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
      const items = await listInbox(limit ?? 20);
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
      const email = await readEmail(id);
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
      const { id } = await sendEmail({ to, subject, body, html, replyToEmailId: reply_to_email_id });
      return {
        content: [{ type: 'text', text: `sent: ${id}` }],
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
