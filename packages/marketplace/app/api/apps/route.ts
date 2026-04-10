import { NextResponse } from 'next/server';
import apps from '@/data/apps.json';

export function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const category = searchParams.get('category');
  const search = searchParams.get('search')?.toLowerCase();

  let results = apps.filter((app) => app.status === 'approved');

  if (category) {
    results = results.filter((app) => app.category === category);
  }

  if (search) {
    results = results.filter(
      (app) =>
        app.name.toLowerCase().includes(search) ||
        app.description.toLowerCase().includes(search),
    );
  }

  return NextResponse.json({ apps: results });
}
