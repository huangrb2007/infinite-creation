import { NextResponse } from 'next/server';
import { browseLocalFile } from '@/lib/core/index.js';

export const dynamic = 'force-dynamic';

const PUBLIC_MODE = process.env.IC_PUBLIC === '1';

// 在本机弹出「选择文件」对话框（本软件和浏览器在同一台电脑上），返回选中文件的完整路径
export async function POST(req) {
  if (PUBLIC_MODE) return NextResponse.json({ ok: false, message: '公开模式下不能浏览本机文件' }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  return NextResponse.json(await browseLocalFile({ filter: body?.filter, title: body?.title }));
}
