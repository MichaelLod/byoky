export interface BlogPostMeta {
  slug: string;
  title: string;
  description: string;
  date: string;
  readTime: string;
  tags: string[];
  author: string;
  image: string;
  imageAlt: string;
  ogTitle?: string;
  ogDescription?: string;
}

export const posts: BlogPostMeta[] = [
  {
    slug: 'v0-6-0-gifts-everywhere',
    title: 'Byoky v0.6.0 — Gifts, everywhere',
    description:
      'Mobile wallets can now host gifts. A gift for one provider can now serve requests to any other. One credential, any SDK, from any device.',
    date: '2026-04-14',
    readTime: '4 min read',
    tags: ['release', 'gifts', 'mobile', 'cross-provider'],
    author: 'Michael Lodzik',
    image: '/og-image.png',
    imageAlt: 'Byoky v0.6.0 — gift relay hosting on mobile with cross-provider translation',
    ogTitle: 'Byoky v0.6.0 — your phone hosts the gift, and it translates across providers',
    ogDescription:
      'iOS and Android wallets can now host Byoky gifts. A Claude gift serves OpenAI requests. Gifted credentials work from the CLI. Ships today.',
  },
  {
    slug: 'anthropic-claude-code-fingerprint',
    title: "I Spent an Evening Bisecting Anthropic's Claude Code Fingerprint",
    description:
      "Setup tokens are supposed to bill Pro/Max plans. So why does Anthropic reject the same token from OpenClaw with a 'third-party app' billing wall? I went looking, byte by byte.",
    date: '2026-04-08',
    readTime: '6 min read',
    tags: ['claude-code', 'anthropic', 'openclaw', 'reverse-engineering'],
    author: 'Michael Lodzik',
    image: '/openclaw-og.png',
    imageAlt: "Bisecting Anthropic's Claude Code detection signal",
    ogTitle: "Anthropic fingerprints OpenClaw. Here's what that means for your Pro/Max plan.",
    ogDescription:
      "A byte-by-byte bisect of Anthropic's third-party detection — three layers deep — what it's really looking at, and how Byoky fits in for users with supported workflows.",
  },
];

export function getPost(slug: string): BlogPostMeta | undefined {
  return posts.find((p) => p.slug === slug);
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}
