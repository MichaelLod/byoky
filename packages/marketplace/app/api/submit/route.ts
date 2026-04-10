import { NextResponse } from 'next/server';
import * as fs from 'node:fs';
import * as path from 'node:path';

interface Submission {
  name: string;
  slug: string;
  url: string;
  icon: string;
  description: string;
  category: string;
  providers: string[];
  author: { name: string; email: string; website?: string };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Submission;

    if (!body.name || !body.slug || !body.url || !body.description) {
      return NextResponse.json(
        { error: 'Missing required fields: name, slug, url, description' },
        { status: 400 },
      );
    }

    if (!body.url.startsWith('https://')) {
      return NextResponse.json(
        { error: 'App URL must use HTTPS' },
        { status: 400 },
      );
    }

    if (!body.providers?.length) {
      return NextResponse.json(
        { error: 'At least one provider is required' },
        { status: 400 },
      );
    }

    // Append to submissions file for review
    const submissionsPath = path.join(process.cwd(), 'data', 'submissions.json');
    let submissions: unknown[] = [];
    try {
      const existing = fs.readFileSync(submissionsPath, 'utf-8');
      submissions = JSON.parse(existing);
    } catch {
      // File doesn't exist yet
    }

    submissions.push({
      ...body,
      id: body.slug,
      status: 'pending',
      verified: false,
      featured: false,
      submittedAt: Date.now(),
    });

    fs.writeFileSync(submissionsPath, JSON.stringify(submissions, null, 2), 'utf-8');

    return NextResponse.json({ success: true, message: 'Submitted for review' });
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
}
