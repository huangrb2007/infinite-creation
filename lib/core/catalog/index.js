// 工作流目录：云端 ComfyUI + 号池 + 内置规格，按类别供设置页选择、供流水线取用。
//
// 缓存：data/catalog.json（拉取结果，含转换好的 API 模板），刷新才重新拉。
// 配置：config.catalog = {
//   pool: { enabled, baseUrl, key, instanceType },
//   series: ['U','B','N','J','P'],        // 云端只拉这些字母前缀的文件夹（空 = 全部）
//   selected: { r2v: 'cloud:U视频-…/U01-….json' | 'pool:<id>' | 'builtin:<id>' },
//   overrides: { [key]: { category?, roles?: { role: { node, field } } } },
// }
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../config.js';
import { CATEGORIES } from './categories.js';
import { fetchCloudCatalog } from './comfy-source.js';
import { fetchPoolCatalog, withT2iVariant } from './pool-source.js';
import { apiImageSpecs } from './api-image.js';
import { apiAudioSpecs } from './api-audio.js';
import { apiMediaSpecs } from './api-media.js';

const FILE = () => path.join(DATA_DIR, 'catalog.json');
const memo = (globalThis.__icCatalog = globalThis.__icCatalog || { data: null, mtime: 0, refreshing: null });

export function readCatalog() {
  try {
    const st = fs.statSync(FILE());
    if (memo.data && memo.mtime === st.mtimeMs) return memo.data;
    memo.data = JSON.parse(fs.readFileSync(FILE(), 'utf8'));
    memo.mtime = st.mtimeMs;
  } catch {
    memo.data = memo.data || { cloud: { specs: [] }, pool: { specs: [] } };
  }
  return memo.data;
}

function writeCatalog(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = FILE() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, FILE());
  memo.data = data;
  memo.mtime = fs.statSync(FILE()).mtimeMs;
}

export function refreshState() {
  return memo.refreshing ? { ...memo.progress } : null;
}

/** 重新拉取目录。which: 'cloud' | 'pool' | 'all' */
export async function refreshCatalog(cfg, which = 'all') {
  if (memo.refreshing) return memo.refreshing;
  memo.progress = { which, done: 0, total: 0 };
  memo.refreshing = (async () => {
    const data = JSON.parse(JSON.stringify(readCatalog()));
    const cat = cfg.catalog || {};
    if (which !== 'pool' && cat.cloud?.enabled === false) {
      data.cloud = { specs: [], refreshedAt: Date.now(), error: '', disabled: true };
    } else if (which !== 'pool') {
      const base = cfg.comfyui?.baseUrl;
      try {
        const series = (cat.series || []).map((s) => String(s).toUpperCase());
        const r = await fetchCloudCatalog(base, {
          include: (_, c) => !series.length || series.includes(c.series),
          onProgress: (done, total) => { memo.progress = { which, done, total }; },
        });
        data.cloud = { specs: r.specs, refreshedAt: Date.now(), baseUrl: base, error: '' };
      } catch (e) {
        data.cloud = { ...(data.cloud || { specs: [] }), error: e.message, refreshedAt: Date.now() };
      }
    }
    if (which !== 'cloud' && !(cat.pool?.enabled && cat.pool?.baseUrl)) {
      data.pool = { specs: [], refreshedAt: Date.now(), error: cat.pool?.enabled ? '没有填号池地址' : '', disabled: !cat.pool?.enabled };
    } else if (which !== 'cloud') {
      try {
        const r = await fetchPoolCatalog(cat.pool);
        data.pool = { specs: r.specs, limits: r.limits, version: r.version, refreshedAt: Date.now(), error: '' };
        if (!r.specs.length) data.pool.error = '号池返回了 0 个工作流：请到号池后台 → 客户端，确认这个校验码对应的客户端已授权工作流';
      } catch (e) {
        data.pool = { ...(data.pool || { specs: [] }), error: e.message, refreshedAt: Date.now() };
      }
    }
    writeCatalog(data);
    return data;
  })().finally(() => { memo.refreshing = null; });
  return memo.refreshing;
}

function applyOverride(spec, ov) {
  if (!ov) return spec;
  const out = { ...spec, roles: { ...spec.roles, ...(ov.roles || {}) } };
  if (ov.category) { out.category = ov.category; out.kind = ov.category; }
  for (const [k, v] of Object.entries(ov.roles || {})) if (v === null) delete out.roles[k];
  out.overridden = true;
  return out;
}

export function allCatalogSpecs(cfg) {
  const data = readCatalog();
  const ov = cfg?.catalog?.overrides || {};
  return [...(data.cloud?.specs || []), ...(data.pool?.specs || []).flatMap(withT2iVariant), ...apiImageSpecs(cfg), ...apiAudioSpecs(cfg), ...apiMediaSpecs(cfg)].map((s) => applyOverride(s, ov[s.key]));
}

export function getCatalogSpec(cfg, key) {
  if (!key || key.startsWith('builtin:')) return null;
  return allCatalogSpecs(cfg).find((s) => s.key === key) || null;
}

// 设置页用：按类别分组的摘要（不带模板，体积小）
export function catalogSummary(cfg) {
  const data = readCatalog();
  const specs = allCatalogSpecs(cfg);
  const groups = CATEGORIES.map((c) => ({
    ...c,
    selected: cfg?.catalog?.selected?.[c.id] || '',
    items: specs.filter((s) => s.category === c.id).map((s) => ({
      key: s.key, name: s.name, source: s.source, folder: s.folder || '', series: s.series || '',
      family: s.family || '', ready: !!s.ready && !(s.issues || []).length, issues: s.issues || [],
      roles: Object.keys(s.roles || {}), overridden: !!s.overridden,
      slots: Object.fromEntries(Object.entries(s.slots || {}).map(([k, v]) => [k, v.length])),
    })).sort((a, b) => Number(b.ready) - Number(a.ready) || a.name.localeCompare(b.name, 'zh')),
  }));
  const unclassified = specs.filter((s) => !s.category).map((s) => ({ key: s.key, name: s.name, folder: s.folder, issues: s.issues }));
  return {
    groups,
    unclassified,
    cloud: { refreshedAt: data.cloud?.refreshedAt || 0, error: data.cloud?.error || '', count: (data.cloud?.specs || []).length, disabled: cfg?.catalog?.cloud?.enabled === false },
    pool: { refreshedAt: data.pool?.refreshedAt || 0, error: data.pool?.error || '', count: (data.pool?.specs || []).length, limits: data.pool?.limits || {} },
    refreshing: refreshState(),
  };
}

export { CATEGORIES };
