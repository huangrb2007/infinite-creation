// LLM 接口自带的图片生成模型（OpenAI 兼容 /images/generations、/images/edits）作为文生图 / 图生图来源。
// 设置 → LLM 里「获取模型列表」后，图片类模型会出现在「工作流」页的文生图 / 图生图下拉里（key = api:<模型名>）。
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
  const items = Array.isArray(j?.data) ? j.data : [];
  if (!items.length) throw new Error('图片接口没有返回图片');
  return items.map((it, i) => ({
    kind: 'images',
    filename: 'api_' + Date.now() + '_' + i + '.png',
    apiData: it.b64_json ? Buffer.from(it.b64_json, 'base64') : null,
    apiUrl: it.url || '',
  }));
}

export async function runApiImage(cfg, spec, params, { timeoutMs = 10 * 60_000 } = {}) {
  if (!cfg.llm?.baseUrl) throw new Error('选了 LLM 接口的图片模型，但没有配置 LLM Base URL');
  const prompt = String(params.positive_prompt || params.prompt || '').trim();
  if (!prompt) throw new Error('缺少提示词');
  const w = Number(params.width) || 0;
  const h = Number(params.height) || 0;
  const signal = AbortSignal.timeout(timeoutMs);

  if (spec.category === 'i2i') {
    const lazy = parseLazy(params.image);
    const abs = lazy?.abs || params.image;
    if (!abs || !fs.existsSync(abs)) throw new Error('图生图缺少参考图');
    const send = async (size) => {
      const fd = new FormData();
      fd.append('model', spec.model);
      fd.append('prompt', prompt);
      if (size) fd.append('size', size);
      fd.append('image', new Blob([fs.readFileSync(abs)]), path.basename(abs));
      return fetch(apiBase(cfg) + '/images/edits', { method: 'POST', headers: authHeaders(cfg), body: fd, signal });
    };
    try {
      return { prompt_id: 'api', outputs: await readImages(await send(w && h ? w + 'x' + h : '')) };
    } catch (e) {
      if (e.status === 400 && w && h) return { prompt_id: 'api', outputs: await readImages(await send(standardSize(w, h))) };
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
    return { prompt_id: 'api', outputs: await readImages(await send(w && h ? w + 'x' + h : '')) };
  } catch (e) {
    if (e.status === 400 && w && h) return { prompt_id: 'api', outputs: await readImages(await send(standardSize(w, h))) };
    throw e;
  }
}

export async function downloadApiImage(out) {
  if (out.apiData) return out.apiData;
  const res = await fetch(out.apiUrl, { signal: AbortSignal.timeout(5 * 60_000) });
  if (!res.ok) throw new Error('下载生成的图片失败 ' + res.status);
  return Buffer.from(await res.arrayBuffer());
}
