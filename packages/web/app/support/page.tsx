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
      <p style={{ color: 'var(--text-muted)', marginBottom: '40px', fontSize: '14px' }}>
        We&apos;re here to help you get the most out of Byoky.
      </p>

      <Section title="Frequently Asked Questions">
        <ul>
          <li>
            <strong>What is Byoky?</strong>
            <p>
              Byoky is a secure browser extension that acts as a wallet for your LLM API keys.
              It lets you connect to any compatible web app without pasting your keys into third-party sites.
            </p>
          </li>
          <li>
            <strong>Are my API keys safe?</strong>
            <p>
              Yes. Your keys are encrypted with AES-256-GCM and never leave your device. API requests
              go directly from the extension to the provider — no intermediary servers.
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
            <strong>Which browsers are supported?</strong>
            <p>
              Chrome, Firefox, and Safari on iOS. Safari on macOS is coming soon.
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
          <a href="https://github.com/MichaelLod/byoky/issues" style={{ color: 'var(--teal-light)' }}>
            github.com/MichaelLod/byoky/issues
          </a>
        </p>
      </Section>

      <Section title="Contact Us">
        <p>
          For general questions or support, reach out via email:
        </p>
        <p>
          <a href="mailto:support@byoky.com" style={{ color: 'var(--teal-light)' }}>
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
          <a href="https://github.com/MichaelLod/byoky" style={{ color: 'var(--teal-light)' }}>
            github.com/MichaelLod/byoky
          </a>
        </p>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: '32px' }}>
      <h2 style={{ fontSize: '20px', marginBottom: '12px' }}>{title}</h2>
      <div style={{ color: 'var(--text-secondary)', lineHeight: '1.7', fontSize: '15px' }}>
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
