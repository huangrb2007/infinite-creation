import { normBaseUrl } from './utils.js';
import { logger } from './logger.js';

export function llmEndpoint(baseUrl) {
  let base = normBaseUrl(baseUrl || '');
  if (/\/chat\/completions$/.test(base)) return base;
  if (!/\/v\d+$/.test(base)) base += '/v1';
  return base + '/chat/completions';
}

// openclaude（Agent 运行时）走 OpenAI SDK，SDK 自己拼 '/chat/completions'，所以只能给它 base。
// 归一化必须与 llmEndpoint 完全一致（补 /v1）：baseUrl 形如 'http://127.0.0.1:11434'
//（Ollama/LM Studio 的常见写法，界面允许省略 /v1）时，预检（/v1/models）与直连 llmChat
//（/v1/chat/completions）都能通过，唯独整条 Agent 流水线去请求 '/chat/completions' → 404，
// 即「预检通过、一跑就全失败」。统一从这里取 base，两条链路才不会再漂移。
export function openaiCompatBaseUrl(baseUrl) {
  return llmEndpoint(baseUrl).replace(/\/chat\/completions$/, '');
}

// 把 base64 dataURL 列表转成 OpenAI 多模态 image_url 内容块（视觉模型用）
export function imageUrlParts(dataUrls) {
  return (dataUrls || []).filter(Boolean).map((url) => ({ type: 'image_url', image_url: { url } }));
}

// 组装一条 user 消息：文本 + 可选图片；无图时保持纯字符串 content（兼容普通模型）
export function buildVisionUserMessage(text, dataUrls) {
  const parts = imageUrlParts(dataUrls);
  if (!parts.length) return { role: 'user', content: text };
  return { role: 'user', content: [{ type: 'text', text }, ...parts] };
}

// 把文本 + { data, mimeType } 图片列表转成 OpenClaude/Anthropic 内容块（供 openclaude SDK 初始消息投喂视觉模型）
export function buildVisionContentBlocks(text, images) {
  const blocks = [{ type: 'text', text }];
  for (const img of (images || [])) {
    if (img && img.data && img.mimeType) {
      blocks.push({ type: 'image', source: { type: 'base64', media_type: img.mimeType, data: img.data } });
    }
  }
  return blocks;
}

// 模型分工：同一个 API 下可以给不同用途指定不同模型（设置 → LLM → 模型分工）。
//   agent   主模型：Agent 写剧本、拆分镜、写视频提示词（默认就是 llm.model）
//   vision  视觉模型：需要看参考图的调用（图生图前的看图精修、导入素材自动命名、带图改写）
//   rewrite 改写模型：单镜提示词按反馈改写、音乐描述改写等短任务，可以用更快更便宜的模型
// 没单独指定的用途回落到主模型。
export const LLM_ROLES = ['agent', 'vision', 'rewrite'];
export function llmFor(llmCfg, purpose = 'agent') {
  const roles = llmCfg?.roles || {};
  const model = String(roles[purpose] || '').trim() || llmCfg?.model;
  const out = { ...(llmCfg || {}), model };
  if (purpose === 'vision' && String(roles.vision || '').trim()) out.vision = true;
  return out;
}
export function llmVisionAvailable(llmCfg) {
  return !!(llmCfg?.vision || String(llmCfg?.roles?.vision || '').trim());
}

// 按名字粗分用途的规则放在 lib/shared，设置页手动添加模型时也用同一套
import { classifyModel } from '../shared/index.js';
export { classifyModel };

// new-api / one-api 系站点公开的模型目录（/api/pricing）：带 tags（llm/image/video/audio）和说明，
// 比按名字猜准得多。拿不到就退回按名字分类。
function kindFromSite(m) {
  const tags = String(m?.tags || '').toLowerCase().split(/[,，\s]+/).filter(Boolean);
  const desc = String(m?.description || '');
  const first = tags[0] || '';
  if (first === 'image' || (tags.includes('image') && !tags.includes('llm'))) return 'image';
  if (first === 'video' || tags.includes('video')) return 'video';
  if (first === 'audio' || tags.includes('audio') || tags.includes('music') || tags.includes('tts')) return 'audio';
  if (tags.includes('llm') || tags.includes('text')) {
    return /图片输入|图像输入|图片与文本|文本与图片|文本和图片|多模态|image input|vision|multimodal|images? and text|text and images?/i.test(desc) ? 'vision' : 'text';
  }
  if (tags.length) return 'other';
  return '';
}

