import { ogAlt, ogContentType, ogSize, renderGiftOgImage } from '../_share';

export const alt = ogAlt;
export const size = ogSize;
export const contentType = ogContentType;

type Params = Promise<{ encoded: string }>;

export default async function Image({ params }: { params: Params }) {
  const { encoded } = await params;
  return renderGiftOgImage(encoded);
}
