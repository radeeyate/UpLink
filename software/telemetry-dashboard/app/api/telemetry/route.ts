import { NextResponse } from 'next/server';
import { parse } from 'csv-parse/sync';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Bun's native file API is much cleaner and faster than Node's fs
    const file = Bun.file('public/data/telemetry.csv');
    const fileContent = await file.text();
    
    const records = parse(fileContent, {
      columns: true,
      skip_empty_lines: true,
      cast: true, // Automatically converts numbers
    });

    const filtered = records.filter((record: any) => record.timestamp >= 0);

    return NextResponse.json(filtered);
  } catch (error) {
    console.error("Failed to read CSV:", error);
    return NextResponse.json({ error: 'Failed to read telemetry data' }, { status: 500 });
  }
}