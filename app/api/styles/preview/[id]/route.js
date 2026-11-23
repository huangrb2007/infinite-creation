import fs from 'node:fs';
import path from 'node:path';
import { generatedPreviewFile } from '@/lib/core/index.js';

export const dynamic = 'force-dynamic';

const TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

export async function GET(req, { params }) {
  const { id } = await params;
  const f = generatedPreviewFile(id);
  if (!f) return new Response('not found', { status: 404 });
  return new Response(fs.readFileSync(f), { headers: { 'Content-Type': TYPES[path.extname(f).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' } });
}
