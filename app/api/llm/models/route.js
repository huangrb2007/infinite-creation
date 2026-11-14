import { NextResponse } from 'next/server';
import { loadConfig, listLlmModels } from '@/lib/core/index.js';

export const dynamic = 'force-dynamic';

// 列出 LLM 接口下的全部模型（设置页「获取模型」）。body 里的地址/Key 优先（未保存也能拉），Key 留空用已保存的。
export async function POST(req) {
  if (process.env.IC_PUBLIC === '1') return NextResponse.json({ ok: false, error: '公开模式下不可用' }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const saved = loadConfig().llm || {};
  const llm = { baseUrl: body.baseUrl || saved.baseUrl, apiKey: body.apiKey || saved.apiKey };
  try {
    const models = await listLlmModels(llm);
    return NextResponse.json({ ok: true, models });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message });
  }
}
