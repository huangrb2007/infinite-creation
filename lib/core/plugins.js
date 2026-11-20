// 生成插件（参考字字动画的插件模式，按本应用改成 Node 版）。
//
// 一个插件 = 一个文件夹：
//   plugin.json   清单：id / name / version / type（video | image）/ entry / model_family / capabilities / params
//   main.mjs      入口：export async function generate(ctx) → { files: [本机绝对路径] }；可选 export async function test(params)
// 位置：
//   程序目录 plugins/<id>/            随安装包发布的内置插件（如豆包画布助手）
//   数据目录 plugins/<id>/            用户自己导入的插件（同 id 时覆盖内置）
// 设置写在 cfg.catalog.plugins[id] = { enabled, params }，随「保存配置」写入。
//
// 插件只在「设置 → 工作流」里被选中时才参与出片（作为 r2v / t2i 的一个来源），不影响其它功能。
// 模型族（model_family）决定提示词怎么写、参考素材怎么编号、上限多少——和字字动画的「模型族」一个意思。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, DATA_DIR } from './config.js';
import { parseLazy } from './backend.js';

export const BUILTIN_PLUGINS_DIR = path.join(ROOT, 'plugins');
export const USER_PLUGINS_DIR = path.join(DATA_DIR, 'plugins');
export const PLUGIN_API_VERSION = 1;

// —— 模型族 ——
//  promptStyle：技能 / 提示词按哪一套写（seedance = Seedance 2.0 中文时间轴写法；h3 = MiniMax-H3）
//  imageToken：提示词里第 n 张参考图怎么写；declare：开头的素材声明句（空 = 不出）
export const MODEL_FAMILIES = {
  'seedance-2.0': {
    name: 'Seedance 2.0（即梦 / 豆包）',
    promptStyle: 'seedance',
    imageToken: '@图片{n}',
    declare: '@图片{n}是{label}',
    limits: { images: 9, videos: 3, audios: 3 },
    minSeconds: 4,
    maxSeconds: 15,
  },
  h3: {
    name: 'MiniMax-H3',
    promptStyle: 'h3',
    imageToken: '<Picture {n}>',
    audioToken: '<Audio {n}>',
    declare: '',
    limits: { images: 9, videos: 3, audios: 3 },
    minSeconds: 4,
    maxSeconds: 15,
  },
  none: { name: '通用', promptStyle: '', imageToken: '图{n}', declare: '图{n}是{label}', limits: null, minSeconds: 1, maxSeconds: 60 },
};
export function familyOf(id) {
  return MODEL_FAMILIES[id] || MODEL_FAMILIES.none;
}

const TYPE_CATEGORY = { video: 'r2v', image: 't2i' };
const ID_RE = /^[a-z0-9][a-z0-9_-]{1,63}$/;

function readManifest(dir, builtin) {
  const file = path.join(dir, 'plugin.json');
  let m;
  try { m = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return { id: path.basename(dir), dir, builtin, error: 'plugin.json 读不出来：' + e.message }; }
  const id = String(m.id || '').trim();
  const out = {
    id,
    name: String(m.name || id),
    version: String(m.version || ''),
    author: String(m.author || ''),
    description: String(m.description || ''),
    type: String(m.type || ''),
    entry: String(m.entry || 'main.mjs'),
    model_family: String(m.model_family || 'none'),
    capabilities: m.capabilities && typeof m.capabilities === 'object' ? m.capabilities : {},
    params: Array.isArray(m.params) ? m.params.filter((p) => p && typeof p.key === 'string') : [],
    actions: Array.isArray(m.actions) ? m.actions.filter((a) => a && typeof a.id === 'string') : [],
    help: String(m.help || ''),
    api_version: Number(m.api_version) || 1,
    dir,
    builtin,
    error: '',
  };
  if (!ID_RE.test(id)) out.error = '插件 id 只能用小写字母、数字、- 和 _';
  else if (!TYPE_CATEGORY[out.type]) out.error = '插件类型只支持 video / image';
  else if (out.api_version > PLUGIN_API_VERSION) out.error = '插件需要更新版本的短剧 Studio（api_version ' + out.api_version + '）';
  else if (path.isAbsolute(out.entry) || out.entry.includes('..') || !fs.existsSync(path.join(dir, out.entry))) out.error = '找不到插件入口文件 ' + out.entry;
  return out;
}

