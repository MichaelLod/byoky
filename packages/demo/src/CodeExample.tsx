export function CodeExample() {
  return (
    <div className="code-example">
      <h2>How this demo works</h2>
      <p className="code-desc">
        This entire app runs on your browser. API calls are proxied through the
        byoky extension — this page never sees your API keys.
      </p>

      <div className="code-window">
        <div className="code-titlebar">
          <span className="code-dot red" />
          <span className="code-dot yellow" />
          <span className="code-dot green" />
          <span className="code-filename">app.ts</span>
        </div>
        <pre className="code-body">
          <code>{`import { Byoky } from '@byoky/sdk';

// 1. Connect to the wallet
const byoky = new Byoky();
const session = await byoky.connect({
  providers: [{ id: 'anthropic', required: false }],
});

// 2. Make API calls through the proxy
const response = await session.createFetch('anthropic')(
  'https://api.anthropic.com/v1/messages',
  {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'Hello!' }],
    }),
  },
);

// 3. That's it — keys never left the extension`}</code>
        </pre>
      </div>

      <div className="code-links">
        <a
          href="https://github.com/MichaelLod/byoky"
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-ghost"
        >
          View source on GitHub
        </a>
        <a
          href="https://www.npmjs.com/package/@byoky/sdk"
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-ghost"
        >
          npm install @byoky/sdk
        </a>
      </div>
    </div>
  );
}
