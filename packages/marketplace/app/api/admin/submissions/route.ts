import { NextResponse } from 'next/server';
import * as fs from 'node:fs';
import * as path from 'node:path';

export function GET() {
  const submissionsPath = path.join(process.cwd(), 'data', 'submissions.json');
  try {
    const raw = fs.readFileSync(submissionsPath, 'utf-8');
    return NextResponse.json({ submissions: JSON.parse(raw) });
  } catch {
    return NextResponse.json({ submissions: [] });
  }
}