function scan(root, builtin) {
  if (!fs.existsSync(root)) return [];
  const out = [];
  for (const name of fs.readdirSync(root)) {
    const dir = path.join(root, name);
    try { if (!fs.statSync(dir).isDirectory() || !fs.existsSync(path.join(dir, 'plugin.json'))) continue; } catch { continue; }
    out.push(readManifest(dir, builtin));
  }
  return out;
}

/** 所有插件（用户目录同 id 覆盖内置），带上本机设置 */
export function listPlugins(cfg) {
  const byId = new Map();
  for (const p of [...scan(BUILTIN_PLUGINS_DIR, true), ...scan(USER_PLUGINS_DIR, false)]) byId.set(p.id, p);
  const set = cfg?.catalog?.plugins || {};
  return [...byId.values()].map((p) => ({
    ...p,
    enabled: set[p.id]?.enabled !== false,
    family: familyOf(p.model_family),
  }));
}

export function getPlugin(cfg, id) {
  return listPlugins(cfg).find((p) => p.id === id) || null;
}

/** 插件参数：清单默认值 + 本机设置 */
export function pluginParams(cfg, plugin) {
  const out = {};
  for (const p of plugin?.params || []) if (p.default !== undefined) out[p.key] = p.default;
  const saved = cfg?.catalog?.plugins?.[plugin?.id]?.params;
  if (saved && typeof saved === 'object') for (const [k, v] of Object.entries(saved)) if (v !== undefined && v !== null && v !== '') out[k] = v;
  return out;
}

export function pluginConcurrency(cfg, plugin) {
  const v = Number(pluginParams(cfg, plugin).concurrency ?? plugin?.capabilities?.concurrency);
  return Math.max(1, Math.min(100, Math.round(v) || 3));
}

/** 作为工作流目录的一个来源：启用、无错误的插件各出一个规格 */
export function pluginSpecs(cfg) {
  return listPlugins(cfg).filter((p) => p.enabled && !p.error).map((p) => {
    const category = TYPE_CATEGORY[p.type];
    return {
      key: 'plugin:' + p.id,
      id: 'plugin:' + p.id,
      source: 'plugin',
      name: p.name + (p.version ? ' ' + p.version : ''),
      category,
      kind: category,
      backend: 'api-plugin',
      plugin: p.id,
      modelFamily: p.model_family,
      promptStyle: p.family.promptStyle || '',
      family: '插件 · ' + p.family.name,
      roles: {},
      issues: [],
      ready: true,
    };
  });
}

// —— 选中视频引擎的提示词写法（技能 / 精简模式据此切换） ——
// 返回 'seedance' | 'h3' | ''（'' = 按原来的 H3 写法）
export function videoPromptStyle(cfg) {
  const sel = String(cfg?.catalog?.selected?.r2v || '');
  if (!sel.startsWith('plugin:') || cfg?.comfyui?.provider === 'runninghub') return '';
  const p = getPlugin(cfg, sel.slice('plugin:'.length));
  if (!p || p.error || !p.enabled) return '';
  return p.family.promptStyle || '';
}

/** 插件可用的时长档位：清单 durations，或按参数选的 durationModes（如豆包「固定每段 15 秒」） */
export function pluginDurations(cfg, plugin) {
  const caps = plugin?.capabilities || {};
  const modes = caps.durationModes && typeof caps.durationModes === 'object' ? caps.durationModes : null;
  if (modes && caps.durationModeParam) {
    const v = String(pluginParams(cfg, plugin)[caps.durationModeParam] ?? '');
    if (Array.isArray(modes[v])) return modes[v].map(Number).filter((n) => n > 0);
  }
  return Array.isArray(caps.durations) ? caps.durations.map(Number).filter((n) => n > 0) : null;
}

/** 选中视频插件的能力（时长、参考图上限），给技能适配段用 */
export function videoEngineInfo(cfg) {
  const sel = String(cfg?.catalog?.selected?.r2v || '');
  if (!sel.startsWith('plugin:')) return null;
  const p = getPlugin(cfg, sel.slice('plugin:'.length));
  if (!p || p.error) return null;
  const caps = p.capabilities || {};
  const fam = p.family;
  return {
    id: p.id,
    name: p.name,
    promptStyle: fam.promptStyle || '',
    durations: pluginDurations(cfg, p),
    maxSeconds: Number(caps.maxSeconds) || fam.maxSeconds,
    minSeconds: Number(caps.minSeconds) || fam.minSeconds,
    maxImages: Math.min(Number(caps.maxImages) || 99, fam.limits?.images || 99),
    audioRefs: !!caps.audio,
    nativeAudio: caps.nativeAudio !== false,
  };
}

