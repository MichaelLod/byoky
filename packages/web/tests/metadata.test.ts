import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Metadata } from 'next';

// next/font/google only works through Next's compiler.
vi.mock('next/font/google', () => {
  const font = () => ({ className: '', variable: '', style: { fontFamily: '' } });
  return { Chakra_Petch: font, IBM_Plex_Mono: font, IBM_Plex_Sans: font };
});

let root: Metadata;
beforeAll(async () => {
  ({ metadata: root } = await import('../app/layout'));
});

// Pages and layouts that set only a title and description, so their share
// cards come from the root's openGraph and twitter objects.
const SEGMENTS = {
  docs: () => import('../app/docs/layout'),
  demo: () => import('../app/demo/page'),
  chat: () => import('../app/chat/page'),
  blog: () => import('../app/blog/layout'),
  'built-with': () => import('../app/built-with/page'),
  privacy: () => import('../app/privacy/page'),
  terms: () => import('../app/terms/page'),
  support: () => import('../app/support/page'),
};

describe('root metadata', () => {
  // Next copies a page's own title and description into og: and twitter:
  // only where the inherited objects leave them empty. Set here, every page
  // above would share the home page's card text.
  it('leaves the share-card title and description to each page', () => {
    expect(root.openGraph).toBeDefined();
    expect(root.twitter).toBeDefined();
    for (const card of [root.openGraph!, root.twitter!] as Record<string, unknown>[]) {
      expect(card).not.toHaveProperty('title');
      expect(card).not.toHaveProperty('description');
    }
    expect(root.openGraph).toMatchObject({ siteName: 'Byoky', type: 'website' });
    expect(root.twitter).toMatchObject({ card: 'summary_large_image' });
  });
});

describe.each(Object.entries(SEGMENTS))('/%s', (_name, load) => {
  it('names Byoky once in its title', async () => {
    const { metadata } = (await load()) as { metadata: Metadata };
    const template = (root.title as { template: string }).template;
    const title = metadata.title;
    const shown =
      typeof title === 'string'
        ? template.replace('%s', title)
        : title && typeof title === 'object' && 'absolute' in title
          ? title.absolute
          : undefined;
    expect(shown).toBeTruthy();
    expect(shown!.match(/Byoky/g)).toHaveLength(1);
  });

  it('keeps the root share cards, with their images', async () => {
    const { metadata } = (await load()) as { metadata: Metadata };
    // A segment's own openGraph or twitter object replaces the root's whole,
    // dropping the og:image of app/opengraph-image.tsx unless it has its own.
    expect(metadata.openGraph).toBeUndefined();
    expect(metadata.twitter).toBeUndefined();
    expect(metadata.description).toBeTruthy();
  });
});
