import { NextResponse } from 'next/server';
import { STYLE_LIBRARY } from '@/lib/shared/index.js';
import { ensureSkillStyles } from '@/lib/agent/style-registry.js';
import { listGeneratedPreviews } from '@/lib/core/index.js';

export const dynamic = 'force-dynamic';

// 画风库（含已安装的白昼技能包画风）：给选择器用，不含长文本
export async function GET() {
  ensureSkillStyles();
  const gen = new Set(listGeneratedPreviews());
  const styles = STYLE_LIBRARY.map((s) => ({
    id: s.id, name: s.name, kind: s.none ? '' : s.kind || (s.family === 'realistic' ? '真人' : s.family === '3d' ? '3D' : '2D'), family: s.family,
    fit: s.fit || s.desc || '', hidden: !!s.hidden, none: !!s.none, source: s.source || (s.video ? 'builtin' : 'legacy'), group: s.group || '',
    preset: !!(s.video || s.character), generatedPreview: gen.has(s.id),
  }));
  return NextResponse.json({ styles });
}
