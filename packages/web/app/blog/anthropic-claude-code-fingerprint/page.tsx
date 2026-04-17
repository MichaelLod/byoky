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
          <div className="blog-post-note" style={{
            padding: '16px 20px',
            borderLeft: '3px solid var(--teal-light)',
            background: 'rgba(255,255,255,0.03)',
            marginBottom: '24px',
            fontSize: '14px',
            lineHeight: 1.6,
          }}>
            <strong>A note on terms before we start.</strong> Anthropic&rsquo;s Consumer Terms
            restrict how OAuth tokens from Claude Free, Pro, and Max plans may be used, and the
            Commercial Terms have their own rules for API access. This post is a technical note
            about API routing behavior. It is not an invitation to use any credential in a way
            that is not permitted by the issuing provider&rsquo;s terms. Before wiring a
            subscription token into any tool, check whether your plan actually allows that usage.
          </div>

          <p>
            If you have a Claude.ai Pro or Max subscription, you can run{' '}
            <code>claude setup-token</code> and get a token that looks like{' '}
            <code>sk-ant-oat01-...</code>. Anthropic&rsquo;s docs call it a setup token. It&rsquo;s
            an OAuth access token, scoped to the Claude Code CLI, billed against your existing
            plan when used in the way Anthropic intends.
          </p>

          <p>
            Out of curiosity I tried sending the same token from{' '}
            <a href="https://openclaw.ai" target="_blank" rel="noopener noreferrer">
              OpenClaw
            </a>
            &rsquo;s agent loop instead of from Claude Code itself. Same token, same Anthropic
            API endpoint, same model. Different agent framework on top.
          </p>

          <p>The response was not what I expected.</p>

          <pre>
            <code>{`HTTP 400 invalid_request_error
"Third-party apps now draw from your extra usage, not your plan limits.
We've added a $200 credit to get you started. Claim it at
claude.ai/settings/usage and keep going."`}</code>
          </pre>

          <p>
            The token authenticates fine. But Anthropic&rsquo;s API distinguishes this request
            from a Claude Code request and routes it to a separate extra-usage credit pool.
            That&rsquo;s a reasonable business decision on Anthropic&rsquo;s part — first-party
            and third-party traffic are different products with different economics. What
            surprised me was that the token alone isn&rsquo;t the signal; the request shape is.
            I wanted to understand which parts of the shape carried the signal.
          </p>

          <h2>Headers are one layer, but not the whole story</h2>
          <p>
            Anthropic&rsquo;s public SDK and CLI send a specific set of identifying headers
            (User-Agent, beta flags, and similar metadata). In a quick test, matching those
            headers alone wasn&rsquo;t sufficient — the request body also factors into whether
            the API treats a call as first-party subscription traffic. So I moved on from
            headers and looked at the body.
          </p>

          <h2>The body carries more than the payload</h2>
          <p>
            OpenClaw&rsquo;s request body is dense — 21 tools, a long conversation history, and
            a large system prompt. I removed fields one at a time to see what the API weighed in
            the first-party / extra-usage decision. Two areas jumped out: the{' '}
            <code>tools</code> array and the <code>system</code> field. Everything else I tried
            (conversation history length, auxiliary fields) didn&rsquo;t change the outcome on
            its own.
          </p>

          <h2>Tool naming conventions</h2>
          <p>
            Claude Code&rsquo;s tool vocabulary follows a distinctive style — a small set of
            capitalized names like <code>Read</code>, <code>Edit</code>, <code>Bash</code>,{' '}
            <code>Grep</code>. Third-party agent frameworks usually pick their own naming
            conventions, often snake_case or lowercase. On the requests I observed, the naming
            convention of the tool set was one factor the API appeared sensitive to.
          </p>

          <h2>System-field content</h2>
          <p>
            The <code>system</code> field content was the second factor. This wasn&rsquo;t
            simple keyword matching — swapping brand names one-for-one didn&rsquo;t change the
            outcome. The signal looked more like a content classifier reacting to the overall
            shape and style of a non-first-party system prompt. I&rsquo;m not going to publish
            the specific boundaries I observed; it&rsquo;s not the point of this post, and
            those boundaries are Anthropic&rsquo;s to tune.
          </p>
          <p>
            What I took away from the experiment is that the API&rsquo;s classification layer
            is doing real work, and it&rsquo;s reasonable that Anthropic puts effort into
            keeping subscription economics distinct from third-party economics.
          </p>

          <h2>What this means for users with legitimate workflows</h2>
          <p>
            For most people this is invisible — you use Claude Code, it bills your plan, you
            move on. The surprise happens when a workflow that Anthropic permits (for example,
            a locally-running bridge or SDK that communicates with the Claude API on your
            behalf under a permitted usage pattern) gets classified as third-party on the basis
            of incidental request-shape differences rather than anything about the actual use.
          </p>
          <p>
            Before wiring any setup token into a workflow other than Claude Code itself, read
            Anthropic&rsquo;s{' '}
            <a href="https://www.anthropic.com/legal/consumer-terms" target="_blank" rel="noopener noreferrer">Consumer Terms</a>{' '}
            and{' '}
            <a href="https://www.anthropic.com/legal/aup" target="_blank" rel="noopener noreferrer">Usage Policy</a>{' '}
            and confirm that what you&rsquo;re about to do is permitted. If it isn&rsquo;t, use
            a standard API key on the Commercial Terms instead — that&rsquo;s what Anthropic
            offers for programmatic usage.
          </p>

          <h2>Where Byoky fits in</h2>
          <p>
            Byoky is an encrypted wallet for your AI API keys and OAuth tokens. For workflows
            that are permitted under the issuing provider&rsquo;s terms, Byoky provides a
            compatibility layer that takes care of the header conventions and request-shape
            conventions the provider&rsquo;s own SDK uses. The goal is that a permitted request
            bills the way a permitted request is supposed to bill, without the user needing to
            understand the conventions.
          </p>
          <p>
            Byoky does not help you use a credential in a way its issuing provider forbids. You
            remain responsible for ensuring your usage complies with your provider&rsquo;s
            terms — see Byoky&rsquo;s{' '}
            <Link href="/terms">Terms of Use</Link> for the full set of user obligations.
          </p>
          <div className="blog-cta">
            <div className="blog-cta-label">For compliant OpenClaw + Anthropic workflows</div>
            <h3>The 5-minute Byoky + OpenClaw guide</h3>
            <p>
              Install the wallet, add your credential, point OpenClaw at the local bridge.
              Before you do: confirm your intended usage is permitted by the credential&rsquo;s
              issuing provider.
            </p>
            <Link href="/openclaw" className="blog-cta-button">
              Open the OpenClaw guide &rarr;
            </Link>
          </div>
          <p>
            If you&rsquo;d rather see the full picture first, the <Link href="/docs">docs</Link>{' '}
            walk through the proxy model, and <Link href="/">byoky.com</Link> is the short version.
          </p>
          <p>
            <em>&mdash; Michael</em>
          </p>
        </div>
      </article>

      <style>{postStyles}</style>
    </div>
  );
}
