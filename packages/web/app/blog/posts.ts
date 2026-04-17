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
    title: 'Why Claude setup-token requests can route to extra-usage billing',
    description:
      "A technical note on how Anthropic's API distinguishes Claude Code traffic from other clients — and how Byoky handles the compatibility layer so requests from supported workflows keep billing against your plan as intended.",
    date: '2026-04-08',
    readTime: '5 min read',
    tags: ['claude-code', 'anthropic', 'openclaw', 'api-behavior'],
    author: 'Michael Lodzik',
    image: '/openclaw-og.png',
    imageAlt: 'Byoky compatibility layer for Claude subscription workflows',
    ogTitle: 'Claude setup tokens and the extra-usage routing surprise',
    ogDescription:
      "A technical note on why the same Anthropic setup token can route to plan billing from one client and to extra-usage billing from another — and how Byoky's compatibility layer fits in.",
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
