import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms of Use',
  description:
    'The terms that govern your use of the Byoky extension, mobile apps, SDK, and vault sync service.',
  alternates: {
    canonical: '/terms',
  },
};

export default function Terms() {
  return (
    <div className="container" style={{ paddingTop: '120px', paddingBottom: '80px', maxWidth: '680px' }}>
      <h1 style={{ fontSize: '32px', marginBottom: '8px' }}>Terms of Use</h1>
      <p style={{ color: 'var(--text-muted)', marginBottom: '40px', fontSize: '14px' }}>
        Last updated: April 17, 2026
      </p>

      <Section title="Acceptance">
        <p>
          By installing or using the Byoky browser extension, mobile apps, SDK, or the optional
          vault sync service at vault.byoky.com (together, the &ldquo;Service&rdquo;) you agree
          to these Terms of Use. If you do not agree, do not use the Service.
        </p>
      </Section>

      <Section title="What Byoky is">
        <p>
          Byoky is an open-source bring-your-own-key (BYOK) wallet for LLM API keys. You supply
          your own keys to providers such as Anthropic, OpenAI, and Google. Byoky stores them
          encrypted on your device and proxies requests to those providers on your behalf. An
          optional cloud sync feature (the &ldquo;Vault&rdquo;) lets you use the same keys across
          devices with end-to-end encryption.
        </p>
        <p>
          Byoky is not an LLM provider. We do not sell inference, tokens, or credits. All
          billing for LLM usage happens directly between you and the provider whose key you
          supply.
        </p>
      </Section>

      <Section title="Your account and credentials">
        <ul>
          <li>
            You are responsible for the API keys you add to Byoky, including any charges those
            keys incur with their issuing provider.
          </li>
          <li>
            If you enable vault sync, you are responsible for keeping your password safe.
            Because encryption keys are derived from your password on your device, we cannot
            recover your data if you lose it.
          </li>
          <li>
            You must not share your account credentials or use someone else&apos;s keys without
            their permission.
          </li>
        </ul>
      </Section>

      <Section title="Acceptable use">
        <p>You agree not to:</p>
        <ul>
          <li>Use the Service to violate any law or any LLM provider&apos;s terms of service</li>
          <li>Use the Service to generate, distribute, or facilitate illegal content, including CSAM, targeted harassment, or content that infringes others&apos; rights</li>
          <li>Attempt to reverse, bypass, or interfere with the encryption, authentication, or rate limits of the Vault</li>
          <li>Attempt to access accounts, credentials, or data belonging to other users</li>
          <li>Use the Service to attack, probe, or disrupt Byoky or any third-party system</li>
          <li>Resell or rebrand the Vault service as a commercial product (you are free to self-host the open-source code under the MIT license)</li>
        </ul>
      </Section>

      <Section title="Third-party providers">
        <p>
          When you use Byoky to call an LLM provider, your prompts, completions, and any other
          data flow to that provider under its own terms of service and privacy policy. Byoky is
          not a party to that relationship and is not responsible for provider behavior,
          availability, billing, or content moderation decisions.
        </p>
      </Section>

      <Section title="Open source license">
        <p>
          Byoky&apos;s source code is released under the MIT license. The MIT license governs
          your rights to the code itself. These Terms govern your use of the hosted Vault
          service and the distributed binaries (Chrome, Firefox, iOS, Android).
        </p>
      </Section>

      <Section title="Service availability">
        <p>
          The Vault is provided on a best-effort basis with no uptime guarantee. We may modify,
          suspend, or discontinue the hosted Vault at any time. Because Byoky is open source,
          you can self-host the Vault to run it on your own terms.
        </p>
      </Section>

      <Section title="Termination">
        <p>
          You may stop using the Service and delete your vault account at any time from the
          extension Settings. We may suspend or terminate accounts that violate these Terms,
          abuse the Service, or put other users at risk. On termination, the account and all
          data associated with it are deleted as described in the Privacy Policy.
        </p>
      </Section>

      <Section title="No warranty">
        <p>
          The Service is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo; without
          warranties of any kind, express or implied, including merchantability, fitness for a
          particular purpose, and non-infringement. We do not warrant that the Service will be
          uninterrupted, error-free, or secure against every possible threat.
        </p>
      </Section>

      <Section title="Limitation of liability">
        <p>
          To the fullest extent permitted by law, Byoky and its contributors are not liable for
          any indirect, incidental, special, consequential, or punitive damages, including loss
          of data, loss of API credits, loss of profits, or charges incurred with third-party
          LLM providers, arising from your use of the Service.
        </p>
      </Section>

      <Section title="Changes to these terms">
        <p>
          We may update these Terms from time to time. When we do, we will update the &ldquo;Last
          updated&rdquo; date above. Continued use of the Service after changes take effect
          means you accept the revised Terms.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          Questions or notices regarding these Terms can be filed as an issue on{' '}
          <a href="https://github.com/MichaelLod/byoky/issues" style={{ color: 'var(--teal-light)' }}>
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
