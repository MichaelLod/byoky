import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Support',
  description:
    'Get help with Byoky. Find answers to common questions, report issues, or reach out for support.',
  alternates: {
    canonical: '/support',
  },
};

export default function Support() {
  return (
    <div className="container" style={{ paddingTop: '120px', paddingBottom: '80px', maxWidth: '680px' }}>
      <h1 style={{ fontSize: '32px', marginBottom: '8px' }}>Support</h1>
      <p style={{ color: 'var(--dim)', marginBottom: '40px', fontSize: '13px', fontFamily: 'var(--font-code)' }}>
        We&apos;re here to help you get the most out of Byoky.
      </p>

      <Section title="Frequently Asked Questions">
        <ul>
          <li>
            <strong>What is Byoky?</strong>
            <p>
              Byoky is the MetaMask for API keys: a wallet for your AI credentials, available as a
              browser extension and as iOS and Android apps. Apps connect to the wallet instead of
              asking for your keys, and the wallet makes their LLM calls for them.
            </p>
          </li>
          <li>
            <strong>Are my API keys safe?</strong>
            <p>
              Yes. Your keys are encrypted with AES-256-GCM and never leave your device. API requests
              go directly from the wallet to the provider — no intermediary servers.
            </p>
          </li>
          <li>
            <strong>Do I need an account? Is there cloud sync?</strong>
            <p>
              No. Byoky has no accounts, no cloud sync and no servers. Your keys live only in the
              wallet on your device. To move them to another device, export an encrypted{' '}
              <code>.byoky</code> backup file, protected by a password you choose, and import it
              there.
            </p>
          </li>
          <li>
            <strong>Which providers are supported?</strong>
            <p>
              Byoky supports 13 providers: Anthropic, OpenAI, Google Gemini, Mistral, Cohere,
              xAI, DeepSeek, Perplexity, Groq, Together AI, Fireworks AI, OpenRouter, and Azure
              OpenAI.
            </p>
          </li>
          <li>
            <strong>Where does Byoky work?</strong>
            <p>
              Chrome and Firefox on desktop, Safari on iPhone and iPad (through the Byoky Safari
              extension, included with the iOS app), and the built-in browser of the iOS and Android
              apps, where you can
              open any https web app by URL. CLI tools on desktop connect through{' '}
              <code>@byoky/bridge</code>. Safari on macOS is coming soon.
            </p>
          </li>
          <li>
            <strong>Is Byoky free?</strong>
            <p>
              Yes. Byoky is free and open source under the MIT license. You only pay for the API
              usage with your own keys.
            </p>
          </li>
        </ul>
      </Section>

      <Section title="Report an Issue">
        <p>
          Found a bug or have a feature request? Open an issue on our GitHub repository:
        </p>
        <p>
          <a href="https://github.com/MichaelLod/byoky/issues" style={{ color: 'var(--phosphor)' }}>
            github.com/MichaelLod/byoky/issues
          </a>
        </p>
      </Section>

      <Section title="Contact Us">
        <p>
          For general questions or support, reach out via email:
        </p>
        <p>
          <a href="mailto:support@byoky.com" style={{ color: 'var(--phosphor)' }}>
            support@byoky.com
          </a>
        </p>
      </Section>

      <Section title="Documentation">
        <p>
          Byoky is fully open source. You can browse the source code, read the documentation,
          and contribute on GitHub:
        </p>
        <p>
          <a href="https://github.com/MichaelLod/byoky" style={{ color: 'var(--phosphor)' }}>
            github.com/MichaelLod/byoky
          </a>
        </p>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ padding: 0, marginBottom: '32px' }}>
      <h2 style={{ fontSize: '20px', marginBottom: '12px' }}>{title}</h2>
      <div style={{ color: 'var(--fog)', lineHeight: '1.7', fontSize: '15px' }}>
        {children}
      </div>
      <style>{`
        section ul { padding-left: 20px; margin: 8px 0; list-style: none; }
        section li { margin-bottom: 16px; }
        section li p { margin: 4px 0 0; }
      `}</style>
    </section>
  );
}
