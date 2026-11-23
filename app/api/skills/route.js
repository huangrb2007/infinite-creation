// SwotAtmk/infinite-creation · 开源地址 https://github.com/SwotAtmk/infinite-creation
import { NextResponse } from 'next/server';
import { Skills } from '@/lib/core/index.js';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(Skills.list());
}

// 技能库开关：{ name, enabled } —— 停用后 Agent 看不到、流水线不用，文件保留，随时可以再启用
export async function PATCH(req) {
  const body = await req.json().catch(() => ({}));
  const names = Array.isArray(body?.names) ? body.names.map(String) : body?.name ? [String(body.name)] : [];
  if (!names.length) return NextResponse.json({ error: '缺少技能名' }, { status: 400 });
  for (const n of names) {
    const cur = Skills.getByName(n);
    if (!cur) continue;
    Skills.upsert({ ...cur, enabled: body.enabled !== false });
  }
  return NextResponse.json(Skills.list());
}
