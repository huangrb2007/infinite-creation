import { NextResponse } from 'next/server';
import { loadConfig, videoEngineInfo } from '@/lib/core/index.js';
import { effectiveNodeSkills } from '@/lib/agent/agent-loop.js';
import { listSkills } from '@/lib/agent/skill-engine.js';

export const dynamic = 'force-dynamic';

// 流水线编排「实际会用到的技能」：按当前保存的配置、技能库开关和出片引擎算出来（和 Agent 运行时同一套逻辑）
export async function GET(req) {
  const cfg = loadConfig();
  const url = new URL(req.url);
  const style = url.searchParams.get('style') || '';
  let engine = null;
  try { engine = videoEngineInfo(cfg); } catch {}
  const installed = listSkills().map((x) => x.name);
  const r = effectiveNodeSkills(cfg.skillPipeline, installed, style ? { style } : null, engine);
  return NextResponse.json({ engine: engine ? { id: engine.id, name: engine.name, promptStyle: engine.promptStyle } : null, enabled: installed, nodes: r.nodes });
}
