// LLM 接口（new-api 系中转站，如 work-fisher）自带的视频 / 音乐模型，按类别接进「工作流」页：
//   视频（r2v）   参考生视频：MiniMax-H3、*-multi、*-r2v、omni 等；只能文生 / 首帧图生的也列出但标「需确认」
//   动作迁移      *-motion、animate-motion-transfer、workfisher/motion-video（主体图 + 动作视频）
//   数字人        MiniMax-H3 驱动音频模式（头像 + 语音 → 对口型）
//   背景音乐      mureka-*-bgm（/audio/generations）、Suno（/music/generations）
// 请求格式按站点文档 + 免费预估接口（/video/generations/estimate）逐类核对过。
import { parseLazy } from '../backend.js';
import { apiBase, authHeaders, sleep, uploadRef } from './api-image.js';

// ---------- 分类 ----------
const SKIP_VIDEO = /upscal|vsr|context-ir|lip-sync|-edit$|draft|v2v|elements|identify-face|tts$|midjourney/i;

export function videoFamily(id) {
  const s = String(id);
  if (s === 'MiniMax-H3') return 'h3';
  if (/minimax-h3-comfyui-max/i.test(s)) return 'h3comfy';
  if (/motion/i.test(s)) return 'motion';
  if (/-multi$/i.test(s)) return 'multi';
  if (/-t2v(-|$)|-lite$/i.test(s)) return 't2v';
  if (/-i2v(-|$)|start-end/i.test(s)) return 'i2v';
  return 'refs'; // *-r2v、omni、kling-v4-flash、gk-v15、muse、minimax-h3-comfyui-max …：顶层 images 传参考图
}

function spec(m, category, extra = {}) {
  return {
    key: 'api:' + category + ':' + m.id,
    id: 'api:' + m.id,
    source: 'api',
    name: m.id,
    model: m.id,
    category,
    kind: category,
    roles: {},
    issues: [],
    ready: true,
    ...extra,
  };
}

export function apiMediaSpecs(cfg) {
  const out = [];
  for (const m of cfg?.llm?.models || []) {
    if (m.kind === 'video' && !SKIP_VIDEO.test(m.id)) {
      const fam = videoFamily(m.id);
      if (fam === 'motion') {
        out.push(spec(m, 'motion', { backend: 'api-video', family: 'LLM 接口 · 动作迁移（主体图 + 动作视频）' }));
        continue;
      }
      const issues = fam === 't2v' ? ['只能文生视频，不用参考图，人物和场景不会和资产图一致']
        : fam === 'i2v' ? ['只用第一张参考图当首帧，其它参考图和角色音色用不上'] : [];
      out.push(spec(m, 'r2v', {
        backend: 'api-video',
        family: { h3: 'LLM 接口 · MiniMax-H3 参考生视频（图 + 音色）', h3comfy: 'LLM 接口 · H3 ComfyUI 工作流（图 + 音色）', multi: 'LLM 接口 · 多模态参考生视频（图 + 音色）', refs: 'LLM 接口 · 参考图生视频', t2v: 'LLM 接口 · 文生视频', i2v: 'LLM 接口 · 首帧图生视频' }[fam],
        issues,
        ready: !issues.length,
      }));
      if (fam === 'h3') out.push(spec(m, 'digital_human', { backend: 'api-video', family: 'LLM 接口 · MiniMax-H3 驱动音频对口型' }));
    }
    if (m.kind === 'audio' && /^mureka-.*bgm$|^suno-generation$/i.test(m.id)) {
      out.push(spec(m, 'music', { backend: 'api-music', family: /suno/i.test(m.id) ? 'LLM 接口 · Suno（纯音乐或按歌词作曲）' : 'LLM 接口 · Mureka 伴奏' }));
    }
  }
  return out;
}

// ---------- 参数换算 ----------
function absOf(filename) {
  const lazy = parseLazy(filename);
  return lazy?.abs || filename;
}

async function urlsOf(cfg, refs, signal) {
  const out = [];
  for (const r of refs) out.push({ ...r, url: await uploadRef(cfg, absOf(r.filename), signal) });
  return out;
}

const RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', '3:2', '2:3'];
function ratioOf(v) {
  const s = String(v || '').match(/\d+:\d+/)?.[0];
  return RATIOS.includes(s) ? s : '16:9';
}
function resoGeneric(v) {
  const s = String(v || '').toLowerCase();
  if (/1080|2k|4k/.test(s)) return /2k/.test(s) ? '2k' : /4k/.test(s) ? '4k' : '1080p';
  if (/480|540/.test(s)) return '480p';
  return '720p';
}
function resoH3(v) {
  const s = String(v || '').toLowerCase();
  if (/1080|2k|4k/.test(s)) return '1080P';
  if (/480|540/.test(s)) return '480P';
  return '768P';
}
// 从候选里取最接近的：分辨率按数字（480p/1080p/2k），比例按宽高比，时长按秒
function numOfReso(v) {
  const s = String(v).toLowerCase();
  if (/4k/.test(s)) return 2160;
  if (/2k/.test(s)) return 1440;
  return Number(s.match(/\d+/)?.[0]) || 720;
}
export function nearestOf(v, options, kind = 'reso') {
  if (!options?.length) return v;
  const key = (x) => (kind === 'ratio' ? Math.log(x.split(':').map(Number).reduce((a, b) => a / b)) : kind === 'num' ? Number(x) : numOfReso(x));
  const target = key(String(v));
  let best = options[0];
  for (const o of options) if (Math.abs(key(o) - target) < Math.abs(key(best) - target)) best = o;
  return best;
}

// 站点报参数不合法时，消息里一般写了允许的值（如「Aspect ratio must be 16:9 or 9:16 and resolution one of 480p, 608p, 768p」）。
// 读出来，把请求体里对应字段换成最接近的允许值。返回是否改动过。
export function fixBodyFromError(body, message) {
  const msg = String(message || '');
  let changed = false;
  const resoPart = /resolution[^.;]*/i.exec(msg)?.[0] || '';
  const resos = [...new Set((resoPart.match(/\b(\d{3,4}[pP]|[248][kK])\b/g) || []))];
  const ratioPart = /(aspect[ _]?ratio|ratio)[^.;]*/i.exec(msg)?.[0] || '';
  const ratios = [...new Set(ratioPart.match(/\b\d{1,2}:\d{1,2}\b/g) || [])];
  const durPart = /(seconds|duration)[^.;]*/i.exec(msg)?.[0] || '';
  const range = /(\d+)\s*(?:-|–|~|to|and)\s*(\d+)/.exec(durPart);
  const durs = range ? null : (durPart.match(/\b\d{1,2}\b/g) || []);
  const md = body.metadata || (body.metadata = {});
  const h3 = md.h3_request;
  if (resos.length) {
    const cur = md.resolution || body.resolution || h3?.resolution || '720p';
    const n = nearestOf(cur, resos);
    if (n !== cur) {
      if (h3) { h3.resolution = n; body.resolution = n; } else md.resolution = n;
      changed = true;
    }
  }
  if (ratios.length) {
    const cur = md.ratio || h3?.ratio || '16:9';
    const n = nearestOf(cur, ratios, 'ratio');
    if (n !== cur) { if (h3) h3.ratio = n; else md.ratio = n; changed = true; }
  }
  if (durPart) {
    const cur = Number(body.seconds ?? body.duration ?? h3?.duration ?? 5);
    let n = cur;
    if (range) n = Math.max(Number(range[1]), Math.min(Number(range[2]), cur));
    else if (durs.length) n = Number(nearestOf(String(cur), durs, 'num'));
    if (n !== cur) {
      if (body.seconds !== undefined) body.seconds = String(n);
      if (body.duration !== undefined) body.duration = n;
      if (h3) h3.duration = n;
      changed = true;
    }
  }
  return changed;
}

const clampInt = (n, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(n) || 5)));

// __MINIMAX_H3_REF_N__（ComfyUI H3 节点才认）→ 各家接口自己的写法：
//   默认（seedance 等多模态）@Image k / @Audio k / @Video k
//   h3comfy：<Picture k> / <Audio k>；不认音频标签的（noAudioTag）写成「参考音频 k」
export function apiRefPrompt(prompt, refs, style = 'at') {
  const counter = { image: 0, audio: 0, video: 0 };
  const names = refs.map((r) => {
    const t = r.type === 'audio' ? 'audio' : r.type === 'video' ? 'video' : 'image';
    counter[t] += 1;
    const k = counter[t];
    if (style === 'angle' || style === 'angle-noaudio') {
      if (t === 'image') return '<Picture ' + k + '>';
      if (t === 'audio') return style === 'angle' ? '<Audio ' + k + '>' : '参考音频 ' + k;
      return '参考视频 ' + k;
    }
    return '@' + t[0].toUpperCase() + t.slice(1) + ' ' + k;
  });
  return String(prompt || '').replace(/__MINIMAX_H3_REF_(\d+)__/g, (m, n) => names[Number(n) - 1] || '');
}

