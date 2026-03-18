import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy — byoky',
};

export default function Privacy() {
  return (
    <div className="container" style={{ paddingTop: '80px', paddingBottom: '80px', maxWidth: '680px' }}>
      <h1 style={{ fontSize: '32px', marginBottom: '8px' }}>Privacy Policy</h1>
      <p style={{ color: 'var(--text-muted)', marginBottom: '40px', fontSize: '14px' }}>
        Last updated: March 18, 2026
      </p>

      <Section title="Summary">
        <p>
          byoky stores everything locally on your device. We do not collect, transmit, or store any
          personal data, API keys, usage data, or analytics. Period.
        </p>
      </Section>

      <Section title="What byoky stores">
        <ul>
          <li>Your API keys and OAuth tokens — encrypted with AES-256-GCM, stored in your browser&apos;s local storage</li>
          <li>Your master password hash — stored locally for vault unlock verification</li>
          <li>A request log — stored locally so you can audit which apps used your credentials</li>
        </ul>
        <p>All of this data stays on your device. None of it is ever sent to byoky, our servers, or any third party.</p>
      </Section>

      <Section title="What byoky does NOT do">
        <ul>
          <li>We do not collect analytics or telemetry</li>
          <li>We do not track your browsing activity</li>
          <li>We do not send your API keys anywhere — the extension proxies requests directly to LLM providers</li>
          <li>We do not use cookies</li>
          <li>We do not have servers that receive your data</li>
        </ul>
      </Section>

      <Section title="Network requests">
        <p>
          The byoky extension makes network requests only when you explicitly use it to connect to
          an LLM provider (Anthropic, OpenAI, Google Gemini, etc.). These requests go directly from
          your browser to the provider&apos;s API — byoky does not proxy through any intermediate server.
        </p>
      </Section>

      <Section title="Third-party services">
        <p>
          When you use byoky to make API calls, your prompts and data are sent to the LLM provider
          you selected (e.g., Anthropic, OpenAI). These providers have their own privacy policies.
          byoky does not control or monitor what these providers do with your data.
        </p>
      </Section>

      <Section title="Open source">
        <p>
          byoky is fully open source under the MIT license. You can audit the entire codebase at{' '}
          <a href="https://github.com/MichaelLod/byoky" style={{ color: 'var(--violet-light)' }}>
            github.com/MichaelLod/byoky
          </a>
          .
        </p>
      </Section>

      <Section title="Contact">
        <p>
          If you have questions about this policy, open an issue on{' '}
          <a href="https://github.com/MichaelLod/byoky/issues" style={{ color: 'var(--violet-light)' }}>
            GitHub
          </a>
          .
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
        section ul { padding-left: 20px; margin: 8px 0; }
        section li { margin-bottom: 6px; }
      `}</style>
    </section>
  );
}
