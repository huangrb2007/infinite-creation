import { NextResponse } from 'next/server';
import { loadConfig, generateStylePreview, listGeneratedPreviews } from '@/lib/core/index.js';

export const dynamic = 'force-dynamic';

// 已经生成过预览图的画风 id
export async function GET() {
  return NextResponse.json({ ids: listGeneratedPreviews() });
}

// 用当前配置的文生图模型给一个画风出预览图：{ id }
export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  if (!body?.id) return NextResponse.json({ error: '缺少画风 id' }, { status: 400 });
  try {
    await generateStylePreview(loadConfig(), String(body.id));
    return NextResponse.json({ ok: true, id: body.id });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
