import { NextResponse } from 'next/server';
import { loadConfig, listPlugins, pluginParams, USER_PLUGINS_DIR } from '@/lib/core/index.js';

export const dynamic = 'force-dynamic';

// 生成插件列表（设置 → 工作流 → 插件）。values 是「清单默认值 + 已保存设置」，设置页据此显示表单。
export async function GET() {
  const cfg = loadConfig();
  const plugins = listPlugins(cfg).map((p) => ({
    id: p.id, name: p.name, version: p.version, author: p.author, description: p.description, help: p.help,
    type: p.type, model_family: p.model_family, familyName: p.family?.name || '', promptStyle: p.family?.promptStyle || '',
    capabilities: p.capabilities, params: p.params, actions: p.actions || [], builtin: p.builtin, enabled: p.enabled, error: p.error,
    values: pluginParams(cfg, p),
  }));
  return NextResponse.json({ plugins, userDir: USER_PLUGINS_DIR });
}
