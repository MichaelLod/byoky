import { NextResponse } from 'next/server';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { timingSafeEqual } from 'node:crypto';

export function GET(request: Request) {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return NextResponse.json({ error: 'Admin access not configured' }, { status: 503 });
  const auth = request.headers.get('Authorization');
  const expected = `Bearer ${secret}`;
  if (!auth || auth.length !== expected.length || !timingSafeEqual(Buffer.from(auth), Buffer.from(expected))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const submissionsPath = path.join(process.cwd(), 'data', 'submissions.json');
  try {
    const raw = fs.readFileSync(submissionsPath, 'utf-8');
    return NextResponse.json({ submissions: JSON.parse(raw) });
  } catch {
    return NextResponse.json({ submissions: [] });
  }
}
