import { NextResponse } from 'next/server';
import { loadConfig } from '@/lib/core/index.js';
import { catalogSummary } from '@/lib/core/catalog/index.js';

export const dynamic = 'force-dynamic';

// 设置页「工作流」：按类别列出云端 ComfyUI / 号池工作流及识别状态
export async function GET() {
  return NextResponse.json(catalogSummary(loadConfig()));
}