// —— 运行 ——
const modCache = (globalThis.__icPluginMods = globalThis.__icPluginMods || new Map());
export async function loadPluginModule(plugin) {
  const entry = path.join(plugin.dir, plugin.entry);
  const mtime = fs.statSync(entry).mtimeMs;
  const hit = modCache.get(entry);
  if (hit && hit.mtime === mtime) return hit.mod;
  // 运行时路径：不让 webpack 打包；带上 mtime，插件文件改了重新加载
  const mod = await import(/* webpackIgnore: true */ pathToFileURL(entry).href + '?v=' + Math.round(mtime));
  modCache.set(entry, { mtime, mod });
  return mod;
}

const absOf = (f) => parseLazy(f)?.abs || f;

/** 秒数按插件支持的档位取：有档位取「不短于分镜」的最小档，否则夹在上下限之间 */
export function snapSeconds(sec, info) {
  const s = Number(sec) || 5;
  if (info?.durations?.length) {
    const d = [...info.durations].sort((a, b) => a - b);
    return d.find((x) => x >= s - 0.5) || d[d.length - 1];
  }
  return Math.max(info?.minSeconds || 1, Math.min(info?.maxSeconds || 60, Math.round(s)));
}

/**
 * 把 __MINIMAX_H3_REF_N__（全局编号）换成这个族的写法，只给实际提交的素材编号；没提交的换回素材名。
 * 族要求素材声明句（Seedance：@图片1是林冬）时，在提示词开头补一行。
 */
export function familyPrompt(text, refs, used, fam) {
  const counter = { image: 0, audio: 0, video: 0 };
  const label = new Map();
  for (const r of used) {
    const t = r.type === 'audio' ? 'audio' : r.type === 'video' ? 'video' : 'image';
    counter[t] += 1;
    const tok = t === 'image' ? fam.imageToken : t === 'audio' ? (fam.audioToken || '音频{n}') : (fam.videoToken || '视频{n}');
    label.set(r, tok.replace('{n}', String(counter[t])));
  }
  let out = String(text || '').replace(/__MINIMAX_H3_REF_(\d+)__/g, (m, n) => {
    const r = refs[Number(n) - 1];
    return label.get(r) || (r?.name ? String(r.name) : '');
  });
  if (fam.declare && used.length) {
    const lines = used.filter((r) => r.type === 'image' && label.has(r)).filter((r) => !out.includes(label.get(r) + '是'))
      .map((r) => fam.declare.replace('{n}', label.get(r).replace(/\D+/g, '')).replace('{label}', refLabel(r)));
    if (lines.length) out = lines.join('；') + '。\n' + out;
  }
  return out;
}

function refLabel(r) {
  const name = String(r.name || '').trim();
  // refs.js 的 label 形如「林冬（人物形象）」「出租屋（场景背景）」「手机（道具）」
  const tag = /（([^（）]*)）$/.exec(String(r.label || ''))?.[1] || '';
  const kind = { character: '角色形象', costume: '角色服装', age: '角色造型', scene: '场景', prop: '道具' }[r.category]
    || (/人物形象/.test(tag) ? '角色形象' : /场景/.test(tag) ? '场景' : /道具/.test(tag) ? '道具' : tag ? '角色造型' : '');
  return name ? name + (kind ? '的' + kind + '图' : '') : (kind ? kind + '图' : '参考图');
}

const gates = (globalThis.__icPluginGates = globalThis.__icPluginGates || new Map());
async function withPluginGate(id, limit, fn) {
  let g = gates.get(id);
  if (!g) { g = { running: 0, waiters: [] }; gates.set(id, g); }
  while (g.running >= limit) await new Promise((r) => g.waiters.push(r));
  g.running++;
  try { return await fn(); } finally { g.running--; g.waiters.shift()?.(); }
}