const contentItem = (r, role) => {
  const t = r.type === 'audio' ? 'audio_url' : r.type === 'video' ? 'video_url' : 'image_url';
  return { type: t, [t]: { url: r.url }, ...(role ? { role } : {}) };
};

export async function buildVideoBody(cfg, spec, params, signal) {
  const fam = videoFamily(spec.model);
  const refs = params.references || [];
  const prompt = apiRefPrompt(params.positive_prompt || params.prompt, refs);
  const ratio = ratioOf(params.aspect_ratio);
  if (fam === 'h3') {
    const dh = spec.category === 'digital_human' || params.mode === 'digital_human';
    const withUrls = await urlsOf(cfg, refs.slice(0, 16), signal);
    const imgs = withUrls.filter((r) => r.type === 'image').slice(0, 9);
    const auds = withUrls.filter((r) => r.type === 'audio');
    const vids = withUrls.filter((r) => r.type === 'video').slice(0, 3);
    const content = [{ type: 'text', text: prompt }];
    imgs.forEach((r) => content.push(contentItem(r, 'reference_image')));
    if (dh && auds[0]) content.push(contentItem(auds[0], 'drive_audio'));
    else auds.slice(0, 3).forEach((r) => content.push(contentItem(r, 'reference_audio')));
    vids.forEach((r) => content.push(contentItem(r, 'reference_video')));
    const duration = clampInt(params.seconds, 4, dh ? 60 : 15);
    const resolution = resoH3(params.resolution);
    const h3 = { model: 'MiniMax-H3', content, resolution, duration, ratio };
    if (dh && auds[0]) h3.audio_control = { mode: 'lock_source', denoise_strength: 0, add_drive_as_reference: true };
    return { model: 'MiniMax-H3', prompt, duration, resolution, metadata: { h3_request: h3 } };
  }
  if (fam === 'h3comfy') {
    // 站点文档：images ≤9（-10020 ≤6）、metadata.audio_urls ≤3；分辨率 480p/608p/768p（基础版另有更高档）；比例只有 16:9 / 9:16
    const base = /comfyui-max$/i.test(spec.model);
    const imgRefs = refs.filter((r) => r.type === 'image').slice(0, /10020/.test(spec.model) ? 6 : 9);
    const audRefs = refs.filter((r) => r.type === 'audio').slice(0, 3);
    const used = [...imgRefs, ...audRefs];
    const ordered = refs.filter((r) => used.includes(r));
    const body = {
      model: spec.model,
      prompt: apiRefPrompt(params.positive_prompt || params.prompt, ordered.length === refs.length ? refs : refs.map((r) => (used.includes(r) ? r : { type: 'video' })), base ? 'angle-noaudio' : 'angle'),
      seconds: String(clampInt(params.seconds, 3, 15)),
      metadata: { resolution: nearestOf(resoGeneric(params.resolution) === '720p' ? '768p' : resoGeneric(params.resolution), base ? ['480p', '608p', '768p', '896p', '1088p', '1280p', '1440p'] : ['480p', '608p', '768p']), ratio: ratio === '9:16' || ratio === '3:4' || ratio === '2:3' ? '9:16' : '16:9' },
    };
    const imgs = await urlsOf(cfg, imgRefs, signal);
    if (imgs.length) body.images = imgs.map((r) => r.url);
    if (audRefs.length && imgs.length) body.metadata.audio_urls = (await urlsOf(cfg, audRefs, signal)).map((r) => r.url);
    return body;
  }
  const body = { model: spec.model, prompt, seconds: String(clampInt(params.seconds, 3, 15)), metadata: { resolution: resoGeneric(params.resolution), ratio } };
  if (fam === 'multi') {
    const withUrls = await urlsOf(cfg, refs.slice(0, 15), signal);
    body.metadata.content = [
      ...withUrls.filter((r) => r.type === 'image').slice(0, 9),
      ...withUrls.filter((r) => r.type === 'video').slice(0, 3),
      ...withUrls.filter((r) => r.type === 'audio').slice(0, 3),
    ].map((r) => contentItem(r));
  } else if (fam === 'refs' || fam === 'i2v') {
    const imgs = await urlsOf(cfg, refs.filter((r) => r.type === 'image').slice(0, fam === 'i2v' ? 1 : 7), signal);
    if (imgs.length) body.images = imgs.map((r) => r.url);
  } else if (fam === 'motion') {
    const character = params.character || refs.find((r) => r.type === 'image')?.filename;
    const driving = params.driving_video || refs.find((r) => r.type === 'video')?.filename;
    if (!character || !driving) throw new Error('动作迁移需要一张主体图和一段动作视频');
    body.images = [await uploadRef(cfg, absOf(character), signal)];
    const v = await uploadRef(cfg, absOf(driving), signal);
    body.metadata = { video_url: /^kling/i.test(spec.model) ? [v] : v };
  }
  return body;
}

