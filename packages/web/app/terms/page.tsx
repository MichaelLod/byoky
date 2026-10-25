import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms of Use',
  description:
    'The terms that govern your use of the Byoky extension, mobile apps, SDK, and bridge.',
  alternates: {
    canonical: '/terms',
  },
};

export default function Terms() {
  return (
    <div className="container" style={{ paddingTop: '120px', paddingBottom: '80px', maxWidth: '680px' }}>
      <h1 style={{ fontSize: '32px', marginBottom: '8px' }}>Terms of Use</h1>
      <p style={{ color: 'var(--dim)', marginBottom: '40px', fontSize: '13px', fontFamily: 'var(--font-code)' }}>
        Last updated: October 23, 2026
      </p>

      <Section title="Acceptance">
        <p>
          By installing or using the Byoky browser extension, mobile apps, SDK, bridge, or other
          Byoky software (together, the &ldquo;Service&rdquo;) you agree to these Terms of Use.
          If you do not agree, do not use the Service.
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
          Certain parts of the Service — currently including alias groups and any feature
          explicitly labelled &ldquo;beta&rdquo; or
          &ldquo;experimental&rdquo; — are under active development. They may change,
          regress, or be removed without notice. They are provided for testing and feedback and
          should not be relied on for production use without additional safeguards on your side.
        </p>
      </Section>

      <Section title="What Byoky is">
        <p>
          Byoky is an open-source bring-your-own-key (BYOK) wallet for LLM API keys. You supply
          your own keys to providers such as Anthropic, OpenAI, and Google. Byoky stores them
          encrypted on your device and proxies requests to those providers on your behalf. The
          Service runs on your own devices. We do not operate servers that store your keys or
          relay your requests, and there are no Byoky accounts.
        </p>
        <p>
          Byoky is not an LLM provider. We do not sell, resell, broker, or lease access to any
          LLM provider&apos;s API or subscription. Byoky is a technical forwarding tool that
          acts on your instructions and on your credentials. All billing for LLM usage happens
          directly between you and the provider whose key you supply.
        </p>
      </Section>

      <Section title="Your credentials">
        <ul>
          <li>
            You are responsible for the API keys you add to Byoky, including any charges those
            keys incur with their issuing provider.
          </li>
          <li>
            You are responsible for keeping your master password and any backup password safe.
            Because encryption keys are derived from those passwords on your device, we cannot
            recover your data if you lose them.
          </li>
          <li>
            You must not use someone else&apos;s keys without their permission.
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
          <li>Attempt to access credentials or data belonging to other users</li>
          <li>Use the Service to attack, probe, or disrupt Byoky or any third-party system</li>
          <li>Resell, broker, or lease LLM-provider access obtained through the Service as a commercial product</li>
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
          — including any keys you add and any application you build on the SDK — remains in
          compliance with them.
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
          your rights to the code itself. These Terms govern your use of the distributed
          binaries (Chrome, Firefox, iOS, Android).
        </p>
      </Section>

      <Section title="Indemnification">
        <p>
          You agree to defend, indemnify, and hold harmless Byoky, its maintainers, and
          contributors from and against any claims, liabilities, damages, losses, and expenses
          (including reasonable legal fees) arising out of or in any way connected with: (a)
          your use of or access to the Service; (b) the API keys and OAuth credentials you add
          to or use through the Service; (c) your violation of
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
          The Service does not depend on any hosted Byoky service. The extension, apps, and
          other software are provided on a best-effort basis, and we may modify or discontinue
          any of them at any time. Because Byoky is open source, you can build and run it
          yourself on your own terms.
        </p>
      </Section>

      <Section title="Termination">
        <p>
          You may stop using the Service at any time by uninstalling it. Because the Service
          runs on your devices and we hold no account for you, uninstalling removes your local
          data as described in the Privacy Policy.
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
          <a href="https://github.com/MichaelLod/byoky/issues" style={{ color: 'var(--phosphor)' }}>
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
    <section style={{ padding: 0, marginBottom: '32px' }}>
      <h2 style={{ fontSize: '20px', marginBottom: '12px' }}>{title}</h2>
      <div style={{ color: 'var(--fog)', lineHeight: '1.7', fontSize: '15px' }}>
        {children}
      </div>
      <style>{`
        section ul { padding-left: 20px; margin: 8px 0; }
        section li { margin-bottom: 6px; }
      `}</style>
    </section>
  );
}
