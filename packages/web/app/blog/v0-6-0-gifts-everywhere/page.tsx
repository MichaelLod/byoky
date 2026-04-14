import Link from 'next/link';
import type { Metadata } from 'next';
import { getPost, formatDate } from '../posts';
import { postStyles } from '../post-styles';

const post = getPost('v0-6-0-gifts-everywhere')!;

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
            A Byoky gift is a link. You send it; the recipient pastes it into their wallet; they
            call an LLM; your key never leaves your wallet. Your extension is the proxy. Budget
            and expiry are enforced there. You can revoke it at any time.
          </p>

          <p>That model has had two limits since we shipped it:</p>

          <ol>
            <li>
              <strong>Only the browser extension could host gifts.</strong> If your wallet lived
              on your phone, you couldn&rsquo;t gift from it.
            </li>
            <li>
              <strong>A gift locked the recipient to one provider family.</strong> Gift an
              Anthropic key, they could only write Anthropic. Switching providers meant switching
              gifts.
            </li>
          </ol>

          <p>v0.6.0 removes both.</p>

          <h2>Your phone is a gift host now</h2>
          <p>
            iOS and Android wallets ship a gift relay host of their own. Open the wallet, create
            a gift, share the link &mdash; same flow as the extension, but now your phone is the
            proxy. Two consequences:
          </p>
          <ul>
            <li>
              <strong>You can gift from a phone-only setup.</strong> No browser, no desktop
              install, no &ldquo;wait, let me boot up the laptop.&rdquo;
            </li>
            <li>
              <strong>Phones stay online longer than laptops.</strong> Your recipient&rsquo;s
              gift keeps working overnight while your MacBook lid is closed &mdash; your phone is
              still reachable.
            </li>
          </ul>
          <p>
            Combined with relay connect, the full round trip can now be{' '}
            <em>recipient&rsquo;s laptop &rarr; relay &rarr; your phone &rarr; LLM API</em>. The
            key never leaves your pocket.
          </p>

          <h2>Gifts translate across provider families</h2>
          <p>
            A gift used to carry one credential to one provider family. Recipient wrote Anthropic
            SDK, the gift key was Anthropic, done.
          </p>
          <p>
            In v0.6.0, cross-provider translation runs inside the gift relay. Gift an OpenAI key
            to someone who prefers the Claude Messages SDK &mdash; the sender&rsquo;s wallet
            translates both directions: Messages request &rarr; Chat Completions, GPT response
            &rarr; Messages shape, streaming included. The recipient&rsquo;s code doesn&rsquo;t
            change.
          </p>
          <p>
            Gift one credential, serve any SDK. The recipient picks whichever provider SDK they
            already use; the sender&rsquo;s wallet routes and rewrites.
          </p>

          <h2>Bridge proxy can use gifted credentials</h2>
          <p>
            The bridge (<code>@byoky/bridge</code>) exposes your wallet as a localhost HTTP proxy
            for CLI tools and desktop apps &mdash; OpenClaw, scripts, anything that speaks HTTP.
            Before v0.6.0, the bridge only used your own keys. Now it routes gifted credentials
            too, through the relay, back to the sender&rsquo;s wallet.
          </p>
          <p>
            If someone gifts you access to their Claude Pro/Max setup token, you can use that
            from the CLI through the bridge. No sharing of the token itself. Sender revokes at
            any time.
          </p>

          <h2>Also in this release</h2>
          <ul>
            <li>
              <strong>Unified onboarding.</strong> Welcome, vault authentication, and setup are
              one screen now, with an explicit &ldquo;create account&rdquo; vs &ldquo;sign
              in&rdquo; switch. Less &ldquo;what step am I on&rdquo; confusion on first install.
            </li>
            <li>
              <strong>
                <a
                  href="https://chat.byoky.com"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  chat.byoky.com
                </a>
                .
              </strong>{' '}
              A chat interface that runs on your own wallet. Pick a provider, pick a model, chat.
              No account, no server, just your key.
            </li>
            <li>
              <strong>Auto-connect for embedded apps.</strong> Apps launched inside the iOS
              WebView connect to the host wallet automatically, no pairing step.
            </li>
            <li>
              <strong>Android polish.</strong> Adaptive launcher icon, themed splash screen,
              reliable mascot animation.
            </li>
          </ul>

          <h2>Versions</h2>
          <div className="blog-post-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Surface</th>
                  <th>Version</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>npm packages</td>
                  <td>
                    <code>0.6.0</code>
                  </td>
                </tr>
                <tr>
                  <td>Chrome / Firefox / Safari</td>
                  <td>
                    <code>0.6.0</code>
                  </td>
                </tr>
                <tr>
                  <td>iOS / macOS</td>
                  <td>
                    <code>1.0.15</code> (build 18)
                  </td>
                </tr>
                <tr>
                  <td>Android</td>
                  <td>
                    <code>1.0.15</code> (build 18)
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="blog-cta">
            <div className="blog-cta-label">Get started</div>
            <h3>Install the wallet, gift a credential, try it from the CLI</h3>
            <p>
              The wallet runs on Chrome, Firefox, iOS, and Android. Gifts now flow from any of
              them, into any SDK, through any surface.
            </p>
            <Link href="/" className="blog-cta-button">
              Install Byoky &rarr;
            </Link>
          </div>

          <p>
            Full release notes and downloadable artifacts are on{' '}
            <a
              href="https://github.com/MichaelLod/byoky/releases/tag/v0.6.0"
              target="_blank"
              rel="noopener noreferrer"
            >
              GitHub
            </a>
            .
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
