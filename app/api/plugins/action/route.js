import { NextResponse } from 'next/server';
import { loadConfig, runPluginAction } from '@/lib/core/index.js';

export const dynamic = 'force-dynamic';

// 插件设置页按钮（如「自动检测」）：调用插件导出的 actions[action](params)
export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  if (!body?.id || !body?.action) return NextResponse.json({ ok: false, message: '缺少插件 id 或动作' }, { status: 400 });
  return NextResponse.json(await runPluginAction(loadConfig(), String(body.id), String(body.action), body.params || null));
}