/** runWorkflow 的插件分支：返回 { prompt_id, outputs:[{ kind, filename, localPath }] } */
export async function runPluginWorkflow(cfg, spec, params, opts = {}) {
  const plugin = getPlugin(cfg, spec.plugin);
  if (!plugin) throw new Error('选的插件已不存在：' + spec.plugin + '（到 设置 → 工作流 → 插件 里看看）');
  if (plugin.error) throw new Error('插件「' + plugin.name + '」不可用：' + plugin.error);
  if (!plugin.enabled) throw new Error('插件「' + plugin.name + '」已停用');
  const fam = plugin.family;
  const caps = plugin.capabilities || {};
  const info = { durations: pluginDurations(cfg, plugin), minSeconds: Number(caps.minSeconds) || fam.minSeconds, maxSeconds: Number(caps.maxSeconds) || fam.maxSeconds };
  const refs = params.references || [];
  const maxImg = Math.min(Number(caps.maxImages) || 99, fam.limits?.images || 99);
  const used = [
    ...refs.filter((r) => r.type === 'image').slice(0, maxImg),
    ...(caps.audio ? refs.filter((r) => r.type === 'audio').slice(0, fam.limits?.audios || 3) : []),
    ...(caps.video ? refs.filter((r) => r.type === 'video').slice(0, fam.limits?.videos || 3) : []),
  ];
  const prompt = familyPrompt(params.positive_prompt || params.prompt || '', refs, refs.filter((r) => used.includes(r)), fam);
  const settings = pluginParams(cfg, plugin);
  const mod = await loadPluginModule(plugin);
  if (typeof mod.generate !== 'function') throw new Error('插件「' + plugin.name + '」没有导出 generate()');
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ic-plugin-'));
  const kind = plugin.type === 'video' ? 'videos' : 'images';
  return withPluginGate(plugin.id, pluginConcurrency(cfg, plugin), async () => {
    if (opts.isAborted?.()) throw new Error('已取消');
    const res = await mod.generate({
      prompt,
      negativePrompt: params.negative_prompt || '',
      images: used.filter((r) => r.type === 'image').map((r) => absOf(r.filename)),
      audios: used.filter((r) => r.type === 'audio').map((r) => absOf(r.filename)),
      videos: used.filter((r) => r.type === 'video').map((r) => absOf(r.filename)),
      seconds: snapSeconds(params.seconds, info),
      ratio: params.aspect_ratio || '16:9',
      resolution: params.resolution || '',
      width: params.width, height: params.height,
      seed: params.seed,
      regenerate: !!params.regenerate,
      params: settings,
      outDir,
      isAborted: () => !!opts.isAborted?.(),
      onProgress: (message, pct) => opts.onStatus?.({ kind: 'progress', message: '[' + plugin.name + '] ' + message + (pct != null ? ' ' + Math.round(pct) + '%' : '') }),
      onSubmitted: (id) => opts.onSubmitted?.(String(id)),
    });
    const files = (Array.isArray(res) ? res : res?.files || []).map(String).filter((f) => f && fs.existsSync(f));
    if (!files.length) throw new Error('插件「' + plugin.name + '」没有返回' + (kind === 'videos' ? '视频' : '图片') + '文件');
    return {
      prompt_id: String(res?.taskId || ''),
      outputs: files.map((f) => ({ kind, filename: path.basename(f), localPath: f, cleanupDir: outDir })),
    };
  });
}

/** 设置页「测试连接」 */
export async function testPlugin(cfg, id, paramsOverride) {
  const plugin = getPlugin(cfg, id);
  if (!plugin) return { ok: false, message: '插件不存在' };
  if (plugin.error) return { ok: false, message: plugin.error };
  try {
    const mod = await loadPluginModule(plugin);
    if (typeof mod.test !== 'function') return { ok: true, message: '插件没有提供连接测试，已能正常加载' };
    const params = { ...pluginParams(cfg, plugin), ...(paramsOverride || {}) };
    const r = await mod.test(params);
    return { ok: !!r?.ok, message: String(r?.message || (r?.ok ? '连接正常' : '连接失败')) };
  } catch (e) {
    return { ok: false, message: String(e?.message || e).slice(0, 400) };
  }
}