// ---------- 提交与轮询 ----------
async function postJson(cfg, p, body, signal) {
  const res = await fetch(apiBase(cfg) + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(cfg) },
    body: JSON.stringify(body),
    signal,
  });
  const text = await res.text();
  let j;
  try { j = JSON.parse(text); } catch { throw new Error('接口返回的不是 JSON：' + text.slice(0, 200)); }
  if (!res.ok || j?.error) {
    const msg = typeof j?.error === 'string' ? j.error : (j?.error?.message || j?.message || text.slice(0, 300));
    throw new Error('接口报错 ' + res.status + '：' + msg);
  }
  return j;
}

async function poll(cfg, p, pick, { signal, isAborted, limit, every = 5000 }) {
  const t0 = Date.now();
  for (;;) {
    await sleep(every);
    if (isAborted?.()) throw new Error('已停止');
    if (signal?.aborted) throw signal.reason || new Error('已停止');
    if (limit > 0 && Date.now() - t0 > limit) throw new Error('生成超时');
    let j;
    try {
      const r = await fetch(apiBase(cfg) + p, { headers: authHeaders(cfg), signal: AbortSignal.timeout(30_000) });
      j = await r.json();
    } catch { continue; }
    const r = pick(j);
    if (r) return r;
  }
}

function videoResult(j) {
  const d = j?.data && !Array.isArray(j.data) ? j.data : j;
  const st = String(d?.status || '').toLowerCase();
  if (['completed', 'succeeded', 'success'].includes(st)) {
    const url = d?.metadata?.url || d?.result_url || d?.url || d?.data?.content?.video_url || d?.task?.content?.url;
    if (!url) throw new Error('视频任务成功但没有返回视频地址');
    return { url };
  }
  if (['failed', 'failure', 'cancelled', 'canceled'].includes(st)) {
    throw new Error('视频生成失败：' + (d?.error?.message || d?.fail_reason || d?.error || st));
  }
  return null;
}

// 提交前用站点的免费预估接口校验（同一套参数校验，不建任务、不扣费）：
// 报了不允许的分辨率 / 比例 / 时长就按消息里的允许值换成最接近的，最多改 3 轮。站点没有这个接口就跳过。
export async function preflightVideoBody(cfg, body, signal) {
  for (let i = 0; i < 3; i++) {
    let res;
    try {
      res = await fetch(apiBase(cfg) + '/video/generations/estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(cfg) },
        body: JSON.stringify(body),
        signal,
      });
    } catch { return; }
    if (res.status === 404 || res.status === 405) return;
    const text = await res.text();
    if (res.ok && !/"error"/.test(text)) return;
    let msg = text;
    try { const j = JSON.parse(text); msg = j?.error?.message || j?.message || text; } catch {}
    if (!fixBodyFromError(body, msg)) return; // 改不了就照原样提交，让真正的报错显示出来
  }
}

