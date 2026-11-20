import { NextResponse } from 'next/server';
import { installPluginZip } from '@/lib/core/index.js';

export const dynamic = 'force-dynamic';

const MAX = 50 * 1024 * 1024;
const PUBLIC_MODE = process.env.IC_PUBLIC === '1';

// 导入插件 zip：解到数据目录 plugins/<id>/（同 id 覆盖）。插件代码在本机运行，只装信得过的插件。
export async function POST(req) {
  if (PUBLIC_MODE) return NextResponse.json({ error: '公开模式下不允许安装插件' }, { status: 403 });
  try {
    if (Number(req.headers.get('content-length') || 0) > MAX) return NextResponse.json({ error: '插件包过大：上限 50MB' }, { status: 413 });
    const buf = Buffer.from(await req.arrayBuffer());
    if (!buf.length) return NextResponse.json({ error: '缺少 zip 文件内容' }, { status: 400 });
    if (buf.length > MAX) return NextResponse.json({ error: '插件包过大：上限 50MB' }, { status: 413 });
    const r = await installPluginZip(buf);
    return NextResponse.json(r);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
