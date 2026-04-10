import { NextResponse } from 'next/server';
import apps from '@/data/apps.json';

export function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  return params.then(({ slug }) => {
    const app = apps.find((a) => a.slug === slug && a.status === 'approved');
    if (!app) {
      return NextResponse.json({ error: 'App not found' }, { status: 404 });
    }
    return NextResponse.json(app);
  });
}