export async function runApiVideo(cfg, spec, params, { timeoutMs, isAborted, onSubmitted } = {}) {
  if (!cfg.llm?.baseUrl) throw new Error('选了 LLM 接口的视频模型，但没有配置 LLM Base URL');
  const signal = AbortSignal.timeout(10 * 60_000); // 只管上传与提交；轮询另有上限
  const body = await buildVideoBody(cfg, spec, params, signal);
  await preflightVideoBody(cfg, body, signal);
  const j = await postJson(cfg, '/videos', body, signal);
  const id = j?.id || j?.task_id || j?.data?.task_id;
  if (!id) throw new Error('视频接口没有返回任务号');
  onSubmitted?.(id);
  const limit = Number(timeoutMs) > 0 ? Number(timeoutMs) : 3 * 60 * 60_000;
  const { url } = await poll(cfg, '/videos/' + encodeURIComponent(id), videoResult, { isAborted, limit, every: 6000 });
  return { prompt_id: id, outputs: [{ kind: 'videos', filename: 'api_' + Date.now() + '.mp4', apiData: null, apiUrl: url }] };
}

// 背景音乐。caption 是风格描述，lyrics 为空或 [Instrumental] 时出纯音乐
export async function runApiMusic(cfg, spec, params, { timeoutMs, isAborted } = {}) {
  if (!cfg.llm?.baseUrl) throw new Error('选了 LLM 接口的音乐模型，但没有配置 LLM Base URL');
  const caption = String(params.caption || params.prompt || '').trim().slice(0, 1000);
  const lyrics = String(params.lyrics || '').trim();
  const vocal = lyrics && !/^\[?instrumental\]?$/i.test(lyrics);
  if (!caption && !vocal) throw new Error('缺少音乐描述');
  const signal = AbortSignal.timeout(60_000);
  const limit = Number(timeoutMs) > 0 ? Number(timeoutMs) : 60 * 60_000;
  if (/suno/i.test(spec.model)) {
    const body = vocal
      ? { model: 'suno', version: 'v5', custom: true, instrumental: false, prompt: lyrics.slice(0, 3000), style: caption.slice(0, 200) }
      : { model: 'suno', version: 'v5', custom: false, instrumental: true, prompt: caption.slice(0, 400) };
    const j = await postJson(cfg, '/music/generations', body, signal);
    const id = (Array.isArray(j?.data) ? j.data[0]?.task_id : j?.data?.task_id) || j?.task_id;
    if (!id) throw new Error('音乐接口没有返回任务号');
    const { url } = await poll(cfg, '/music/tasks/' + encodeURIComponent(id), (q) => {
      const d = q?.data || q;
      const st = String(d?.status || '').toLowerCase();
      if (st === 'completed' || st === 'success' || st === 'succeeded') {
        const u = d?.result?.music?.[0]?.audio_url || d?.result_url;
        if (!u) throw new Error('音乐任务成功但没有返回音频地址');
        return { url: u };
      }
      if (st === 'failed' || st === 'failure') throw new Error('音乐生成失败：' + (d?.error || d?.fail_reason || st));
      return null;
    }, { isAborted, limit });
    return { prompt_id: id, outputs: [{ kind: 'audio', filename: 'api_' + Date.now() + '.mp3', apiData: null, apiUrl: url }] };
  }
  // Mureka 伴奏：/audio/generations，与语音同一套异步任务
  const j = await postJson(cfg, '/audio/generations', { model: spec.model, prompt: caption || lyrics.slice(0, 1000), metadata: { n: 1 } }, signal);
  const id = j?.task_id || j?.id;
  if (!id) throw new Error('音乐接口没有返回任务号');
  const { url } = await poll(cfg, '/audio/generations/' + encodeURIComponent(id), (q) => {
    const d = q?.data && !Array.isArray(q.data) ? q.data : q;
    const st = String(d?.status || '').toUpperCase();
    if (st === 'SUCCESS' || st === 'SUCCEEDED') {
      const u = d.result_url || d?.data?.content?.audio_url || (d?.data?.content?.audio_urls || [])[0];
      if (!u || !/^https?:/.test(u)) throw new Error('音乐任务成功但没有返回音频地址');
      return { url: u };
    }
    if (st === 'FAILURE' || st === 'FAILED') throw new Error('音乐生成失败：' + (d?.fail_reason || '未知原因'));
    return null;
  }, { isAborted, limit, every: 4000 });
  const ext = /\.(mp3|wav|flac|m4a|ogg)(?:[?#]|$)/i.exec(url)?.[1] || 'mp3';
  return { prompt_id: id, outputs: [{ kind: 'audio', filename: 'api_' + Date.now() + '.' + ext.toLowerCase(), apiData: null, apiUrl: url }] };
}
