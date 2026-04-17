import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description:
    'Byoky runs locally by default. Optional cloud sync uses end-to-end encryption — we never see your API keys.',
  alternates: {
    canonical: '/privacy',
  },
};

export default function Privacy() {
  return (
    <div className="container" style={{ paddingTop: '120px', paddingBottom: '80px', maxWidth: '680px' }}>
      <h1 style={{ fontSize: '32px', marginBottom: '8px' }}>Privacy Policy</h1>
      <p style={{ color: 'var(--text-muted)', marginBottom: '40px', fontSize: '14px' }}>
        Last updated: April 17, 2026
      </p>

      <Section title="Summary">
        <p>
          Byoky runs locally by default. Your API keys are encrypted on your device and never
          leave it unless you explicitly opt in to cloud sync. When you do, keys are encrypted
          client-side before upload — our server only ever sees ciphertext.
        </p>
      </Section>

      <Section title="What Byoky stores on your device">
        <ul>
          <li>Your API keys and OAuth tokens — encrypted with AES-256-GCM (PBKDF2, 600,000 iterations) and stored in the extension&apos;s local storage</li>
          <li>Your master password hash — stored locally for vault unlock verification</li>
          <li>A request log — stored locally so you can audit which apps used which credentials</li>
        </ul>
        <p>
          If you never enable cloud sync, none of this data ever leaves your device.
        </p>
      </Section>

      <Section title="Optional cloud sync (vault.byoky.com)">
        <p>
          Byoky offers an opt-in cloud sync feature so you can use the same keys across devices.
          It is disabled by default — you must create a vault account and toggle it on in Settings.
        </p>
        <p>When cloud sync is enabled, the following applies:</p>
        <ul>
          <li>
            <strong>End-to-end encryption.</strong> Your encryption key is derived from your
            password on your device using PBKDF2 (600,000 iterations). API keys are encrypted
            with that key before they are uploaded. The Byoky server stores only the ciphertext
            and cannot decrypt it — only someone who knows your password can.
          </li>
          <li>
            <strong>Account data.</strong> We store a username you choose (no email required),
            a password hash, and a server-side wrapped copy of your session key so you can sign
            back in after a session expires.
          </li>
          <li>
            <strong>Synced credentials.</strong> For each credential you sync we store: the
            provider ID, an optional label, the encrypted key material, and the last-used
            timestamp.
          </li>
          <li>
            <strong>Request log.</strong> When an app makes an LLM call via your vault, we log
            the app origin, provider, model, request status, and token counts, so you can see
            usage per app. We do not log prompts or responses, IP addresses, or user-agent
            strings.
          </li>
          <li>
            <strong>Groups and sessions.</strong> If you create alias groups or authorize apps,
            we store those associations so the same policy applies across your devices.
          </li>
          <li>
            <strong>Gifts you create.</strong> When you share one of your keys as a gift, we
            store the encrypted key, the relay URL used to proxy requests, the token budget and
            expiration you set, and a running count of tokens consumed. Gifted keys are
            encrypted before storage and are revealed in plaintext only transiently when the
            relay forwards a request to the upstream provider. You can revoke or delete any
            gift from the extension at any time; expired gifts are removed automatically.
          </li>
        </ul>
        <p>
          You can delete your vault account at any time from Settings. Deleting your account
          removes your user record, all synced credentials, sessions, groups, and request logs
          from our database.
        </p>
      </Section>

      <Section title="What Byoky does NOT do">
        <ul>
          <li>We do not collect analytics, telemetry, or tracking data</li>
          <li>We do not track your browsing activity</li>
          <li>We do not read your API keys — not on your device, not on our server</li>
          <li>We do not log prompts, completions, IP addresses, or user agents</li>
          <li>We do not use cookies on the extension or apps</li>
          <li>We do not sell or share any data with advertisers</li>
        </ul>
      </Section>

      <Section title="Network requests">
        <p>
          The Byoky extension makes network requests only when you use it: either directly to an
          LLM provider (Anthropic, OpenAI, Google Gemini, etc.) when using local-only mode, or
          through vault.byoky.com when cloud sync is enabled. In the vault flow, prompts and
          responses pass through our server only long enough to be forwarded to the provider —
          they are not stored.
        </p>
      </Section>

      <Section title="Third-party services">
        <p>
          When you use Byoky to make API calls, your prompts are sent to the LLM provider you
          selected (e.g., Anthropic, OpenAI). These providers have their own privacy policies and
          Byoky does not control what they do with your data.
        </p>
        <p>
          Our vault database is hosted on Railway (PostgreSQL). Railway acts as a data
          subprocessor and only ever stores the encrypted data described above.
        </p>
      </Section>

      <Section title="Children">
        <p>
          Byoky is not directed to children under 13 and we do not knowingly collect data from
          them.
        </p>
      </Section>

      <Section title="Open source">
        <p>
          Byoky — including the vault server — is fully open source under the MIT license. You
          can audit every line at{' '}
          <a href="https://github.com/MichaelLod/byoky" style={{ color: 'var(--teal-light)' }}>
            github.com/MichaelLod/byoky
          </a>
          .
        </p>
      </Section>

      <Section title="Changes to this policy">
        <p>
          If we make material changes to this policy we will update the &ldquo;Last updated&rdquo;
          date and, for existing vault users, surface a notice in the extension on next unlock.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          Questions? Open an issue on{' '}
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
