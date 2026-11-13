// 工作流自动识别：从 ComfyUI API 格式工作流推导「工作流规格」（spec）。
//
// 识别优先级（从可靠到猜测）：
//   1) 节点标题标签：在 ComfyUI 里把节点标题写成「正向提示词 #prompt」这样，标签精确指定语义角色；
//   2) 已知节点家族：MiniMax H3 Easy / H3 Ref2V、Qwen-Image 2.1、Qwen3-TTS、MiniMax Music3 等，
//      按节点类型直接给出完整角色映射（与仓库手写规格同一套字段）；
//   3) 通用启发式：字段名 + 节点类型猜提示词、种子、尺寸、加载器。
// 识别不了的角色记进 issues，交给设置页让用户点选确认（结果存为覆盖项）。
import { CATEGORY_MAP, categoryOfName } from './categories.js';
import { VIDEO_RESOLUTION_MP } from '../../shared/index.js';

// 标签 → 角色名。#image / #image2 … 是有序的参考图槽。
const TAG_ROLES = {
  prompt: 'positive_prompt', positive: 'positive_prompt', neg: 'negative_prompt', negative: 'negative_prompt',
  seed: 'seed', width: 'width', height: 'height', seconds: 'seconds', duration: 'seconds', frames: 'frames',
  ratio: 'aspect_ratio', aspect: 'aspect_ratio', resolution: 'resolution', mode: 'mode',
  text: 'text', voice_desc: 'voice_description', voice: 'voice_description',
  caption: 'caption', lyrics: 'lyrics', music_duration: 'max_duration', output: 'filename_prefix',
};
// 每个角色默认写哪个字段（标签只标节点，字段按节点实际输入匹配）
const ROLE_FIELDS = {
  positive_prompt: ['prompt', 'text', 'positive', 'value', 'string'],
  negative_prompt: ['negative_prompt', 'text', 'negative', 'value', 'string'],
  seed: ['seed', 'noise_seed'],
  width: ['width'], height: ['height'],
  seconds: ['seconds', 'duration', 'length'], frames: ['length', 'frames', 'num_frames'],
  aspect_ratio: ['aspect_ratio'], resolution: ['resolution', 'megapixels'], mode: ['mode'],
  text: ['text', 'value', 'string'], voice_description: ['voice_description', 'instruct', 'value', 'text'],
  caption: ['caption', 'tags', 'value'], lyrics: ['lyrics', 'value'], max_duration: ['max_duration', 'seconds', 'duration'],
  filename_prefix: ['filename_prefix'],
};

const LOADERS = {
  LoadImage: { type: 'image', field: 'image' },
  LoadImageOutput: { type: 'image', field: 'image' },
  LoadAudio: { type: 'audio', field: 'audio' },
  LoadVideo: { type: 'video', field: 'file' },
  VHS_LoadVideo: { type: 'video', field: 'video' },
  VHS_LoadAudioUpload: { type: 'audio', field: 'audio' },
};
const SAVE_RE = /^(Save(Image|Video|Audio|AnimatedWEBP|WEBM)\w*|VHS_VideoCombine|PreviewAudio)$/;

const isLink = (v) => Array.isArray(v) && v.length === 2 && typeof v[0] === 'string';
const titleOf = (n) => String(n?._meta?.title || n?.class_type || '');

