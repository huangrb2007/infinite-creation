// LLM 接口自带的图片生成模型（OpenAI 兼容 /images/generations、/images/edits）作为文生图 / 图生图来源。
// 设置 → LLM 里「获取模型列表」后，图片类模型会出现在「工作流」页的文生图 / 图生图下拉里（key = api:<类别>:<模型名>）。
// 两种协议：中转站常见的异步任务（/image/generations 提交 + 轮询）优先，不支持再走 OpenAI 的 /images/generations。
import fs from 'node:fs';
import path from 'node:path';
import { llmEndpoint } from '../llm.js';
import { parseLazy } from '../backend.js';

export function apiImageSpecs(cfg) {
  const models = (cfg?.llm?.models || []).filter((m) => m.kind === 'image');
  const out = [];
  for (const m of models) {
    for (const category of ['t2i', 'i2i']) {
      out.push({
        key: 'api:' + category + ':' + m.id,
        id: 'api:' + m.id,
        source: 'api',
        backend: 'api-image',
        name: m.id,
        model: m.id,
        category,
        kind: category,
        roles: {},
        issues: [],
        ready: true,
        family: 'LLM 接口图片模型',
      });
    }
  }
  return out;
}

function apiBase(cfg) {
  return llmEndpoint(cfg.llm?.baseUrl).replace(/\/chat\/completions$/, '');
}

function authHeaders(cfg) {
  return cfg.llm?.apiKey ? { Authorization: 'Bearer ' + cfg.llm.apiKey } : {};
}

// OpenAI 只认这几个尺寸；其它兼容接口一般接受任意尺寸，先按原尺寸请求，报尺寸错误再退到最接近的标准尺寸
function standardSize(w, h) {
  if (!w || !h) return '1024x1024';
  const r = w / h;
  if (r > 1.2) return '1536x1024';
  if (r < 0.83) return '1024x1536';
  return '1024x1024';
}

async function readImages(res) {
  const text = await res.text();
  let j;
  try { j = JSON.parse(text); } catch { throw new Error('图片接口返回的不是 JSON：' + text.slice(0, 200)); }
  if (!res.ok) {
    const msg = j?.error?.message || j?.message || text.slice(0, 300);
    const e = new Error('图片接口报错 ' + res.status + '：' + msg);
    e.status = res.status;
    throw e;
  }
  return readItems(Array.isArray(j?.data) ? j.data : []);
}

// 宽高 → 最接近的比例枚举（异步任务接口用 size=16:9 这类比例 + resolution=1k/2k/4k）
const RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9', '9:21', '2:1', '1:2'];
export function nearestRatio(w, h) {
  if (!w || !h) return '';
  const r = w / h;
  let best = '1:1';
  let d = Infinity;
  for (const x of RATIOS) {
    const [a, b] = x.split(':').map(Number);
    const dd = Math.abs(Math.log(r / (a / b)));
    if (dd < d) { d = dd; best = x; }
  }
  return best;
}
export function resolutionTier(w, h) {
  const m = Math.max(Number(w) || 0, Number(h) || 0);
  return m > 2600 ? '4k' : m > 1400 ? '2k' : '1k';
}

function refPath(params) {
  const lazy = parseLazy(params.image);
  const abs = lazy?.abs || params.image;
  return abs && fs.existsSync(abs) ? abs : '';
}

