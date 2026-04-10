import { NextResponse } from 'next/server';
import * as fs from 'node:fs';
import * as path from 'node:path';

interface ReviewRequest {
  slug: string;
  action: 'approve' | 'reject';
}

export async function POST(request: Request) {
  const { slug, action } = (await request.json()) as ReviewRequest;

  if (!slug || !['approve', 'reject'].includes(action)) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const submissionsPath = path.join(process.cwd(), 'data', 'submissions.json');
  const appsPath = path.join(process.cwd(), 'data', 'apps.json');

  // Update submission status
  let submissions: Record<string, unknown>[] = [];
  try {
    submissions = JSON.parse(fs.readFileSync(submissionsPath, 'utf-8'));
  } catch {
    return NextResponse.json({ error: 'No submissions found' }, { status: 404 });
  }

  const submission = submissions.find((s) => s.slug === slug);
  if (!submission) {
    return NextResponse.json({ error: 'Submission not found' }, { status: 404 });
  }

  submission.status = action === 'approve' ? 'approved' : 'rejected';
  fs.writeFileSync(submissionsPath, JSON.stringify(submissions, null, 2), 'utf-8');

  // If approved, add to the apps catalog
  if (action === 'approve') {
    let apps: Record<string, unknown>[] = [];
    try {
      apps = JSON.parse(fs.readFileSync(appsPath, 'utf-8'));
    } catch {
      // empty
    }

    // Don't duplicate
    if (!apps.some((a) => a.slug === slug)) {
      apps.push({
        id: submission.slug,
        name: submission.name,
        slug: submission.slug,
        url: submission.url,
        icon: submission.icon || '/icon.png',
        description: submission.description,
        category: submission.category,
        providers: submission.providers,
        author: submission.author,
        status: 'approved',
        verified: false,
        featured: false,
        createdAt: Date.now(),
      });
      fs.writeFileSync(appsPath, JSON.stringify(apps, null, 2), 'utf-8');
    }
  }

  return NextResponse.json({ success: true });
}
