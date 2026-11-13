import { NextResponse } from 'next/server';
import { loadConfig } from '@/lib/core/index.js';
import { refreshCatalog, catalogSummary } from '@/lib/core/catalog/index.js';

export const dynamic = 'force-dynamic';

// 重新拉取工作流目录。拉取较慢（逐个下载工作流 + object_info），这里后台启动、立即返回，
// 前端轮询 GET /api/catalog 的 refreshing 进度。
export async function POST(req) {
  if (process.env.IC_PUBLIC === '1') return NextResponse.json({ error: '公开模式下不允许刷新' }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const which = ['cloud', 'pool'].includes(body?.which) ? body.which : 'all';
  const cfg = loadConfig();
  refreshCatalog(cfg, which).catch(() => {});
  await new Promise((r) => setTimeout(r, 50));
  return NextResponse.json(catalogSummary(cfg));
}
