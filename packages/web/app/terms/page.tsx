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

      <Section title="Eligibility">
        <p>
          You must be at least 18 years old, or the age of majority in your jurisdiction,
          whichever is greater, to use the Service. By using the Service you represent that you
          meet this requirement and have the legal capacity to enter into these Terms.
        </p>
      </Section>

      <Section title="Export controls and sanctions">
        <p>
          The Service routes requests to LLM providers that are primarily based in the United
          States and other jurisdictions with export-control rules. You represent that you are
          not located in, under the control of, or a national or resident of any country or
          region subject to comprehensive U.S., EU, or UN sanctions, and that you are not on any
          restricted-party, denied-persons, or specially-designated-nationals list. You agree
          not to use the Service to export, re-export, or transfer any technology or content in
          violation of applicable export-control or sanctions law.
        </p>
      </Section>

      <Section title="Beta and experimental features">
        <p>
          Certain parts of the Service — currently including the Vault sync, gifting, alias
          groups, and any feature explicitly labelled &ldquo;beta&rdquo; or
          &ldquo;experimental&rdquo; — are under active development. They may change,
          regress, or be removed without notice. They are provided for testing and feedback and
          should not be relied on for production use without additional safeguards on your side.
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
          Byoky is not an LLM provider. We do not sell, resell, broker, or lease access to any
          LLM provider&apos;s API or subscription. Byoky is a technical forwarding tool that
          acts on your instructions and on your credentials. All billing for LLM usage happens
          directly between you and the provider whose key you supply.
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
          <li>
            You must not add to Byoky any credential whose issuing provider&apos;s terms prohibit
            use of that credential through third-party software, including (without limitation)
            OAuth tokens or session tokens obtained from consumer subscription plans such as
            Claude Free / Pro / Max, ChatGPT Free / Plus / Pro, or similar plans where the
            provider&apos;s terms restrict use to its official clients. You are solely
            responsible for knowing whether a given credential is eligible.
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
          <li>Resell, rebrand, broker, or lease the hosted Vault or any LLM-provider access obtained through it as a commercial product</li>
        </ul>
      </Section>

      <Section title="Gifting API keys">
        <p>
          Byoky lets you share access to one of your own API keys with another person by
          creating a &ldquo;gift&rdquo; — a shareable link backed by a token budget and an
          expiration date. When the recipient uses the gift, requests are proxied through a
          relay and counted against the budget you set. Your underlying key is never delivered
          to the recipient in the clear; they only get metered access to it.
        </p>
        <p>When you create a gift you agree that:</p>
        <ul>
          <li>
            <strong>It&apos;s your key, your bill.</strong> You remain fully responsible for any
            charges the gifted key incurs with the upstream provider, including any usage
            within the token budget you granted.
          </li>
          <li>
            <strong>You must have the right to share it.</strong> You represent and warrant
            that the key you are gifting is yours to share and that permitting the recipient to
            consume tokens against it is not prohibited by the issuing provider&apos;s terms,
            usage policy, account-sharing policy, or any other applicable agreement between you
            and that provider. Many providers — including Anthropic, OpenAI, Google, xAI,
            Mistral, and Groq — restrict or forbid sharing API keys or letting other persons
            use your account. It is your responsibility to know whether your provider permits
            what you are doing.
          </li>
          <li>
            <strong>You control the limits.</strong> Each gift carries a token budget and
            expiration. You can revoke a gift at any time, after which the relay will stop
            serving requests for it. Byoky enforces the limits you set but is not responsible
            for upstream provider actions (rate limits, bans, billing disputes).
          </li>
          <li>
            <strong>No resale or commercial gifting.</strong> Gifting is intended for personal,
            team, and community sharing. You may not use gifts — whether through the hosted
            Vault or a self-hosted deployment — to resell, lease, broker, or otherwise
            monetize third-party LLM API access. Self-hosting Byoky under the MIT license does
            not exempt you from the upstream provider&apos;s terms; any commercial offering
            built on Byoky must independently comply with each provider&apos;s commercial-use
            policy and obtain any permissions that policy requires.
          </li>
          <li>
            <strong>Recipient responsibility.</strong> When you accept a gift, you agree to use
            it only within the budget and time window provided, and to comply with the
            upstream provider&apos;s terms. Abuse of a gift (e.g., scraping, illegal content,
            probing the relay) is grounds for revocation of that gift and termination of your
            account.
          </li>
          <li>
            <strong>System limits.</strong> A single user may hold at most 50 active outgoing
            gifts at any time. Expired gifts are removed automatically.
          </li>
        </ul>
      </Section>

      <Section title="Third-party providers">
        <p>
          When you use Byoky to call an LLM provider (for example Anthropic, OpenAI, Google,
          xAI, Mistral, DeepSeek, Groq, or any other provider you configure), your prompts,
          completions, and any other data flow to that provider under its own terms of service,
          usage policy, and privacy policy. Byoky is not a party to that relationship and is
          not responsible for provider behavior, availability, billing, or content-moderation
          decisions.
        </p>
        <p>
          <strong>You agree that you will comply with all applicable terms, usage policies,
          acceptable-use policies, and documentation of each LLM provider whose credentials you
          use with the Service.</strong> Provider terms change over time and you are solely
          responsible for monitoring those updates and for ensuring that your use of the Service
          — including any keys you add, any gifts you create, and any application you build on
          the SDK — remains in compliance with them.
        </p>
        <p>
          We may add, remove, restrict, throttle, or disable support for any individual LLM
          provider at any time and without prior notice, including in response to a request or
          notice from that provider, a change in that provider&apos;s terms, or a good-faith
          determination that continued support exposes Byoky or its users to legal risk.
        </p>
      </Section>

      <Section title="Trademarks and no affiliation">
        <p>
          &ldquo;Anthropic,&rdquo; &ldquo;Claude,&rdquo; &ldquo;OpenAI,&rdquo;
          &ldquo;ChatGPT,&rdquo; &ldquo;Google,&rdquo; &ldquo;Gemini,&rdquo; &ldquo;xAI,&rdquo;
          &ldquo;Grok,&rdquo; &ldquo;Mistral,&rdquo; &ldquo;DeepSeek,&rdquo; &ldquo;Groq,&rdquo;
          and other product and company names used in Byoky&apos;s documentation or interface
          are trademarks of their respective owners. Byoky is not affiliated with, endorsed by,
          sponsored by, or certified by any of these providers. Their names are used solely to
          identify the services with which Byoky is interoperable, under the nominative-fair-use
          doctrine.
        </p>
      </Section>

      <Section title="Open source license">
        <p>
          Byoky&apos;s source code is released under the MIT license. The MIT license governs
          your rights to the code itself. These Terms govern your use of the hosted Vault
          service and the distributed binaries (Chrome, Firefox, iOS, Android).
        </p>
      </Section>

      <Section title="Fair use of the hosted Vault">
        <p>
          The hosted Vault at vault.byoky.com is offered free of charge to individual users for
          personal and small-team use. To keep it available for everyone we may apply rate
          limits, throttle abusive traffic, cap the number of active sessions, credentials, or
          gifts per account, and suspend accounts whose traffic pattern is inconsistent with
          normal wallet use (for example, sustained automated proxy traffic unrelated to an
          interactive app). If you expect heavy or commercial traffic, self-host the open-source
          Vault so you can size it to your own needs.
        </p>
      </Section>

      <Section title="Indemnification">
        <p>
          You agree to defend, indemnify, and hold harmless Byoky, its maintainers, and
          contributors from and against any claims, liabilities, damages, losses, and expenses
          (including reasonable legal fees) arising out of or in any way connected with: (a)
          your use of or access to the Service; (b) the API keys and OAuth credentials you add,
          use, or share through the Service, including gifts you create; (c) your violation of
          these Terms or of any law or third-party right; or (d) any content you transmit
          through the Service.
        </p>
      </Section>

      <Section title="Feedback">
        <p>
          If you send us suggestions, bug reports, feature requests, or other feedback about
          the Service (for example, by opening a GitHub issue or pull request), you grant us a
          worldwide, royalty-free, perpetual, irrevocable license to use and incorporate that
          feedback into the Service and our open-source projects without obligation to you.
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

      <Section title="Governing law and venue">
        <p>
          These Terms and any dispute arising out of or in connection with them or the Service
          are governed by the laws of the Republic of Austria, excluding its conflict-of-laws
          rules and the United Nations Convention on Contracts for the International Sale of
          Goods (CISG). The exclusive place of jurisdiction for all disputes is Vienna,
          Austria, to the extent permitted by law.
        </p>
        <p>
          If you use the Service as a consumer (Verbraucher) resident in the European Union,
          nothing in this section deprives you of the protection afforded by the mandatory
          consumer-protection laws of your country of residence.
        </p>
      </Section>

      <Section title="Severability and entire agreement">
        <p>
          If any provision of these Terms is held to be unenforceable or invalid, that
          provision will be limited or eliminated to the minimum extent necessary and the
          remaining provisions will remain in full force and effect. These Terms, together with
          the Privacy Policy, constitute the entire agreement between you and Byoky regarding
          the Service and supersede any prior agreements on the same subject matter. You may
          not assign these Terms without our prior written consent; we may assign them in
          connection with a merger, acquisition, or sale of assets.
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
