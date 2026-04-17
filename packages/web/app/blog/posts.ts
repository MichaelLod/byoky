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
    title: 'The $200 surprise hiding in my Claude Pro subscription',
    description:
      "Same token. Same API. Same model. Different client — and suddenly my Pro plan stopped paying and a $200 credit drip showed up instead. I spent an evening finding out why.",
    date: '2026-04-08',
    readTime: '5 min read',
    tags: ['claude-code', 'anthropic', 'openclaw', 'api-behavior'],
    author: 'Michael Lodzik',
    image: '/openclaw-og.png',
    imageAlt: 'A Claude setup token routing differently between two clients',
    ogTitle: 'Same token, two clients, one $200 surprise',
    ogDescription:
      "Anthropic's API treats the same Claude setup token completely differently depending on who's calling. Here's the evening I spent figuring out which part of the request carries the signal.",
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
