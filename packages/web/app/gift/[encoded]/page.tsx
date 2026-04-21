import type { Metadata } from 'next';
import { buildGiftMetadata } from '../_share';
import { GiftRedeem } from '../GiftRedeem';

type Params = Promise<{ encoded: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { encoded } = await params;
  const meta = buildGiftMetadata(encoded, `https://byoky.com/gift/${encoded}`);
  return { ...meta, alternates: { canonical: `/gift/${encoded}` } };
}

export default function GiftEncodedPage() {
  return <GiftRedeem />;
}
