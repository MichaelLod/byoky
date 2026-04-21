import { ogAlt, ogContentType, ogSize, renderGiftOgImage, resolveGiftShortId } from '../../gift/_share';

export const alt = ogAlt;
export const size = ogSize;
export const contentType = ogContentType;

type Params = Promise<{ shortId: string }>;

export default async function Image({ params }: { params: Params }) {
  const { shortId } = await params;
  const encoded = /^[A-Za-z0-9]{1,32}$/.test(shortId) ? await resolveGiftShortId(shortId) : null;
  return renderGiftOgImage(encoded);
}
