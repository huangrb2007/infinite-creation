import { NextResponse } from 'next/server';
import { poolStatus, poolCapabilities } from '@/lib/core/catalog/pool-client.js';
import { loadConfig } from '@/lib/core/index.js';

export const dynamic = 'force-dynamic';

// 测试号池连接：body 里的地址/校验码优先（设置页未保存时也能测），校验码留空则用已保存的
export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const saved = loadConfig().catalog?.pool || {};
  const pool = { baseUrl: body.baseUrl || saved.baseUrl, key: body.key || saved.key };
  try {
    const [st, cap] = await Promise.all([poolStatus(pool), poolCapabilities(pool)]);
    return NextResponse.json({ ok: true, workflows: (cap.workflows || []).length, limits: cap.limits || {}, status: st });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message, code: e.code || '' });
  }
}
