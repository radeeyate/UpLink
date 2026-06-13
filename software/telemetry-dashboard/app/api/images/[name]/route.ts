import { NextResponse } from 'next/server';
import { basename, extname, join } from 'path';
import { readFile } from 'fs/promises';

export const dynamic = 'force-dynamic';

const getContentType = (fileName: string) => {
  const extension = extname(fileName).toLowerCase();

  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.png') return 'image/png';
  if (extension === '.gif') return 'image/gif';
  if (extension === '.webp') return 'image/webp';
  if (extension === '.bmp') return 'image/bmp';
  if (extension === '.svg') return 'image/svg+xml';

  return 'application/octet-stream';
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const { name } = await params;
    const decodedName = decodeURIComponent(name);
    const safeName = basename(decodedName);

    if (!safeName || safeName !== decodedName) {
      return NextResponse.json({ error: 'Invalid image path' }, { status: 400 });
    }

    const imagesDir = process.env.TELEMETRY_IMAGES_DIR ?? join(process.cwd(), 'public/data/images');
    const imagePath = join(imagesDir, safeName);
    const imageData = await readFile(imagePath);

    return new NextResponse(new Uint8Array(imageData), {
      status: 200,
      headers: {
        'Content-Type': getContentType(safeName),
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Image not found' }, { status: 404 });
  }
}
