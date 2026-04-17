import Link from 'next/link';
import type { Metadata } from 'next';
import { getPost, formatDate } from '../posts';
import { postStyles } from '../post-styles';

const post = getPost('anthropic-claude-code-fingerprint')!;

export const metadata: Metadata = {
  title: `${post.title} — Byoky`,
  description: post.description,
  alternates: { canonical: `/blog/${post.slug}` },
  openGraph: {
    title: post.ogTitle ?? post.title,
    description: post.ogDescription ?? post.description,
    type: 'article',
    publishedTime: post.date,
    authors: [post.author],
    tags: post.tags,
    images: [
      {
        url: post.image,
        width: 1200,
        height: 630,
        alt: post.imageAlt,
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: post.ogTitle ?? post.title,
    description: post.ogDescription ?? post.description,
    images: [post.image],
  },
};

export default function Post() {
  return (
    <div className="blog-post-layout">
      <article className="blog-post">
        <Link href="/blog" className="blog-post-back">
          ← Back to blog
        </Link>

        <header className="blog-post-header">
          <div className="blog-post-tags">
            {post.tags.map((tag) => (
              <span key={tag} className="blog-post-tag">
                {tag}
              </span>
            ))}
          </div>
          <h1>{post.title}</h1>
          <div className="blog-post-meta">
            <span>{post.author}</span>
            <span className="blog-post-dot">·</span>
            <time dateTime={post.date}>{formatDate(post.date)}</time>
            <span className="blog-post-dot">·</span>
            <span>{post.readTime}</span>
          </div>
        </header>

        <figure className="blog-post-hero">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={post.image} alt={post.imageAlt} width={1200} height={630} />
        </figure>

        <div className="blog-post-body">
          <p>
            If you have a Claude.ai Pro or Max subscription, you can run{' '}
            <code>claude setup-token</code> and get a token that looks like{' '}
            <code>sk-ant-oat01-...</code>. Anthropic&rsquo;s docs call it a setup token.
            It&rsquo;s an OAuth access token, scoped to the Claude Code CLI, billed against
            your existing plan. No extra usage charges. No &ldquo;what&rsquo;s my burn rate
            this month&rdquo; anxiety.
          </p>

          <p>
            So I tried to use it from{' '}
            <a href="https://openclaw.ai" target="_blank" rel="noopener noreferrer">OpenClaw</a>{' '}
            instead of Claude Code itself. Same token, same Anthropic API endpoint, same model.
            Different agent framework on top.
          </p>

          <p>Anthropic said no.</p>

          <pre>
            <code>{`HTTP 400 invalid_request_error
"Third-party apps now draw from your extra usage, not your plan limits.
We've added a $200 credit to get you started. Claim it at
claude.ai/settings/usage and keep going."`}</code>
          </pre>

          <p>
            The token authenticates fine. But Anthropic somehow knows this isn&rsquo;t Claude
            Code, and routes the request to a separate &ldquo;extra usage&rdquo; credit pool.
          </p>

          <p>
            I wanted to know exactly <em>how</em> they know. So I spent an evening bisecting it.
          </p>

          <h2>The obvious things don&rsquo;t work</h2>
          <p>
            The first thing anyone tries is matching Claude Code&rsquo;s HTTP headers. Claude
            Code&rsquo;s CLI sends:
          </p>
          <pre>
            <code>{`User-Agent: claude-cli/2.1.76
x-app: cli
anthropic-beta: claude-code-20250219,oauth-2025-04-20,fine-grained-tool-streaming-2025-05-14,interleaved-thinking-2025-05-14
anthropic-dangerous-direct-browser-access: true`}</code>
          </pre>
          <p>
            Set those headers, send the same body Claude Code would send &rarr; success. Set
            them and send OpenClaw&rsquo;s body &rarr; 400, third-party billing wall.
          </p>
          <p>So it&rsquo;s not just headers. Anthropic is also looking at the request body.</p>

          <h2>Bisecting the body</h2>
          <p>
            OpenClaw&rsquo;s request body is dense &mdash; 21 tools, 57 messages of conversation
            history, a 44KB system prompt, plus <code>thinking</code> and{' '}
            <code>output_config</code> fields. Total payload around 115KB. Plenty of places for
            a signal to hide.
          </p>
          <p>I started removing fields one at a time:</p>

          <div className="blog-post-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Variant</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Remove <code>output_config</code></td>
                  <td>Still 400</td>
                </tr>
                <tr>
                  <td>Remove <code>thinking</code></td>
                  <td>Still 400</td>
                </tr>
                <tr>
                  <td>Drop conversation history (1 message instead of 57)</td>
                  <td>Still 400</td>
                </tr>
                <tr>
                  <td>Drop tools (0 tools instead of 21)</td>
                  <td><strong>200 OK</strong></td>
                </tr>
                <tr>
                  <td>Drop system prompt entirely</td>
                  <td><strong>200 OK</strong></td>
                </tr>
              </tbody>
            </table>
          </div>

          <p>
            Two independent triggers. Either the tools array or the system prompt was enough
            to flunk the check on its own. Anthropic isn&rsquo;t fingerprinting one thing —
            they&rsquo;re fingerprinting several, and any one of them misfiring is enough.
          </p>

          <h2>The tools array has a vocabulary</h2>
          <p>
            The tools array was the easier one to diagnose. OpenClaw&rsquo;s tools are named{' '}
            <code>read</code>, <code>edit</code>, <code>write</code>, <code>exec</code>,{' '}
            <code>process</code>, <code>cron</code>, <code>sessions_spawn</code>,{' '}
            <code>web_search</code>, <code>memory_get</code>, &hellip; Lowercase, snake_case,
            very framework-specific.
          </p>
          <p>
            Claude Code&rsquo;s tool list is something else: <code>Read</code>, <code>Edit</code>,{' '}
            <code>Write</code>, <code>Bash</code>, <code>Glob</code>, <code>Grep</code>,{' '}
            <code>Task</code>, <code>TodoWrite</code>, <code>WebFetch</code>,{' '}
            <code>WebSearch</code>, <code>NotebookEdit</code>. PascalCase. A specific
            vocabulary.
          </p>
          <p>
            On the traffic I tested, the naming style of the tools array was one of the signals
            the API reacted to — not the descriptions, not the schemas, just the names as a
            set. A linguistic tell. Claude Code&rsquo;s tool vocabulary is small, stylistically
            distinctive, and apparently part of the billing decision.
          </p>

          <h2>The system prompt signal</h2>
          <p>
            The system prompt was the weirder one. OpenClaw&rsquo;s is 44KB of agent persona,
            runtime context, memory rules, heartbeat protocols, and 100+ literal mentions of
            &ldquo;OpenClaw&rdquo; or &ldquo;openclaw.&rdquo; My first hypothesis was the
            obvious one: Anthropic is grepping for the brand name.
          </p>
          <p>
            I tried it. Replaced every case-insensitive occurrence of &ldquo;openclaw&rdquo;
            with &ldquo;claude&rdquo; in the system text. Same request otherwise.{' '}
            <strong>Still 400.</strong>
          </p>
          <p>
            So it&rsquo;s not literal string matching. The classifier is looking at{' '}
            <em>content patterns</em>, not specific tokens.
          </p>
          <p>
            I went back to bisecting, truncating the system prompt at progressively smaller
            lengths. The verdict flipped sharply between two prompt lengths a handful of
            characters apart, which was tempting to chase by exact character position — but
            that turned out to be a red herring. There are several signals firing in the same
            neighborhood, not one clean tripwire. Whatever the exact machinery is, the
            classifier is content-based. Probably ML. Definitely not regex.
          </p>
          <p>
            I&rsquo;ll stop short of publishing the exact boundaries I found. The point
            isn&rsquo;t to draw a map. The point is that Anthropic&rsquo;s classifier is
            doing real work, it&rsquo;s clearly the product of someone who thought carefully
            about the problem, and string matches that are trivially defeated were never going
            to be it.
          </p>

          <h2>So what did we learn?</h2>
          <p>Anthropic&rsquo;s third-party detection is at least three layers deep:</p>
          <ol>
            <li>
              <strong>Headers</strong> &mdash; necessary, not sufficient.{' '}
              <code>claude-cli/2.1.76</code> and the <code>claude-code-20250219</code> beta flag
              are the entry ticket.
            </li>
            <li>
              <strong>Tool names</strong> &mdash; Claude Code&rsquo;s canonical PascalCase tool
              vocabulary. Lowercase or snake_case names read as third-party.
            </li>
            <li>
              <strong>System content</strong> &mdash; the <code>system</code> field is inspected
              by what looks like a content classifier, not literal pattern matching. Long
              agent-framework prompts are flagged even when brand markers are stripped.
            </li>
          </ol>
          <p>
            This is, of course, an arms race. Anthropic can update the classifier tomorrow. The
            rules will keep getting tighter. Which is completely their prerogative — the bits
            on the wire belong to the owner of the API.
          </p>

          <h2>Where that leaves you, and where Byoky fits in</h2>
          <p>
            If you&rsquo;re running OpenClaw (or any other agent framework) and hitting the
            third-party billing wall against your Claude plan, there are two honest paths.
          </p>
          <p>
            <strong>The boring, supported one:</strong> get a standard Anthropic API key under
            their Commercial Terms. Third-party software is explicitly allowed there. It bills
            per-token rather than flat-rate, but nothing in this post is trying to talk you out
            of that — it&rsquo;s the path Anthropic built for exactly this use case, and it
            Just Works.
          </p>
          <p>
            <strong>The other one</strong> is using your subscription through a wallet that
            handles the SDK-shaped request conventions on your behalf. That&rsquo;s what Byoky
            does. Byoky is an encrypted wallet for your AI keys and OAuth tokens; you drop your
            credential in, connect OpenClaw to it, and the wallet proxies every request with the
            compatibility layer applied so your supported workflows behave the way the
            provider&rsquo;s own SDK would behave. It&rsquo;s a wallet, not a loophole — and
            whether your specific usage is permitted by your specific provider&rsquo;s terms is
            on you to check.
          </p>
          <p>
            Before wiring any subscription token into any tool, read Anthropic&rsquo;s{' '}
            <a href="https://www.anthropic.com/legal/consumer-terms" target="_blank" rel="noopener noreferrer">Consumer Terms</a>{' '}
            and{' '}
            <a href="https://www.anthropic.com/legal/aup" target="_blank" rel="noopener noreferrer">Usage Policy</a>.
            Byoky&rsquo;s own{' '}
            <Link href="/terms">Terms of Use</Link>{' '}
            are explicit that you remain responsible for complying with each provider&rsquo;s
            rules. We&rsquo;ll make the wallet work; you decide whether the workflow is one you
            have the right to run.
          </p>
          <div className="blog-cta">
            <div className="blog-cta-label">OpenClaw users, start here</div>
            <h3>The 5-minute Byoky + OpenClaw guide</h3>
            <p>
              Step-by-step install for Chrome, Firefox, iOS and Android, plus the exact OpenClaw
              config to point at the Byoky bridge.
            </p>
            <Link href="/openclaw" className="blog-cta-button">
              Open the OpenClaw guide &rarr;
            </Link>
          </div>
          <p>
            If you&rsquo;d rather see the full picture first, the{' '}
            <Link href="/docs">docs</Link> walk through the proxy model, and{' '}
            <Link href="/">byoky.com</Link> is the short version.
          </p>
          <p>
            Every fingerprinting layer is a learning opportunity about how a provider thinks
            about pricing. Tonight I learned Anthropic looks at tool vocabularies and system
            content. The broader lesson is the one this whole ecosystem is stumbling into
            together: a token used to be a bearer instrument, and now it&rsquo;s a
            context-sensitive object whose value depends on which binary is holding it when it
            hits the server.
          </p>
          <p>
            <em>&mdash; Michael 🇦🇹</em>
          </p>
        </div>
      </article>

      <style>{postStyles}</style>
    </div>
  );
}
