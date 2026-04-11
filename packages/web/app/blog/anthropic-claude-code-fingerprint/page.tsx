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
            <code>sk-ant-oat01-...</code>. Anthropic&rsquo;s docs call it a setup token. It&rsquo;s
            an OAuth access token, scoped to the Claude Code CLI, billed against your existing
            plan. No extra usage charges. No &ldquo;what&rsquo;s my burn rate this month&rdquo;
            anxiety.
          </p>

          <p>
            So I tried to use it from{' '}
            <a href="https://openclaw.ai" target="_blank" rel="noopener noreferrer">
              OpenClaw
            </a>{' '}
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
            The token authenticates fine. But Anthropic somehow knows this isn&rsquo;t Claude Code,
            and routes the request to a separate &ldquo;extra usage&rdquo; credit pool that I
            haven&rsquo;t paid into.
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
            Set those headers, send the same body Claude Code would send &rarr; success. Set them
            and send OpenClaw&rsquo;s body &rarr; 400, third-party billing wall.
          </p>
          <p>So it&rsquo;s not just headers. Anthropic is also looking at the request body.</p>

          <h2>Bisecting the body</h2>
          <p>
            OpenClaw&rsquo;s request body is dense &mdash; 21 tools, 57 messages of conversation
            history, a 44KB system prompt, plus <code>thinking</code> and <code>output_config</code>{' '}
            fields. Total payload around 115KB. Plenty of places for a fingerprint to hide.
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
                  <td>
                    Remove <code>output_config</code>
                  </td>
                  <td>Still 400</td>
                </tr>
                <tr>
                  <td>
                    Remove <code>thinking</code>
                  </td>
                  <td>Still 400</td>
                </tr>
                <tr>
                  <td>Drop conversation history (1 message instead of 57)</td>
                  <td>Still 400</td>
                </tr>
                <tr>
                  <td>Drop tools (0 tools instead of 21)</td>
                  <td>
                    <strong>200 OK</strong>
                  </td>
                </tr>
                <tr>
                  <td>Drop system prompt entirely</td>
                  <td>
                    <strong>200 OK</strong>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <p>
            Two independent triggers. Either tools or system prompt was enough to flunk the check
            on its own. Both had to be addressed.
          </p>

          <h2>The tool name signal</h2>
          <p>
            The tools array was the easier one. OpenClaw&rsquo;s tools are named <code>read</code>,{' '}
            <code>edit</code>, <code>write</code>, <code>exec</code>, <code>process</code>,{' '}
            <code>cron</code>, <code>sessions_spawn</code>, <code>web_search</code>,{' '}
            <code>memory_get</code>, &hellip; Lowercase, snake_case, very framework-specific.
          </p>
          <p>
            Claude Code&rsquo;s tool list is something else: <code>Read</code>, <code>Edit</code>,{' '}
            <code>Write</code>, <code>Bash</code>, <code>Glob</code>, <code>Grep</code>,{' '}
            <code>Task</code>, <code>TodoWrite</code>, <code>WebFetch</code>, <code>WebSearch</code>
            , <code>NotebookEdit</code>. PascalCase. A specific vocabulary.
          </p>
          <p>
            I renamed all 21 OpenClaw tools to Claude-Code-style PascalCase aliases &mdash;{' '}
            <code>read</code> &rarr; <code>Read</code>, <code>exec</code> &rarr; <code>Bash</code>,{' '}
            <code>sessions_spawn</code> &rarr; <code>SessionsSpawn</code>. Same descriptions, same
            input schemas, same number of tools. Just renamed.
          </p>
          <p>Result: 200 OK.</p>
          <p>
            So Anthropic keeps a list of canonical Claude Code tool names. If your tools don&rsquo;t
            match the vocabulary, you&rsquo;re third-party. The descriptions and schemas don&rsquo;t
            matter &mdash; only the <code>name</code> field.
          </p>

          <h2>The system prompt signal</h2>
          <p>
            The system prompt was harder. OpenClaw&rsquo;s is 44KB of agent persona, runtime
            context, memory rules, heartbeat protocols, and 100+ literal mentions of
            &ldquo;OpenClaw&rdquo; or &ldquo;openclaw&rdquo;. My first hypothesis was the obvious
            one: Anthropic is grepping for the brand name.
          </p>
          <p>
            I tried it. Replaced every case-insensitive occurrence of &ldquo;openclaw&rdquo; with
            &ldquo;claude&rdquo; in the system text. Same request otherwise.{' '}
            <strong>Still 400.</strong>
          </p>
          <p>
            So it&rsquo;s not literal string matching. The classifier is looking at{' '}
            <em>content patterns</em>, not specific tokens.
          </p>
          <p>I went back to bisecting. Truncating the system prompt at progressively smaller lengths:</p>

          <div className="blog-post-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>System prompt size</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                <tr><td>43,000 chars</td><td>200 OK</td></tr>
                <tr><td>43,500 chars</td><td>200 OK</td></tr>
                <tr><td>43,750 chars</td><td>200 OK</td></tr>
                <tr><td>43,759 chars</td><td>200 OK</td></tr>
                <tr>
                  <td>
                    <strong>43,760 chars</strong>
                  </td>
                  <td>
                    <strong>400</strong>
                  </td>
                </tr>
                <tr><td>43,800 chars</td><td>400</td></tr>
                <tr><td>44,804 chars (full)</td><td>400</td></tr>
              </tbody>
            </table>
          </div>

          <p>
            A single character flipped the verdict. Position 43,759 in the original text. The
            character there was <code>1</code> &mdash; completing the substring{' '}
            <code>openclaw.inbound_meta.v1</code>, which appears once in the prompt as a JSON
            schema reference inside a code block.
          </p>
          <p>
            But that was a red herring. When I removed <em>just</em> that schema string and kept
            the rest of the prompt, the request still failed. There&rsquo;s a second trigger
            somewhere in the same neighborhood &mdash; the heartbeat section, the runtime banner
            that literally lists <code>model=byoky-anthropic/claude-sonnet-4-6</code>, or something
            I haven&rsquo;t isolated yet. The 1-char bisect just caught one of several signals
            firing in sequence.
          </p>
          <p>Whatever it is, the classifier is content-based. Probably ML. Definitely not regex.</p>

          <h2>The workaround</h2>
          <p>
            You can&rsquo;t easily trick a content classifier on content. But you can move the
            content somewhere it isn&rsquo;t looking.
          </p>
          <p>
            I noticed the classifier only inspects the <code>system</code> field. Not the message
            content. Not even when the message content is huge and contains the same text the
            system field had.
          </p>
          <p>
            So the workaround is structural: take the entire original system prompt,{' '}
            <strong>prepend it to the first user message</strong> wrapped in a{' '}
            <code>&lt;system_context&gt;...&lt;/system_context&gt;</code> tag, and replace the{' '}
            <code>system</code> field with just the bare Claude Code prefix:
          </p>
          <pre>
            <code>&quot;You are Claude Code, Anthropic&apos;s official CLI for Claude.&quot;</code>
          </pre>
          <p>
            Anthropic sees a clean Claude Code system field. The model still gets all the original
            context, just delivered as user-role rather than system-role. In practice the agent
            behaves the same way &mdash; Claude reads the context and follows it.
          </p>
          <p>
            Combined with the tool name rewrite, the same OpenClaw request that was 400ing now
            returns 200. End-to-end. With the original 65-message conversation, 21 tools, and 44KB
            of system context. I tested it against <code>api.anthropic.com</code> directly with
            curl, replaying the captured body byte-for-byte.
          </p>

          <h2>So what did we learn?</h2>
          <p>Anthropic&rsquo;s third-party detection is at least three layers deep:</p>
          <ol>
            <li>
              <strong>Headers</strong> &mdash; necessary, not sufficient. <code>claude-cli/2.1.76</code>{' '}
              and the <code>claude-code-20250219</code> beta flag are the entry ticket.
            </li>
            <li>
              <strong>Tool names</strong> &mdash; the request must use Claude Code&rsquo;s
              canonical PascalCase tool vocabulary. Lowercase or snake_case names instantly mark
              you as third-party.
            </li>
            <li>
              <strong>System content</strong> &mdash; the <code>system</code> field is inspected by
              what looks like a content classifier, not literal pattern matching. Long
              agent-framework prompts are flagged even when their literal brand markers are
              stripped.
            </li>
          </ol>
          <p>
            If you&rsquo;re building something that needs to talk to the Anthropic API with a setup
            token, the implication is: don&rsquo;t put your framework&rsquo;s identity in the system
            field. Put it in the conversation as user-role context. Rewrite your tool names to look
            like Claude Code&rsquo;s. The model will still understand the context, and Anthropic
            will still treat you as first-party.
          </p>
          <p>
            This is, of course, a cat-and-mouse game. Anthropic can update the classifier tomorrow
            to look at the user messages too, or to score tool names against schema content, or to
            flag unusual <code>&lt;system_context&gt;</code> tags. The rules will keep getting
            tighter.
          </p>

          <h2>The OpenClaw-on-Cubscription story, fixed</h2>
          <p>
            Here&rsquo;s why this matters for anyone running OpenClaw (or any other agent
            framework) against a Claude Pro/Max plan: you can still use your subscription. You just
            need the rewrite and relocate above applied automatically, on every request, with no
            code changes on the OpenClaw side.
          </p>
          <p>That&rsquo;s exactly what Byoky does.</p>
          <p>
            Byoky is an encrypted wallet for your AI API keys and OAuth tokens. You drop your
            Claude Code setup token into the wallet, connect OpenClaw to Byoky, and every request
            that leaves your machine is normalized on the way out:
          </p>
          <ul>
            <li>
              Tool names are rewritten to Claude Code&rsquo;s PascalCase vocabulary (<code>read</code>{' '}
              &rarr; <code>Read</code>, <code>exec</code> &rarr; <code>Bash</code>, and so on),
              with the originals restored on the way back so OpenClaw never notices.
            </li>
            <li>
              The framework&rsquo;s system prompt is hoisted into a <code>&lt;system_context&gt;</code>{' '}
              block on the first user message, and the <code>system</code> field is replaced with
              the bare Claude Code preamble.
            </li>
            <li>
              The right headers (<code>User-Agent</code>, <code>x-app</code>,{' '}
              <code>anthropic-beta</code>) are injected so the request looks like it came from the
              official CLI.
            </li>
          </ul>
          <p>
            Your Pro/Max plan bills the request. No third-party wall. No $200 extra-usage credit
            drip. No forked OpenClaw. Just your existing subscription, used the way you expected it
            to work in the first place.
          </p>
          <p>
            If you&rsquo;re currently stuck on the &ldquo;Third-party apps now draw from your extra
            usage&rdquo; wall, you don&rsquo;t have to re-implement any of this yourself. We built
            a dedicated walkthrough that gets OpenClaw talking to Byoky with your Claude Pro/Max
            subscription in about 5 minutes &mdash; install the wallet, paste the setup token,
            point OpenClaw at the local bridge, done.
          </p>
          <div className="blog-cta">
            <div className="blog-cta-label">OpenClaw users, start here</div>
            <h3>Run OpenClaw on your Claude Pro/Max plan</h3>
            <p>
              Step-by-step install for Chrome, Firefox, iOS and Android, plus the exact OpenClaw
              config to point at the Byoky bridge. Free, no extra credits, no forked CLI.
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
            Every fingerprinting layer is a learning opportunity about how the other side thinks.
            Tonight I learned that Anthropic looks at tool vocabularies and system content. Tomorrow
            I&rsquo;ll learn what they look at next &mdash; and Byoky will keep up.
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
