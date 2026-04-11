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
    slug: 'anthropic-claude-code-fingerprint',
    title: "I Spent an Evening Bisecting Anthropic's Claude Code Fingerprint",
    description:
      "Setup tokens are supposed to bill Pro/Max plans. So why does Anthropic reject the same token from OpenClaw with a 'third-party app' billing wall? I went looking, byte by byte — and wired the fix into Byoky so you don't have to.",
    date: '2026-04-08',
    readTime: '6 min read',
    tags: ['claude-code', 'anthropic', 'openclaw', 'reverse-engineering'],
    author: 'Michael Lodzik',
    image: '/openclaw-og.png',
    imageAlt: 'OpenClaw — your personal AI assistant, running on your own devices',
    ogTitle: "Anthropic fingerprints OpenClaw. Here's how to stay on your Pro/Max plan.",
    ogDescription:
      "A byte-by-byte bisect of Anthropic's third-party detection — three layers deep — and the 5-minute Byoky setup that makes OpenClaw look first-party again. No fork. No extra credits. Your existing Claude subscription.",
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
