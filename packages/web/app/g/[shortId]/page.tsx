import type { Metadata } from 'next';
import { buildGiftMetadata, resolveGiftShortId } from '../../gift/_share';
import { GiftRedeem } from '../../gift/GiftRedeem';

type Params = Promise<{ shortId: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { shortId } = await params;
  const encoded = /^[A-Za-z0-9]{1,32}$/.test(shortId) ? await resolveGiftShortId(shortId) : null;
  const meta = buildGiftMetadata(encoded, `https://byoky.com/g/${shortId}`);
  return { ...meta, alternates: { canonical: `/g/${shortId}` } };
}

export default function GiftShortPage() {
  return <GiftRedeem />;
}
