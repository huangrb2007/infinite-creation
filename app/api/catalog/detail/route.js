import { NextResponse } from 'next/server';
import { loadConfig } from '@/lib/core/index.js';
import { getCatalogSpec } from '@/lib/core/catalog/index.js';

export const dynamic = 'force-dynamic';

// 单个工作流的识别详情：已识别的角色 + 可供手动指定的节点字段（只列可直接填值的字段）
export async function GET(req) {
  const key = new URL(req.url).searchParams.get('key') || '';
  const spec = getCatalogSpec(loadConfig(), key);
  if (!spec) return NextResponse.json({ error: '未找到工作流：' + key }, { status: 404 });
  const tpl = spec.template || {};
  const fields = [];
  for (const [id, n] of Object.entries(tpl)) {
    for (const [f, v] of Object.entries(n.inputs || {})) {
      if (Array.isArray(v) || (v !== null && typeof v === 'object')) continue;
      fields.push({ node: id, field: f, title: n._meta?.title || n.class_type, classType: n.class_type, sample: typeof v === 'string' ? v.slice(0, 60) : v });
    }
  }
  const label = (r) => {
    const n = tpl[r.node];
    return { ...r, title: n?._meta?.title || n?.class_type || '(节点不存在)' };
  };
  return NextResponse.json({
    key: spec.key, name: spec.name, source: spec.source, category: spec.category, family: spec.family || '',
    issues: spec.issues || [], ready: !!spec.ready,
    roles: Object.fromEntries(Object.entries(spec.roles || {}).map(([k, r]) => [k, label(r)])),
    slots: Object.fromEntries(Object.entries(spec.slots || {}).map(([k, v]) => [k, v.map(label)])),
    fields,
  });
}
