import { NextResponse } from 'next/server';
import { loadConfig, testPlugin } from '@/lib/core/index.js';

export const dynamic = 'force-dynamic';

// 测试插件连接：body.params 是设置页当前（可能未保存）的参数
export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  if (!body?.id) return NextResponse.json({ ok: false, message: '缺少插件 id' }, { status: 400 });
  const r = await testPlugin(loadConfig(), String(body.id), body.params && typeof body.params === 'object' ? body.params : null);
  return NextResponse.json(r);
}