/** 导入插件 zip（解到用户插件目录）；返回 { ok, id } */
export async function installPluginZip(buffer) {
  const { default: AdmZip } = await import('adm-zip');
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries().filter((e) => !e.isDirectory);
  const manifestEntry = entries.find((e) => /(^|\/)plugin\.json$/.test(e.entryName) && e.entryName.split('/').length <= 2);
  if (!manifestEntry) throw new Error('压缩包里没有 plugin.json');
  const prefix = manifestEntry.entryName.replace(/plugin\.json$/, '');
  let m;
  try { m = JSON.parse(manifestEntry.getData().toString('utf8')); } catch { throw new Error('plugin.json 不是合法 JSON'); }
  const id = String(m.id || '');
  if (!ID_RE.test(id)) throw new Error('插件 id 不合法：' + id);
  const target = path.join(USER_PLUGINS_DIR, id);
  const tmp = target + '.tmp-' + Date.now();
  fs.mkdirSync(tmp, { recursive: true });
  for (const e of entries) {
    if (!e.entryName.startsWith(prefix)) continue;
    const rel = e.entryName.slice(prefix.length);
    const dst = path.resolve(tmp, rel);
    if (!dst.startsWith(path.resolve(tmp) + path.sep)) throw new Error('压缩包里有越界路径：' + e.entryName);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, e.getData());
  }
  const check = readManifest(tmp, false);
  if (check.error) { fs.rmSync(tmp, { recursive: true, force: true }); throw new Error(check.error); }
  fs.rmSync(target, { recursive: true, force: true });
  fs.renameSync(tmp, target);
  return { ok: true, id };
}

/** 设置页按钮：调用插件导出的 actions[name](params) → { ok, value?, message } */
export async function runPluginAction(cfg, id, name, paramsOverride) {
  const plugin = getPlugin(cfg, id);
  if (!plugin || plugin.error) return { ok: false, message: plugin?.error || '插件不存在' };
  try {
    const mod = await loadPluginModule(plugin);
    const fn = mod.actions && typeof mod.actions[name] === 'function' ? mod.actions[name] : null;
    if (!fn) return { ok: false, message: '插件不支持这个操作：' + name };
    const r = await fn({ ...pluginParams(cfg, plugin), ...(paramsOverride || {}) });
    return { ok: !!r?.ok, value: r?.value, message: String(r?.message || '') };
  } catch (e) {
    return { ok: false, message: String(e?.message || e).slice(0, 400) };
  }
}

/**
 * 本机「选择文件」对话框（Windows：PowerShell + WinForms）。浏览器拿不到本地文件的完整路径，
 * 所以由本机的后端弹框；本软件的后端和界面在同一台电脑上运行。
 * filter 形如「豆包画布助手|*.exe」
 */
export async function browseLocalFile({ filter = '所有文件|*.*', title = '选择文件' } = {}) {
  if (process.platform !== 'win32') return { ok: false, message: '只有 Windows 版能弹出文件选择框，请手动填写路径' };
  const { spawn } = await import('node:child_process');
  const esc = (v) => String(v || '').replace(/'/g, "''").replace(/[\r\n]/g, ' ');
  const ps = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$f = New-Object System.Windows.Forms.OpenFileDialog',
    "$f.Filter = '" + esc(filter) + "'",
    "$f.Title = '" + esc(title) + "'",
    '$f.Multiselect = $false',
    // 后台进程弹出的框会被系统压在其它窗口后面：先显示一个置顶的透明小窗口并激活它，再以它为父窗口弹框
    '$top = New-Object System.Windows.Forms.Form -Property @{TopMost=$true; ShowInTaskbar=$true; Text=\'选择文件\'; Opacity=0; StartPosition=\'CenterScreen\'; Width=1; Height=1}',
    '$top.Show(); $top.Activate(); $top.BringToFront(); [System.Windows.Forms.Application]::DoEvents()',
    'if ($f.ShowDialog($top) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::OutputEncoding=[Text.Encoding]::UTF8; Write-Output $f.FileName }',
    '$top.Close()',
  ].join('; ');
  return new Promise((resolve) => {
    let out = '';
    let done = false;
    const child = spawn('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-Command', ps], { windowsHide: false });
    const timer = setTimeout(() => { if (!done) { done = true; try { child.kill(); } catch {} resolve({ ok: false, message: '文件选择框没有出现或超时：请点「自动检测」，或直接粘贴 exe 的完整路径' }); } }, 2 * 60_000);
    let err = '';
    child.stdout.on('data', (d) => { out += d.toString('utf8'); });
    child.stderr.on('data', (d) => { err += d.toString('utf8'); });
    child.on('error', (e) => { if (!done) { done = true; clearTimeout(timer); resolve({ ok: false, message: '打不开文件选择框：' + e.message }); } });
    child.on('close', () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const v = out.trim().split(/\r?\n/).pop() || '';
      resolve(v ? { ok: true, value: v } : { ok: false, message: err.trim() ? '文件选择框打开失败：' + err.trim().slice(0, 200) + '（可以点「自动检测」或手动粘贴路径）' : '没有选择文件' });
    });
  });
}
