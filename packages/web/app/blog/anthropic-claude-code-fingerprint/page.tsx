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
            I have a Claude Pro subscription. It costs me €20 a month. In exchange I get a
            setup token — <code>claude setup-token</code>, it prints something that starts with{' '}
            <code>sk-ant-oat01-</code> — and Anthropic&rsquo;s docs say the token is billed
            against my existing plan.
          </p>

          <p>
            So on a Tuesday evening I did the obvious thing: I took my setup token, pointed{' '}
            <a href="https://openclaw.ai" target="_blank" rel="noopener noreferrer">OpenClaw</a>{' '}
            at <code>api.anthropic.com</code>, and hit send. Same token. Same endpoint. Same
            model. Different agent framework driving it.
          </p>

          <p>Anthropic&rsquo;s reply:</p>

          <pre>
            <code>{`HTTP 400 invalid_request_error
"Third-party apps now draw from your extra usage, not your plan limits.
We've added a $200 credit to get you started. Claim it at
claude.ai/settings/usage and keep going."`}</code>
          </pre>

          <p>
            A $200 credit. To use my own token. On my own plan. Sent from a different binary.
          </p>

          <p>
            Which is, to be clear, entirely within Anthropic&rsquo;s rights — they get to decide
            what their subscription covers and what lives in a separate billing bucket. Honestly
            the split makes sense as a business: running an agent loop 24/7 looks very different
            from a human typing into Claude Code. But it still felt off that a valid token
            routed to two totally different worlds based on something other than the token
            itself. So I spent the evening finding out which something.
          </p>

          <h2>Headers get you in the door. They don&rsquo;t pay the bill.</h2>
          <p>
            First thing anyone tries: match Claude Code&rsquo;s HTTP headers. Set{' '}
            <code>User-Agent</code>, the <code>anthropic-beta</code> flag, the{' '}
            <code>x-app</code> tag — the whole observable surface a network tap would see.
          </p>
          <p>
            Headers alone weren&rsquo;t enough. The same headers on top of OpenClaw&rsquo;s
            request body still got the third-party routing. Which told me Anthropic is reading
            further into the request than the envelope. Off to the body.
          </p>

          <h2>Bisecting 115 kilobytes of JSON</h2>
          <p>
            OpenClaw&rsquo;s request body is a beast — 21 tools, 57 messages of conversation
            history, a 44KB system prompt, plus <code>thinking</code> and{' '}
            <code>output_config</code> for good measure. Plenty of places for a signal to hide.
          </p>
          <p>I started pulling fields, one at a time, binary-search style:</p>

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
            Two independent signals. <code>tools</code> on its own could flunk the check.{' '}
            <code>system</code> on its own could flunk the check. Anthropic isn&rsquo;t
            fingerprinting one thing — they&rsquo;re fingerprinting several, and any one of
            them misfires is enough.
          </p>

          <h2>The tools array has a vocabulary</h2>
          <p>
            Claude Code&rsquo;s tools read like Emacs commands: <code>Read</code>,{' '}
            <code>Edit</code>, <code>Write</code>, <code>Bash</code>, <code>Grep</code>,{' '}
            <code>Task</code>, <code>TodoWrite</code>. PascalCase. Short. A specific dialect.
          </p>
          <p>
            Most third-party agent frameworks don&rsquo;t talk that way. They go lowercase,
            snake_case, descriptive — <code>read_file</code>, <code>run_shell_command</code>,{' '}
            <code>search_codebase</code>. It&rsquo;s a perfectly reasonable style; it just
            isn&rsquo;t Anthropic&rsquo;s style.
          </p>
          <p>
            On the traffic I tested, the naming convention of the <code>tools</code> array
            alone was one of the signals the API reacted to. Not the descriptions, not the
            schemas — the names themselves, as a set. A linguistic tell, effectively.
          </p>

          <h2>The system field is read by something that isn&rsquo;t grep</h2>
          <p>
            The <code>system</code> field was the weirder one. My first bet was the obvious
            one: Anthropic is grepping for the word &ldquo;OpenClaw.&rdquo; OpenClaw&rsquo;s
            prompt mentions its own name over a hundred times. So I did a find-and-replace,
            swapped every &ldquo;OpenClaw&rdquo; for &ldquo;Claude,&rdquo; and hit send.
          </p>
          <p>Still 400.</p>
          <p>
            So not string matching. Something more like a classifier, reacting to the shape
            and register of an agent-framework system prompt even with the brand-name
            evidence scrubbed. The truncation curve I got back was oddly sharp — the verdict
            flipped between two prompt lengths within a handful of characters of each other —
            but chasing the exact trigger by character count turned out to be a red herring:
            there were several signals firing in the same neighborhood, not one tripwire.
          </p>
          <p>
            I&rsquo;ll stop short of publishing the exact boundaries I found. The point
            isn&rsquo;t to draw a map for people to route around. The point is that
            Anthropic&rsquo;s classifier is doing real work, and it&rsquo;s clearly the
            product of someone who thought carefully about how to separate first-party
            from third-party traffic without relying on string matches that are trivially
            defeated.
          </p>

          <h2>Zooming out</h2>
          <p>
            This is the part where a different kind of blog post would tell you how to defeat
            the classifier. I&rsquo;m not going to do that. For two reasons.
          </p>
          <p>
            One: the more you pull on this thread, the more you&rsquo;re explicitly operating
            against Anthropic&rsquo;s billing design. Anthropic has been clear — including in
            their{' '}
            <a href="https://www.anthropic.com/legal/consumer-terms" target="_blank" rel="noopener noreferrer">Consumer Terms</a>{' '}
            and{' '}
            <a href="https://www.anthropic.com/legal/aup" target="_blank" rel="noopener noreferrer">Usage Policy</a>{' '}
            — that subscription tokens aren&rsquo;t meant to power arbitrary third-party
            software. If your use case really needs to run inside an agent framework, the
            product Anthropic offers for that is a normal API key on their Commercial Terms.
            Getting angry at a billing wall doesn&rsquo;t change the terms of the deal you
            signed.
          </p>
          <p>
            Two: the interesting question isn&rsquo;t how to get around this particular
            classifier. The interesting question is why the API ecosystem is starting to look
            like anti-cheat software. Anthropic isn&rsquo;t the first and won&rsquo;t be the
            last. OpenAI segments keys by product. Google splits paid and free in unusual
            ways across regions. Everyone is figuring out, in public, where &ldquo;same token,
            different client&rdquo; stops being the same thing.
          </p>
          <p>
            As a user this means one thing: the token in your hand is less and less a universal
            bearer instrument. It&rsquo;s a context-sensitive object, and its value depends on
            what binary is holding it when it talks to the server.
          </p>

          <h2>Where Byoky fits in (and where it doesn&rsquo;t)</h2>
          <p>
            Byoky is a wallet for your own LLM keys. It stores them encrypted, proxies
            requests, and for supported workflows it handles the SDK-shaped conventions
            (headers, tool naming, request shape) so the billing behaves the way the provider
            intends when the usage itself is permitted.
          </p>
          <p>
            What Byoky won&rsquo;t do: help you use a credential in a way the issuing provider
            forbids. If Anthropic&rsquo;s terms don&rsquo;t permit your plan&rsquo;s token in
            your workflow, Byoky isn&rsquo;t a loophole — it&rsquo;s a wallet. Read Byoky&rsquo;s{' '}
            <Link href="/terms">Terms of Use</Link> and the relevant provider&rsquo;s policy
            before you wire anything up.
          </p>
          <div className="blog-cta">
            <div className="blog-cta-label">For supported Anthropic workflows</div>
            <h3>The 5-minute Byoky + OpenClaw guide</h3>
            <p>
              Install the wallet, add your credential, point OpenClaw at the local bridge —
              once you&rsquo;ve confirmed your usage is permitted by the issuing provider.
            </p>
            <Link href="/openclaw" className="blog-cta-button">
              Open the OpenClaw guide &rarr;
            </Link>
          </div>
          <p>
            If you&rsquo;d rather see the big picture first, the <Link href="/docs">docs</Link>{' '}
            walk through the proxy model, and <Link href="/">byoky.com</Link> is the short
            version.
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
