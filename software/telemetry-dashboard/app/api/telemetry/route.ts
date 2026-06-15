import { NextResponse } from 'next/server';

const CSV_PATH = 'public/data/telemetry.csv';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const file = Bun.file(CSV_PATH);
    const text = await file.text();
    return new NextResponse(text, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv',
        'Cache-Control': 'no-cache, must-revalidate',
      },
    });
  } catch (error) {
    console.error('Failed to read CSV:', error);
    return NextResponse.json({ error: 'Failed to read telemetry data' }, { status: 500 });
  }
}