export async function fetchSiteModelCatalog(baseUrl) {
  try {
    const origin = new URL(openaiCompatBaseUrl(baseUrl)).origin;
    const res = await fetch(origin + '/api/pricing', { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return [];
    const j = await res.json();
    const arr = Array.isArray(j?.data) ? j.data : [];
    return arr.filter((m) => m?.model_name).map((m) => ({
      id: String(m.model_name),
      kind: kindFromSite(m) || classifyModel(m.model_name),
      label: m.display_name || '',
      desc: String(m.description || '').slice(0, 160),
    }));
  } catch {
    return [];
  }
}

/** 返回 { models: 这个 Key 能用的模型, site: 站点目录里的全部模型（可手动添加） } */
export async function listLlmModels(llmCfg) {
  if (!llmCfg?.baseUrl) throw new Error('未填写 API Base URL');
  const url = openaiCompatBaseUrl(llmCfg.baseUrl) + '/models';
  const sitePromise = fetchSiteModelCatalog(llmCfg.baseUrl);
  const res = await fetch(url, {
    headers: llmCfg.apiKey ? { Authorization: 'Bearer ' + llmCfg.apiKey } : {},
    signal: AbortSignal.timeout(20_000),
  }).catch((e) => { throw new Error('无法连接 ' + url + '：' + (e?.message || e)); });
  if (!res.ok) throw new Error('获取模型列表失败 ' + res.status + '：' + (await res.text().catch(() => '')).slice(0, 300));
  const j = await res.json();
  const arr = Array.isArray(j?.data) ? j.data : Array.isArray(j) ? j : [];
  const site = await sitePromise;
  const byId = new Map(site.map((m) => [m.id, m]));
  const models = [...new Set(arr.map((m) => String(m?.id || m)).filter(Boolean))].sort().map((id) => {
    const sm = byId.get(id);
    return { id, kind: sm?.kind || classifyModel(id), ...(sm?.label ? { label: sm.label } : {}) };
  });
  return { models, site };
}

export async function llmChat(llmCfg, messages, { json = false, tools = null, temperature = 0.8, maxTokens = 4000, timeoutMs = 180_000 } = {}) {
  // 与 preflight 的口径一致：本地 llama.cpp 这类无鉴权端点本来就不发 Authorization，
  // 这里也只在配了 key 时才带。此前无条件要求 apiKey，于是「预检通过、真正调用全失败」：
  // 用无鉴权本地 LLM 的用户每一个 LLM 阶段都报「未配置 api_key」。
  // 需要鉴权的云端端点会回 401，错误体里能看到原因（基址没配才是这里要拦的）。
  if (!llmCfg?.baseUrl) throw new Error('未配置 LLM Base URL，请先到「设置」里配置。');
  const url = llmEndpoint(llmCfg.baseUrl);
  const body = { model: llmCfg.model, messages, temperature, max_tokens: maxTokens, stream: false };
  if (json) body.response_format = { type: 'json_object' };
  if (tools && tools.length) body.tools = tools;
  logger.debug('LLM 请求', { url, model: llmCfg.model, json, hasTools: !!(tools && tools.length) });
  // LLM 服务假死（TCP 挂着不响应）时无超时的 fetch 会永久 pending，JOB 永不结束。
  // 挂 AbortSignal.timeout：超时抛错给上层 catch，任务以 failed 收尾而非卡在 running。
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(llmCfg.apiKey ? { Authorization: 'Bearer ' + llmCfg.apiKey } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  }).catch((e) => {
    // 超时和「连不上」是两回事：服务在跑但卡住（模型加载/排队）时，把用户引向「请确认服务已启动」
    // 只会让他去重启一个本来就活着的服务。
    if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
      throw new Error('LLM 响应超时（' + Math.round(timeoutMs / 1000) + ' 秒无响应）：' + url + '。服务可能在跑但卡住了，或模型加载过慢。');
    }
    // undici 连接失败只给 "fetch failed"，对用户毫无信息量 → 补上目标地址与排查提示
    throw new Error('无法连接 LLM（' + url + '），请确认 LLM 服务已启动、Base URL 正确。原始错误：' + (e?.message || e));
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error('LLM 请求失败 ' + res.status + ': ' + text.slice(0, 500));
  }
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) {
    const text = await res.text().catch(() => '');
    throw new Error('LLM 接口返回了非 JSON 内容（可能返回网页 HTML）。请检查 API Base URL 是否需以 /v1 结尾。返回开头：' + text.slice(0, 200));
  }
  const data = await res.json();
  const choice = data?.choices?.[0] ?? {};
  const message = choice.message ?? {};
  logger.debug('LLM 响应', { content: String(message.content || '').slice(0, 2000), toolCalls: (message.tool_calls || []).length, finishReason: choice.finish_reason });
  return { content: message.content ?? '', toolCalls: message.tool_calls || [], finishReason: choice.finish_reason || '', message };
}

export function extractJson(text) {
  const cleaned = String(text || '').replace(/\u0060\u0060\u0060(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('LLM 返回内容不是合法 JSON：' + String(text || '').slice(0, 300));
  }
  return JSON.parse(cleaned.slice(start, end + 1));
}
