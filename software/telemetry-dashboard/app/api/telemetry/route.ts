import { NextResponse } from 'next/server';
import { parse } from 'csv-parse/sync';

export const dynamic = 'force-dynamic';

const BOOL_FIELDS = new Set(["sd_card_ok", "camera_ok", "gps_fix_ok"]);

export async function GET() {
  try {
    const file = Bun.file('public/data/telemetry.csv');
    const fileContent = await file.text();

    const records = parse(fileContent, {
      columns: true,
      skip_empty_lines: true,
      cast: (value: any, context: any) => {
        if (BOOL_FIELDS.has(context.column)) {
          return value === "True";
        }
        if (typeof value === "string" && value.trim() !== "") {
          const num = Number(value);
          if (!Number.isNaN(num)) return num;
        }
        return value;
      },
    });

    return NextResponse.json(records);
  } catch (error) {
    console.error("Failed to read CSV:", error);
    return NextResponse.json({ error: 'Failed to read telemetry data' }, { status: 500 });
  }
}