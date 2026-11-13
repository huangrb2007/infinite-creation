// 云端 ComfyUI 工作流目录：列出 user/default/workflows 下保存的工作流，
// 按文件夹 + 文件名归类，转换成 API 格式后自动识别参数。
import { categoryOfFolder } from './categories.js';
import { analyzeApiWorkflow, isApiFormat } from './analyze.js';
import { uiToApi } from './ui-to-api.js';

const norm = (u) => String(u || '').trim().replace(/\/+$/, '');

async function getJson(url, timeoutMs = 60_000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error('HTTP ' + res.status + '：' + url);
  return res.json();
}

export async function listCloudWorkflows(baseUrl) {
  const list = await getJson(norm(baseUrl) + '/api/userdata?dir=workflows&recurse=true&split=false&full_info=true');
  return (Array.isArray(list) ? list : []).filter((f) => /\.json$/i.test(f.path || f));
}

export async function fetchCloudWorkflow(baseUrl, relPath) {
  return getJson(norm(baseUrl) + '/api/userdata/' + encodeURIComponent('workflows/' + relPath));
}

export async function fetchObjectInfo(baseUrl) {
  return getJson(norm(baseUrl) + '/object_info', 120_000);
}

// —— 归类 ——
// 你的工作流库按「字母前缀 + 中文名」分文件夹（U视频-MINIMAX-H3、N声音生成-音乐生成-声音克隆 …）。
// 先看文件名里的明确用途，再看文件夹，最后交给节点识别。
const NAME_FIRST = [
  ['digital_human', /数字人|对口型|口播|InfiniteTalk|Avatar/i],
  ['motion', /动作迁移|动作替换|动作模仿|人物替换|Animate|SCAIL/i],
  ['tts_clone', /克隆|clone/i],
  ['music', /音乐|music|歌曲|ACE-Step|yue/i],
  ['i2i', /图像编辑|图像修改|编辑版|image.?edit/i],
];
const FOLDER_RULES = [
  ['digital_human', /数字人|对口型/],
  ['motion', /动作迁移|人物替换/],
  ['tts', /声音|音频|语音|TTS/i],
  ['r2v', /视频/],
  ['t2i', /图像|生图|文生图/],
];
// 不参与短剧流水线的工具类文件夹（放大/去水印/设置/视角等），默认不进目录
const SKIP_FOLDER = /放大|去水印|工具|设置|视角|高斯/;

export function classifyPath(relPath) {
  const parts = String(relPath).split('/');
  const file = parts[parts.length - 1].replace(/\.json$/i, '');
  const top = parts.length > 1 ? parts[0] : '';
  const series = (top.match(/^([A-Z])/) || [])[1] || '';
  if (SKIP_FOLDER.test(top)) return { category: '', series, folder: top, skip: true };
  for (const [id, re] of NAME_FIRST) if (re.test(file)) return { category: id, series, folder: top };
  const direct = categoryOfFolder(top.replace(/^[A-Z]-?/, ''));
  if (direct) return { category: direct, series, folder: top };
  for (const [id, re] of FOLDER_RULES) if (re.test(top)) return { category: id, series, folder: top, loose: true };
  return { category: '', series, folder: top };
}

/**
 * 拉取并分析云端工作流。
 * @param {string} baseUrl
 * @param {{ include?: (path)=>boolean, objectInfo?: object, onProgress?: (n,total)=>void }} opt
 */
export async function fetchCloudCatalog(baseUrl, { include, objectInfo, onProgress } = {}) {
  const files = await listCloudWorkflows(baseUrl);
  const oi = objectInfo || await fetchObjectInfo(baseUrl);
  const specs = [];
  let n = 0;
  const wanted = files.filter((f) => {
    const c = classifyPath(f.path);
    return !c.skip && (!include || include(f.path, c));
  });
  for (const f of wanted) {
    n += 1;
    onProgress?.(n, wanted.length);
    const cls = classifyPath(f.path);
    try {
      const json = await fetchCloudWorkflow(baseUrl, f.path);
      specs.push(specFromJson(json, f.path, cls, oi, f.modified));
    } catch (e) {
      specs.push(brokenSpec(f.path, cls, '读取失败：' + e.message));
    }
  }
  return { specs, objectInfoAt: Date.now() };
}

function brokenSpec(relPath, cls, msg) {
  return {
    key: 'cloud:' + relPath, source: 'cloud', backend: 'comfy', id: 'cloud:' + relPath,
    name: relPath.split('/').pop().replace(/\.json$/i, ''), path: relPath, folder: cls.folder, series: cls.series,
    category: cls.category, kind: cls.category, roles: {}, issues: [msg], ready: false,
  };
}

export function specFromJson(json, relPath, cls, objectInfo, modified) {
  let api = json;
  const convIssues = [];
  if (!isApiFormat(json)) {
    const r = uiToApi(json, objectInfo);
    api = r.prompt;
    convIssues.push(...r.issues);
  }
  const a = analyzeApiWorkflow(api, { name: relPath, category: cls.loose ? '' : cls.category });
  // 文件夹给的是宽泛类（如「声音」），节点识别能细分时以识别为准
  if (cls.loose && !a.category) a.category = cls.category;
  const missing = missingNodes(api, objectInfo);
  const issues = [...convIssues, ...a.issues];
  if (missing.length) issues.unshift('云端缺少节点：' + missing.slice(0, 5).join('、') + (missing.length > 5 ? ' 等' : ''));
  return {
    key: 'cloud:' + relPath,
    source: 'cloud',
    backend: 'comfy',
    id: 'cloud:' + relPath,
    name: relPath.split('/').pop().replace(/\.json$/i, ''),
    path: relPath,
    folder: cls.folder,
    series: cls.series,
    modified: modified || 0,
    ...a,
    kind: a.category,
    template: api,
    issues,
    ready: issues.length === 0,
  };
}

function missingNodes(api, oi) {
  if (!oi) return [];
  return [...new Set(Object.values(api || {}).map((n) => n.class_type).filter((t) => t && !oi[t]))];
}