function tagsOf(n) {
  const out = [];
  for (const m of titleOf(n).matchAll(/#([a-z_]+)(\d*)/gi)) out.push({ tag: m[1].toLowerCase(), n: m[2] ? Number(m[2]) : 1 });
  return out;
}

function pickField(node, candidates) {
  const inputs = node?.inputs || {};
  for (const f of candidates) if (f in inputs) return f;
  return null;
}

// 从 nodeId 沿连线向上找第一个满足 pred 的节点（广度优先）
function upstream(wf, nodeId, pred, maxDepth = 6) {
  const seen = new Set();
  let layer = [nodeId];
  for (let d = 0; d < maxDepth && layer.length; d++) {
    const next = [];
    for (const id of layer) {
      if (seen.has(id) || !wf[id]) continue;
      seen.add(id);
      if (d > 0 && pred(wf[id], id)) return id;
      for (const v of Object.values(wf[id].inputs || {})) if (isLink(v)) next.push(v[0]);
    }
    layer = next;
  }
  return null;
}

// 字段是连线时，顺着连线找到真正存值的原始节点（PrimitiveString / SeedNode 等），返回 { node, field }
function resolveValue(wf, nodeId, field) {
  const v = wf[nodeId]?.inputs?.[field];
  if (!isLink(v)) return { node: nodeId, field };
  const src = wf[v[0]];
  if (!src) return { node: nodeId, field };
  const f = pickField(src, ['value', 'string', 'text', 'seed', 'int', 'noise_seed']);
  // 来源节点自己也是连线（多级 primitive）时再追一层
  if (f && isLink(src.inputs[f])) return resolveValue(wf, v[0], f);
  // 来源是开关/扩写链这类计算节点时直接写目标字段（覆盖连线），运行前会剪掉孤立链
  return f ? { node: v[0], field: f } : { node: nodeId, field };
}

function findSeed(wf, near) {
  // 优先：与生成节点相连的采样器/噪声节点
  const ids = Object.keys(wf);
  const order = near ? [near, ...ids] : ids;
  for (const id of order) {
    const n = wf[id];
    const f = pickField(n, ['noise_seed', 'seed']);
    if (!f) continue;
    if (/Sampler|Noise|Seed|TTS|Music|Easy/i.test(n.class_type || '') || near === id) return resolveValue(wf, id, f);
  }
  return null;
}

function findSaves(wf) {
  return Object.entries(wf).filter(([, n]) => SAVE_RE.test(n.class_type || '')).map(([id, n]) => ({ id, class: n.class_type }));
}

function loaderNodes(wf) {
  const out = { image: [], audio: [], video: [] };
  for (const [id, n] of Object.entries(wf)) {
    const l = LOADERS[n.class_type];
    if (l) out[l.type].push({ node: id, field: l.field, class: n.class_type, title: titleOf(n) });
  }
  // 标签 #image2 这类序号优先，其次按节点号排序，保证「第 1/2/3 个槽」稳定
  for (const k of Object.keys(out)) {
    out[k].sort((a, b) => {
      const ta = tagsOf(wf[a.node]).find((t) => t.tag === k)?.n ?? 999;
      const tb = tagsOf(wf[b.node]).find((t) => t.tag === k)?.n ?? 999;
      return ta - tb || (parseFloat(a.node) || 0) - (parseFloat(b.node) || 0) || String(a.node).localeCompare(String(b.node));
    });
  }
  return out;
}

const ASPECT_MAP_H3 = {
  '1:1': '1:1 (Square)', '3:4': '3:4 (Portrait Standard)', '4:3': '4:3 (Standard)',
  '9:16': '9:16 (Portrait Widescreen)', '16:9': '16:9 (Widescreen)', '21:9': '21:9 (Ultrawide)',
};

// —— 已知节点家族 ——
function familyH3Easy(wf) {
  const id = Object.keys(wf).find((k) => wf[k].class_type === 'MiniMaxH3Easy');
  if (!id) return null;
  const n = wf[id];
  const roles = {};
  for (const f of ['prompt', 'seconds', 'resolution', 'aspect_ratio', 'width', 'height']) {
    if (f in n.inputs) roles[f === 'prompt' ? 'positive_prompt' : f] = { node: id, field: f };
  }
  if ('mode' in n.inputs) roles.mode = { node: id, field: 'mode', map: { text: 'image', first_last: 'image' } };
  // 宽高比：节点枚举若是带说明的「16:9 (Widescreen)」形式，加映射
  if (roles.aspect_ratio && /\(/.test(String(n.inputs.aspect_ratio))) roles.aspect_ratio.map = ASPECT_MAP_H3;
  const seed = findSeed(wf);
  if (seed) roles.seed = seed;
  const up = Object.keys(wf).find((k) => wf[k].class_type === 'MiniMaxH3EasyLatentUpscaler3D');
  if (up && 'mode.scale' in wf[up].inputs) roles.scale = { node: up, field: 'mode.scale' };
  // 现有 media_N 连到的加载器作为复用池
  const reusePool = { image: [], audio: [], video: [] };
  for (const [k, v] of Object.entries(n.inputs)) {
    if (!/^media_\d+$/.test(k) || !isLink(v)) continue;
    const l = LOADERS[wf[v[0]]?.class_type];
    if (l) reusePool[l.type].push(v[0]);
  }
  return {
    category: 'r2v',
    roles,
    media: { targetNode: id, mediaField: 'media_', typeField: 'media_type_', reusePool, maxImages: 9, maxAudioVideo: 3 },
    family: 'MiniMax H3 Easy',
  };
}

function familyH3Ref2V(wf) {
  const id = Object.keys(wf).find((k) => /^MiniMaxH3ReferenceToVideo/.test(wf[k].class_type));
  if (!id) return null;
  const n = wf[id];
  const roles = {};
  const pf = pickField(n, ['prompt', 'text']);
  if (pf) roles.positive_prompt = resolveValue(wf, id, pf);
  for (const f of ['seconds', 'width', 'height', 'aspect_ratio']) if (f in n.inputs) roles[f] = { node: id, field: f };
  const seed = findSeed(wf);
  if (seed) roles.seed = seed;
  const reusePool = { image: [], audio: [], video: [] };
  for (const [k, v] of Object.entries(n.inputs)) {
    if (!isLink(v)) continue;
    const l = LOADERS[wf[v[0]]?.class_type];
    if (l && /^ref_/.test(k)) reusePool[l.type].push(v[0]);
  }
  return {
    category: 'r2v',
    roles,
    media: {
      targetNode: id,
      fieldsByType: { image: 'ref_images.ref_image_', audio: 'ref_audios.ref_audio_', video: 'ref_videos.ref_video_' },
      reusePool, maxImages: 9, maxAudioVideo: 3,
    },
    family: 'MiniMax H3 Ref2V',
  };
}

function familyQwenImage21(wf) {
  const id = Object.keys(wf).find((k) => wf[k].class_type === 'TextEncodeQwenImage21');
  if (!id) return null;
  const roles = { positive_prompt: { node: id, field: 'prompt' } };
  if ('negative_prompt' in wf[id].inputs) roles.negative_prompt = { node: id, field: 'negative_prompt' };
  const latent = Object.keys(wf).find((k) => /^Empty.*Latent/.test(wf[k].class_type) && 'width' in wf[k].inputs);
  if (latent) { roles.width = { node: latent, field: 'width' }; roles.height = { node: latent, field: 'height' }; }
  const seed = findSeed(wf);
  if (seed) roles.seed = seed;
  const imgs = loaderNodes(wf).image;
  // 有参考图加载器且能连到编码节点 → 图生图
  const usedImgs = imgs.filter((l) => upstream(wf, id, (_, nid) => nid === l.node, 8));
  if (usedImgs.length) {
    roles.image = { node: usedImgs[0].node, field: usedImgs[0].field };
    return { category: 'i2i', roles, slots: { image: usedImgs.map((l) => ({ node: l.node, field: l.field })) }, family: 'Qwen-Image 2.1 编辑' };
  }
  return { category: 't2i', roles, family: 'Qwen-Image 2.1' };
}

function familyQwenTTS(wf) {
  const design = Object.keys(wf).find((k) => wf[k].class_type === 'Qwen3TTSVoiceDesign');
  if (design) {
    const roles = {};
    if ('text' in wf[design].inputs) roles.text = resolveValue(wf, design, 'text');
    const vf = pickField(wf[design], ['voice_description', 'instruct']);
    if (vf) roles.voice_description = resolveValue(wf, design, vf);
    const seed = findSeed(wf, design);
    if (seed) roles.seed = seed;
    return { category: 'tts', roles, family: 'Qwen3-TTS 音色设计' };
  }
  const clone = Object.keys(wf).find((k) => wf[k].class_type === 'Qwen3TTSVoiceClone');
  if (clone) {
    const roles = {};
    if ('text' in wf[clone].inputs) roles.text = resolveValue(wf, clone, 'text');
    const ra = wf[clone].inputs.ref_audio;
    if (isLink(ra) && LOADERS[wf[ra[0]]?.class_type]) roles.ref_audio = { node: ra[0], field: LOADERS[wf[ra[0]].class_type].field };
    const seed = findSeed(wf, clone);
    if (seed) roles.seed = seed;
    return { category: 'tts_clone', roles, family: 'Qwen3-TTS 声音克隆' };
  }
  return null;
}

function familyMusic3(wf) {
  const id = Object.keys(wf).find((k) => wf[k].class_type === 'MiniMaxMusic3TextEncode');
  if (!id) return null;
  const roles = {};
  for (const f of ['caption', 'lyrics', 'max_duration']) if (f in wf[id].inputs) roles[f] = resolveValue(wf, id, f);
  const seed = findSeed(wf, id);
  if (seed) roles.seed = seed;
  return { category: 'music', roles, family: 'MiniMax Music3' };
}

const FAMILIES = [familyH3Easy, familyH3Ref2V, familyQwenImage21, familyQwenTTS, familyMusic3];

// —— 通用启发式（不认识的节点家族） ——
function generic(wf, nameHint) {
  const roles = {};
  const loaders = loaderNodes(wf);
  const saves = findSaves(wf);
  const texts = [];
  for (const [id, n] of Object.entries(wf)) {
    for (const [f, v] of Object.entries(n.inputs || {})) {
      if (typeof v === 'string' && /^(text|prompt|positive)$/.test(f)) texts.push({ id, f, neg: /neg|负/i.test(titleOf(n)) });
    }
  }
  const pos = texts.find((t) => !t.neg);
  const neg = texts.find((t) => t.neg);
  if (pos) roles.positive_prompt = { node: pos.id, field: pos.f };
  if (neg) roles.negative_prompt = { node: neg.id, field: neg.f };
  const seed = findSeed(wf);
  if (seed) roles.seed = seed;
  for (const [id, n] of Object.entries(wf)) {
    const i = n.inputs || {};
    if (!roles.width && typeof i.width === 'number' && typeof i.height === 'number') {
      roles.width = { node: id, field: 'width' };
      roles.height = { node: id, field: 'height' };
    }
    for (const f of ['seconds', 'aspect_ratio', 'resolution']) if (!roles[f] && i[f] != null && !isLink(i[f])) roles[f] = { node: id, field: f };
    if (!roles.frames && typeof i.length === 'number' && /Video|Wan|Latent/i.test(n.class_type)) roles.frames = { node: id, field: 'length' };
  }
  const outVideo = saves.some((s) => /Video|VHS|WEBM|Animated/.test(s.class));
  const outAudio = saves.some((s) => /Audio/.test(s.class));
  let category = categoryOfName(nameHint);
  if (!category) {
    if (outVideo) category = loaders.video.length ? 'motion' : (loaders.audio.length && loaders.image.length === 1 ? 'digital_human' : 'r2v');
    else if (outAudio) category = loaders.audio.length ? 'tts_clone' : 'tts';
    else category = loaders.image.length ? 'i2i' : 't2i';
  }
  if (category === 'i2i' && loaders.image.length) roles.image = { node: loaders.image[0].node, field: loaders.image[0].field };
  if (category === 'tts_clone' && loaders.audio.length) roles.ref_audio = { node: loaders.audio[0].node, field: loaders.audio[0].field };
  return { category, roles, family: '' };
}

// 标签覆盖：#prompt 等直接指定角色
function applyTags(wf, roles, slots) {
  for (const [id, n] of Object.entries(wf)) {
    for (const { tag, n: idx } of tagsOf(n)) {
      const role = TAG_ROLES[tag];
      if (role) {
        const f = pickField(n, ROLE_FIELDS[role] || [role]);
        if (f) roles[role] = resolveValue(wf, id, f);
        continue;
      }
      const l = LOADERS[n.class_type];
      if (l && ['image', 'audio', 'video'].includes(tag)) {
        slots[tag] = slots[tag] || [];
        slots[tag][idx - 1] = { node: id, field: l.field };
      }
    }
  }
}

// 每个类别生产流水线必需的角色（缺了就标「需确认」）
export const REQUIRED_ROLES = {
  r2v: ['positive_prompt'],
  t2i: ['positive_prompt'],
  i2i: ['positive_prompt', 'image'],
  tts: ['text', 'voice_description'],
  tts_clone: ['text', 'ref_audio'],
  music: ['caption'],
  digital_human: [],
  motion: [],
};

/**
 * 分析一个 API 格式工作流。
 * @param {object} wf  ComfyUI API 格式（{ id: { class_type, inputs, _meta } }）
 * @param {object} opt { name, category }  category 来自云端文件夹，优先于识别结果
 * @returns {{ category, roles, media?, slots?, outputs, family, issues, ready }}
 */
export function analyzeApiWorkflow(wf, { name = '', category: forced = '' } = {}) {
  let base = null;
  for (const fam of FAMILIES) { base = fam(wf); if (base) break; }
  if (!base) base = generic(wf, name);
  const category = forced || base.category;
  const roles = { ...base.roles };
  const slots = { ...(base.slots || {}) };
  applyTags(wf, roles, slots);

  const saves = findSaves(wf);
  if (saves.length && !roles.filename_prefix && 'filename_prefix' in (wf[saves[0].id].inputs || {})) {
    roles.filename_prefix = { node: saves[0].id, field: 'filename_prefix' };
  }
  // 没有专用 media 承载节点时，普通 LoadImage/LoadAudio/LoadVideo 节点就是参考素材槽（按序填充）
  if (!base.media) {
    const loaders = loaderNodes(wf);
    for (const t of ['image', 'audio', 'video']) {
      if (!slots[t] && loaders[t].length) slots[t] = loaders[t].map((l) => ({ node: l.node, field: l.field }));
    }
  }
  // 数字人：一张头像 + 一段语音
  if (category === 'digital_human') {
    if (slots.image?.[0]) roles.avatar = slots.image[0];
    if (slots.audio?.[0]) roles.speech = slots.audio[0];
  }
  if (category === 'motion') {
    if (slots.image?.[0]) roles.character = slots.image[0];
    if (slots.video?.[0]) roles.driving_video = slots.video[0];
  }

  const issues = [];
  for (const r of REQUIRED_ROLES[category] || []) if (!roles[r]) issues.push('未识别到「' + r + '」');
  if (!saves.length) issues.push('没有保存节点（SaveImage / SaveVideo / SaveAudio）');
  if (!CATEGORY_MAP[category]) issues.push('无法判断类别');

  const spec = {
    category,
    kind: category,
    roles,
    outputs: [...new Set(saves.map((s) => s.class))],
    family: base.family || '',
    issues,
    ready: issues.length === 0,
  };
  if (base.media) spec.media = base.media;
  if (Object.keys(slots).length) spec.slots = Object.fromEntries(Object.entries(slots).map(([k, v]) => [k, v.filter(Boolean)]));
  return spec;
}

export function isApiFormat(json) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return false;
  if (Array.isArray(json.nodes)) return false;
  const vals = Object.values(json);
  return vals.length > 0 && vals.every((n) => n && typeof n === 'object' && typeof n.class_type === 'string');
}

export { VIDEO_RESOLUTION_MP };