// 参考图换成公网直链：先用站点的 /v1/files/upload（new-api 系中转站常见，24 小时有效），没有就用 data URL
async function uploadRef(cfg, abs, signal) {
  const fd = new FormData();
  fd.append('file', new Blob([fs.readFileSync(abs)]), path.basename(abs));
  try {
    const res = await fetch(apiBase(cfg) + '/files/upload', { method: 'POST', headers: authHeaders(cfg), body: fd, signal });
    if (res.ok) {
      const j = await res.json().catch(() => null);
      if (j?.url) return j.url;
    }
  } catch { /* 走 data URL */ }
  const ext = path.extname(abs).slice(1).toLowerCase().replace('jpg', 'jpeg') || 'png';
  return 'data:image/' + ext + ';base64,' + fs.readFileSync(abs).toString('base64');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const notThisProtocol = (status, text) => status === 404 || status === 405 || /Invalid URL|not found|no route/i.test(text || '');

// 异步任务协议：POST {base}/image/generations → task_id；GET {base}/image/generations/{id} 轮询到 SUCCESS
// 返回 null 表示站点不支持这个协议（交给 OpenAI 协议）
async function runTaskImage(cfg, spec, prompt, params, signal) {
  const w = Number(params.width) || 0;
  const h = Number(params.height) || 0;
  const body = { model: spec.model, prompt, n: 1, resolution: resolutionTier(w, h) };
  const ratio = nearestRatio(w, h);
  if (ratio) body.size = ratio;
  if (spec.category === 'i2i') {
    const abs = refPath(params);
    if (!abs) throw new Error('图生图缺少参考图');
    body.images = [await uploadRef(cfg, abs, signal)];
    if (!ratio) body.size = 'auto';
  }
  const res = await fetch(apiBase(cfg) + '/image/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(cfg) },
    body: JSON.stringify(body),
    signal,
  });
  const text = await res.text();
  if (!res.ok && notThisProtocol(res.status, text)) return null;
  let j;
  try { j = JSON.parse(text); } catch { if (res.status === 404) return null; throw new Error('图片接口返回的不是 JSON：' + text.slice(0, 200)); }
  if (!res.ok) throw new Error('图片接口报错 ' + res.status + '：' + (j?.error?.message || j?.message || text.slice(0, 300)));
  // 有的站点这个路径直接同步返回图片
  if (Array.isArray(j?.data)) return readItems(j.data);
  const id = j?.task_id || j?.id || j?.data?.task_id;
  if (!id) throw new Error('图片接口没有返回任务号：' + text.slice(0, 200));
  for (;;) {
    await sleep(4000);
    const r = await fetch(apiBase(cfg) + '/image/generations/' + encodeURIComponent(id), { headers: authHeaders(cfg), signal });
    const t = await r.text();
    let q;
    try { q = JSON.parse(t); } catch { continue; }
    const d = q?.data && !Array.isArray(q.data) ? q.data : q;
    const st = String(d?.status || '').toUpperCase();
    if (st === 'SUCCESS' || st === 'SUCCEEDED' || st === 'COMPLETED') {
      const urls = [d.result_url, ...(d?.data?.content?.image_urls || []), d?.data?.content?.image_url].filter(Boolean);
      if (!urls.length) throw new Error('图片任务成功但没有返回图片地址');
      return [{ kind: 'images', filename: 'api_' + Date.now() + '_0' + urlExt(urls[0]), apiData: null, apiUrl: urls[0] }];
    }
    if (st === 'FAILURE' || st === 'FAILED' || st === 'ERROR') throw new Error('图片任务失败：' + (d?.fail_reason || d?.error || t.slice(0, 200)));
  }
}

// 结果多为 webp / jpeg，文件名后缀要跟实际格式一致（素材库、后续上传都按后缀认类型）
export function urlExt(url) {
  const m = /\.(png|jpe?g|webp|gif)(?:[?#]|$)/i.exec(String(url || ''));
  return m ? '.' + m[1].toLowerCase().replace('jpeg', 'jpg') : '.png';
}

function readItems(items) {
  if (!items.length) throw new Error('图片接口没有返回图片');
  return items.map((it, i) => ({
    kind: 'images',
    filename: 'api_' + Date.now() + '_' + i + (it.b64_json ? '.png' : urlExt(it.url)),
    apiData: it.b64_json ? Buffer.from(it.b64_json, 'base64') : null,
    apiUrl: it.url || '',
  }));
}

// OpenAI 协议：/images/generations（JSON）与 /images/edits（multipart）
async function runOpenAiImage(cfg, spec, prompt, params, signal) {
  const w = Number(params.width) || 0;
  const h = Number(params.height) || 0;
  if (spec.category === 'i2i') {
    const abs = refPath(params);
    if (!abs) throw new Error('图生图缺少参考图');
    const send = async (size) => {
      const fd = new FormData();
      fd.append('model', spec.model);
      fd.append('prompt', prompt);
      if (size) fd.append('size', size);
      fd.append('image', new Blob([fs.readFileSync(abs)]), path.basename(abs));
      return fetch(apiBase(cfg) + '/images/edits', { method: 'POST', headers: authHeaders(cfg), body: fd, signal });
    };
    try {
      return await readImages(await send(w && h ? w + 'x' + h : ''));
    } catch (e) {
      if (e.status === 400 && w && h) return readImages(await send(standardSize(w, h)));
      throw e;
    }
  }
  const send = async (size) => fetch(apiBase(cfg) + '/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(cfg) },
    body: JSON.stringify({ model: spec.model, prompt, n: 1, ...(size ? { size } : {}) }),
    signal,
  });
  try {
    return await readImages(await send(w && h ? w + 'x' + h : ''));
  } catch (e) {
    if (e.status === 400 && w && h) return readImages(await send(standardSize(w, h)));
    throw e;
  }
}

export async function runApiImage(cfg, spec, params, { timeoutMs = 15 * 60_000 } = {}) {
  if (!cfg.llm?.baseUrl) throw new Error('选了 LLM 接口的图片模型，但没有配置 LLM Base URL');
  const prompt = String(params.positive_prompt || params.prompt || '').trim();
  if (!prompt) throw new Error('缺少提示词');
  const signal = AbortSignal.timeout(timeoutMs);
  const viaTask = await runTaskImage(cfg, spec, prompt, params, signal);
  const outputs = viaTask || (await runOpenAiImage(cfg, spec, prompt, params, signal));
  return { prompt_id: 'api', outputs };
}

export async function downloadApiImage(out) {
  if (out.apiData) return out.apiData;
  const res = await fetch(out.apiUrl, { signal: AbortSignal.timeout(5 * 60_000) });
  if (!res.ok) throw new Error('下载生成的图片失败 ' + res.status);
  return Buffer.from(await res.arrayBuffer());
}
