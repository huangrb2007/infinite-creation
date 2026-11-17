import fs from 'node:fs';
import path from 'node:path';
import { WORKFLOWS_DIR } from './config.js';
import { Queue } from './db.js';
import { queueEnabled, runInQueue, poolOfKind } from './scheduler.js';
import { generateTask, downloadTaskOutput, freeBackend, parseLazy, uploadToInput } from './backend.js';
import { poolGenerate, poolUpload, poolDownload, secondsToPoolFrames } from './catalog/pool-client.js';
import crypto from 'node:crypto';
import { runApiImage, downloadApiImage } from './catalog/api-image.js';
import { runApiAudio, fixWavHeader } from './catalog/api-audio.js';
import { runApiVideo, runApiMusic } from './catalog/api-media.js';
import { ensureH264 } from './ffmpeg.js';
import { logger } from './logger.js';
import { runRenderSlot } from './render-gate.js';

// 通用工作流运行器：由「工作流规格」驱动，无需逐工作流手写 builder。
// spec 结构见 lib/shared/index.js 的 WORKFLOW_SPEC_SCHEMA。
// params 键 = spec.roles 的语义角色名（positive_prompt / negative_prompt / width / height / seed / seconds / resolution / aspect_ratio / image / filename_prefix），
// 额外支持 references = [{ type:'image'|'audio'|'video', filename }]，由 spec.media 绑定。

function loadSpecSource(sourceFile) {
  const p = path.join(WORKFLOWS_DIR, sourceFile);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function cloneSpecSource(spec) {
  // 云端/号池目录里的规格自带转换好的模板；内置规格读 workflows/ 下的文件
  if (spec.template) return JSON.parse(JSON.stringify(spec.template));
  return JSON.parse(JSON.stringify(loadSpecSource(spec.sourceFile)));
}

const MEDIA_LOADERS = {
  image: { class: 'LoadImage', field: 'image' },
  audio: { class: 'LoadAudio', field: 'audio' },
  video: { class: 'LoadVideo', field: 'file' },
};

function setInput(wf, nodeId, field, value) {
  const node = wf[nodeId];
  if (!node || !node.inputs) {
    logger.warn('工作流节点不存在，跳过写入', { node: nodeId, field });
    return;
  }
  node.inputs[field] = value;
}

function isLinkRef(v) {
  return Array.isArray(v) && typeof v[0] === 'string';
}

// 删除 spec.prune 点名的节点，以及从 spec.outputs 保存节点出发不可达的节点。
// 模板里自带硬编码文件名的占位参考图/音、以及被覆盖掉 prompt 的 LLM 改写链都要清掉：
// ComfyUI 会校验整张图，留着会因「文件不存在」或改写链缺依赖而拒绝整条 prompt。
function pruneWorkflow(wf, spec) {
  for (const id of spec.prune || []) delete wf[id];
  const roots = Object.keys(wf).filter((id) => (spec.outputs || []).includes(wf[id].class_type));
  if (!roots.length) return;
  const keep = new Set();
  const stack = [...roots];
  while (stack.length) {
    const id = stack.pop();
    if (keep.has(id) || !wf[id]) continue;
    keep.add(id);
    for (const v of Object.values(wf[id].inputs || {})) {
      if (isLinkRef(v) && wf[v[0]]) stack.push(v[0]);
    }
  }
  for (const id of Object.keys(wf)) {
    if (!keep.has(id)) delete wf[id];
  }
  // 顺带清掉指向已删节点的连线，否则 ComfyUI 校验时报缺失节点
  for (const node of Object.values(wf)) {
    for (const [field, v] of Object.entries(node.inputs || {})) {
      if (isLinkRef(v) && !wf[v[0]]) delete node.inputs[field];
    }
  }
}

// 统一编号 → 按类型编号；超出槽位数（没提交上去）的参考换成空，避免指向不存在的 <Picture 10>
export function slotPromptLabels(text, refs, slotRefs, spec) {
  const cap = { image: (spec.slots?.image || []).length, audio: (spec.slots?.audio || []).length, video: (spec.slots?.video || []).length };
  const counter = { image: 0, audio: 0, video: 0 };
  const label = new Map();
  for (const r of slotRefs) {
    const t = r.type === 'audio' ? 'audio' : r.type === 'video' ? 'video' : 'image';
    counter[t] += 1;
    if (counter[t] > cap[t]) continue;
    label.set(r, t === 'image' ? '<Picture ' + counter[t] + '>' : t === 'audio' ? '<Audio ' + counter[t] + '>' : '<Video ' + counter[t] + '>');
  }
  return String(text).replace(/__MINIMAX_H3_REF_(\d+)__/g, (m, n) => label.get(refs[Number(n) - 1]) || '');
}

// 依据 spec 构建可提交的 ComfyUI 图
const ASPECT_FULL_NAMES = {
  '1:1': '1:1 (Square)', '3:4': '3:4 (Portrait Standard)', '4:3': '4:3 (Standard)',
  '9:16': '9:16 (Portrait Widescreen)', '16:9': '16:9 (Widescreen)', '21:9': '21:9 (Ultrawide)',
};
const RES_SHORT = { '480P': 480, '608P': 608, '720P': 720, '768P': 768, '1080P': 1080 };
// 由画幅比例 + 分辨率档算宽高（短边 = 档位，长边按比例，32 对齐）
export function sizeForAspect(aspect, resolution) {
  const m = /^(\d+):(\d+)$/.exec(String(aspect || ''));
  if (!m) return null;
  const a = Number(m[1]); const b = Number(m[2]);
  const short = RES_SHORT[String(resolution || '').toUpperCase()] || 480;
  const long = Math.round((short * Math.max(a, b)) / Math.min(a, b) / 32) * 32;
  const s32 = Math.round(short / 32) * 32 || short;
  return a >= b ? { width: long, height: s32 } : { width: s32, height: long };
}

// 画幅兜底（实测：选 9:16 出来还是横屏）。号池工作流常常没把画幅字段写进 mapping：
// Work-Fisher-H3 的 aspect_ratio 在 115 节点、模板值写死「16:9 (Widescreen)」；YZ金鱼只映射了 width/height，
// 而出片时只传了 aspect_ratio。这里在没有对应角色时，按字段名找画幅字段，或由比例算出宽高。
function applyAspectFallback(wf, spec, params) {
  const roles = spec.roles || {};
  const aspect = params.aspect_ratio;
  if (!aspect) return;
  if (!roles.aspect_ratio) {
    for (const node of Object.values(wf)) {
      const ins = node?.inputs || {};
      if (typeof ins.aspect_ratio === 'string') {
        ins.aspect_ratio = /\(/.test(ins.aspect_ratio) ? (ASPECT_FULL_NAMES[aspect] || ins.aspect_ratio) : aspect;
      }
    }
  }
  if (!roles.aspect_ratio && roles.width && roles.height && params.width == null && params.height == null) {
    const sz = sizeForAspect(aspect, params.resolution);
    if (sz) { setInput(wf, roles.width.node, roles.width.field, sz.width); setInput(wf, roles.height.node, roles.height.field, sz.height); }
  }
}

export function buildWorkflow(spec, params = {}) {
  const wf = cloneSpecSource(spec);
  const roles = spec.roles || {};
  applyAspectFallback(wf, spec, params);
  for (const [key, val] of Object.entries(params)) {
    if (key === 'references') continue;
    const role = roles[key];
    if (role && val != null && val !== '') setInput(wf, role.node, role.field, mapRoleValue(role, val));
  }

  const refs = params.references;
  if (spec.media && Array.isArray(refs)) {
    bindMedia(wf, spec.media, refs);
  } else if (spec.slots && Array.isArray(refs)) {
    const viaRoles = new Set(Object.entries(params).filter(([k]) => k !== 'references' && roles[k]).map(([, v]) => v));
    const slotRefs = refs.filter((r) => !viaRoles.has(r.filename));
    bindSlots(wf, spec, slotRefs);
    // 槽位式工作流（号池的 H3 工作流等）：图片、音频各自从 1 编号（<Picture 1>…、<Audio 1>…），
    // 提示词里的 __MINIMAX_H3_REF_N__ 是「全部参考统一编号」，必须按类型换成对应标签。
    // 以前原样发过去：第一个音频是 REF_6，模型找不到 <Audio 1> 对应谁，音色乱配（旁白、人物声音绑错）。
    const pr = roles.positive_prompt;
    const text = params.positive_prompt;
    if (pr && typeof text === 'string' && /__MINIMAX_H3_REF_\d+__/.test(text)) {
      setInput(wf, pr.node, pr.field, mapRoleValue(pr, slotPromptLabels(text, refs, slotRefs, spec)));
    }
  }
  if (spec.backend !== 'pool') pruneWorkflow(wf, { ...spec, outputs: resolveOutputs(wf, spec) });
  return wf;
}

// 目录规格的 outputs 是识别时记下的保存节点类型；'*' 表示不剪枝（号池虚拟模板）
function resolveOutputs(wf, spec) {
  if ((spec.outputs || []).length) return spec.outputs;
  return Object.values(wf).map((n) => n.class_type).filter((t) => /^Save|VideoCombine/.test(t || ''));
}

// 普通加载器槽位：参考素材按类型依次填进 LoadImage/LoadAudio/LoadVideo；
// 已被角色（avatar/speech/image…）占用的槽跳过；多余的素材丢弃并记日志，没填到的槽删掉。
function bindSlots(wf, spec, references) {
  // 被角色占用的「节点:字段」（如数字人的 avatar/speech）不再当参考素材槽；同一节点的其它字段照常可用
  const roleFields = new Set(Object.values(spec.roles || {}).map((r) => r.node + ':' + r.field));
  const free = (s) => !roleFields.has(s.node + ':' + s.field);
  const used = new Set();
  const byType = { image: [], audio: [], video: [] };
  for (const r of references) (byType[r.type] || byType.image).push(r);
  for (const [type, list] of Object.entries(byType)) {
    const slots = (spec.slots?.[type] || []).filter(free);
    list.forEach((ref, i) => {
      const slot = slots[i];
      if (!slot) { logger.warn('工作流参考' + type + '槽不够，多出的素材未使用', { spec: spec.id, label: ref.label }); return; }
      setInput(wf, slot.node, slot.field, ref.filename);
      used.add(slot.node);
    });
  }
  if (spec.backend === 'pool') return;
  // 没填到的槽：独立的加载器节点直接删掉（模板里的占位文件在云端可能不存在）；
  // 多个槽共用一个节点的（如 Zealman 的 ref_image_0…8 字段），只把该字段清空
  const usedFields = new Set();
  for (const [type, list] of Object.entries(byType)) (spec.slots?.[type] || []).filter(free).slice(0, list.length).forEach((s) => usedFields.add(s.node + ':' + s.field));
  const perNode = {};
  for (const list of Object.values(spec.slots || {})) for (const s of list) perNode[s.node] = (perNode[s.node] || 0) + 1;
  for (const list of Object.values(spec.slots || {})) {
    for (const s of list) {
      if (usedFields.has(s.node + ':' + s.field) || !free(s) || !wf[s.node]) continue;
      if (perNode[s.node] > 1) wf[s.node].inputs[s.field] = '';
      else if (!used.has(s.node)) delete wf[s.node];
    }
  }
}

// 提交前把延迟上传的占位串换成真实引用：ComfyUI → 上传到 input 目录后的文件名；号池 → asset:<id>
async function materializeUploads(cfg, spec, wf) {
  const assetIds = [];
  const cache = new Map();
  for (const node of Object.values(wf)) {
    for (const [k, v] of Object.entries(node.inputs || {})) {
      const lazy = parseLazy(v);
      if (!lazy) continue;
      if (!cache.has(lazy.abs)) {
        if (spec.backend === 'pool') {
          const id = await poolUpload(cfg.catalog.pool, lazy.abs);
          assetIds.push(id);
          cache.set(lazy.abs, 'asset:' + id);
        } else {
          await uploadToInput(cfg.comfyui.baseUrl, lazy.abs, lazy.name);
          cache.set(lazy.abs, lazy.name);
        }
      }
      node.inputs[k] = cache.get(lazy.abs);
    }
  }
  return assetIds;
}

// 只提交「改过的字段」：和号池目录里的默认值一样的不发，号池按它当前保存的工作流跑。
// 原来把全部字段连默认值一起发回去，号池那边改了工作流（换模型、换 LoRA）后，这里旧的默认值会把它盖回去。
function poolParameters(wf, base = {}) {
  const params = {};
  for (const [id, node] of Object.entries(wf)) {
    for (const [f, v] of Object.entries(node.inputs || {})) {
      if (v === '' || v == null) continue;
      const def = base?.[id]?.inputs?.[f];
      if (def !== undefined && JSON.stringify(def) === JSON.stringify(v)) continue;
      params[id + ':' + f] = v;
    }
  }
  return params;
}

// role.map：把应用层的枚举值翻译成目标节点认识的枚举（如 '16:9' → '16:9 (Widescreen)'、'480P' → 0.5）
function mapRoleValue(role, val) {
  if (role.transform === 'frames24') return secondsToPoolFrames(val);
  return role.map && role.map[val] !== undefined ? role.map[val] : val;
}

function bindMedia(wf, media, references) {
  const targetNode = wf[media.targetNode];
  if (!targetNode?.inputs) throw new Error('工作流缺少 media 承载节点：' + media.targetNode);
  const inputs = targetNode.inputs;
  // 两种字段命名：mediaField/typeField 是「第 n 个媒体 + 第 n 个类型」；fieldsByType 是按类型各有前缀
  // （MiniMax H3 的 Autogrow 输入：ref_images.ref_image_0 / ref_audios.ref_audio_0 …，各自独立编号）
  const fieldsByType = media.fieldsByType || null;
  const mediaField = media.mediaField || 'media_';
  const typeField = media.typeField ?? 'media_type_';
  const fieldPrefixes = (type) => {
    const v = fieldsByType?.[type];
    if (!v) return null;
    return Array.isArray(v) ? v : [v];
  };
  // 记录模板自带的占位 loader 节点，供后面清理（模板如 LoadAudio/LoadImage 带硬编码文件名）
  const originalLoaders = new Set();
  for (const arr of Object.values(media.reusePool || {})) for (const n of arr) originalLoaders.add(String(n));
  // 清理旧 media 字段
  const allPrefixes = fieldsByType
    ? [...new Set(Object.values(fieldsByType).flatMap((v) => (Array.isArray(v) ? v : [v])))]
    : [mediaField, typeField].filter(Boolean);
  for (const k of Object.keys(inputs)) {
    if (k === 'media' || allPrefixes.some((p) => k.startsWith(p))) delete inputs[k];
  }

  const loaders = media.loaders || MEDIA_LOADERS;
  const reusePool = media.reusePool || { image: [], audio: [], video: [] };
  const usedCount = { image: 0, audio: 0, video: 0 };
  const usedNodes = new Set();

  references.forEach((ref, i) => {
    const n = i + 1;
    const type = loaders[ref.type] ? ref.type : 'image';
    const loader = loaders[type];
    const pool = reusePool[type] || [];
    const prefixes = fieldPrefixes(type);
    // 该工作流不支持这种媒体类型（如只给图片槽的 r2v 收到 video）：跳过，不占编号
    if (fieldsByType && !prefixes.length) return;
    let nodeId;
    if (usedCount[type] < pool.length) {
      nodeId = pool[usedCount[type]];
      setInput(wf, nodeId, loader.field, ref.filename);
      usedNodes.add(nodeId);
    } else {
      nodeId = String(1000 + i);
      wf[nodeId] = { inputs: { [loader.field]: ref.filename }, class_type: loader.class, _meta: { title: loader.class } };
      usedNodes.add(nodeId);
    }
    usedCount[type]++;
    if (prefixes) {
      // 按类型各自编号，编号从 0 起（对应 ref_images.ref_image_0）
      for (const prefix of prefixes) inputs[prefix + (usedCount[type] - 1)] = [nodeId, 0];
    } else {
      inputs[mediaField + n] = [nodeId, 0];
      if (typeField) inputs[typeField + n] = type;
    }
  });

  // 删除未再引用的模板占位 loader 节点（避免 ComfyUI 校验模板里的占位音/图导致整图被拒）
  for (const nodeId of originalLoaders) {
    if (!usedNodes.has(nodeId) && wf[nodeId]) delete wf[nodeId];
  }
}

// —— 生成维护：所有 ComfyUI 生成共用的显存释放计数 ——
// AMD Dynamic VRAM 的显存累积退化不只在视频生成触发：文生图/图生图/换装/音色连续生成同样会逐步变慢
//（Comfy-Org/comfyui #13087、patientx-cfz/comfyui-rocm #114），所以在 runWorkflow（全部渲染任务的
// 必经出口）统一计数：每成功/失败跑完 N 个生成任务调一次 ComfyUI /free。
// /free 的清理实际发生在下一个任务跑完后（flag 机制），所以「每 N 个生成清一次」正好让下一批从头开始。
// N=0 / 未配置 = 关闭。读取优先新键 freeAfterEvery，兼容旧键 videoFreeAfterEvery。
// 计数器挂在 globalThis：Next 会为不同 route 各打包一份本模块，模块级变量在多个实例间不共享，
// 各自计数会让「每 N 个生成清一次」的实际频率漂移（与 job-runner / ws 的共享状态同一处置）。
const freeState = (globalThis.__icRendersSinceFree = globalThis.__icRendersSinceFree || { n: 0 });
export async function maybeFreeComfy(cfg) {
  const N = Number(cfg.generation?.freeAfterEvery ?? cfg.generation?.videoFreeAfterEvery) || 0;
  if (N <= 0) return;
  freeState.n += 1;
  if (freeState.n < N) return;
  freeState.n = 0;
  try {
    await freeBackend(cfg);
    logger.info('已调用 ComfyUI /free 释放显存（每 ' + N + ' 个生成任务一次）');
  } catch (e) {
    logger.warn('调用 ComfyUI /free 失败，继续生成（不影响当前结果）', { error: e.message });
  }
}

// 生成并返回 { prompt_id, outputs, kind }，kind 取 spec.outputs 对应的产物类别
//
// 这里是**所有渲染的唯一收口点**，所以渲染槽位在这里获取（而不是在各个工具里）：
// 一次提交占一个槽，槽位上限由 lib/core/render-gate.js 的 concurrencyLimit() 决定
// （RunningHub = runninghubConcurrency，本地 ComfyUI 恒为 1）。
// 调用方通过 opts 传 jobId / unitId / isAborted，用于排队归属与取消。
export async function runWorkflow(cfg, spec, params, opts = {}) {
  if (spec?.backend === 'pool') return runPoolWorkflow(cfg, spec, params, opts);
  if (String(spec?.backend || '').startsWith('api-')) {
    // LLM 接口同时在跑的任务数（catalog.apiConcurrency，默认 5），多出来的在本机排队
    const lim = Math.max(1, Number(cfg.catalog?.apiConcurrency) || 5);
    return withGate(apiGate, lim, () => {
      const o = { timeoutMs: opts.timeoutMs, isAborted: opts.isAborted };
      if (spec.backend === 'api-video') return runApiVideo(cfg, spec, params, { ...o, onSubmitted: opts.onSubmitted });
      if (spec.backend === 'api-music') return runApiMusic(cfg, spec, params, o);
      if (spec.backend === 'api-audio') return runApiAudio(cfg, spec, params, o);
      return runApiImage(cfg, spec, params, o);
    });
  }
  try {
    const wf = buildWorkflow(spec, params);
    await materializeUploads(cfg, spec, wf);
    // RunningHub 云端：每一次真正的生成都进公平队列（按用户轮转、按池保底），
    // 而不是让整条流水线占住槽位。本地 ComfyUI 保持原来的整批串行闸门（见 job-runner）。
    let result;
    const kind = spec?.kind || '';
    if (queueEnabled(cfg)) {
      result = await runInQueue(
        {
          jobId: opts.jobId,
          projectId: opts.projectId,
          pool: poolOfKind(spec?.kind),
          kind,
          chapter: opts.chapter || '',
          subject: opts.subject || '',
          isAborted: opts.isAborted,
          onQueue: opts.onQueue,
          waitMaxMs: opts.queueTimeoutMs,
          dedupeKey: opts.dedupeKey || '',
          payload: { spec: spec?.id || '', kind: spec?.kind || '' },
        },
        (item) =>
          generateTask(cfg, wf, {
            ...opts,
            // 记下远端 taskId：停止/对账时要用（取消走 runninghubCancel）
            onSubmitted: (pid) => {
              Queue.setRemote(item.id, pid);
              if (opts.onSubmitted) opts.onSubmitted(pid);
            },
          }),
      );
    } else {
      // 本地 ComfyUI：渲染项级闸门，保证同一时刻只有一个提交；
      // 任务级串行由 job-runner 的 runExclusiveVideo 负责。
      result = await runRenderSlot(
        () => generateTask(cfg, wf, opts),
        { jobId: opts.jobId, unitId: opts.unitId, isAborted: opts.isAborted, onQueue: opts.onQueue },
      );
    }
    const { prompt_id, outputs } = result;
    return { prompt_id, outputs };
  } finally {
    // 无论成功失败都计数：失败的残留更值得清
    await maybeFreeComfy(cfg);
  }
}

// 号池：自带排队与并发（按客户端限额），这里只占本进程的号池槽位，不走本地 ComfyUI 闸门
const poolGate = (globalThis.__icPoolGate = globalThis.__icPoolGate || { running: 0, waiters: [] });
async function withGate(gate, limit, fn) {
  while (gate.running >= limit) await new Promise((r) => gate.waiters.push(r));
  gate.running++;
  try { return await fn(); } finally { gate.running--; gate.waiters.shift()?.(); }
}
const apiGate = (globalThis.__icApiGate = globalThis.__icApiGate || { running: 0, waiters: [] });
function withPoolSlot(limit, fn) { return withGate(poolGate, limit, fn); }

// 号池侧的临时性失败（代理断线、网关超时、原站抖动、显存不足）：换一条任务重提，不让整镜直接判失败。
// 配置 catalog.poolRetries（默认 2）。参数 / 工作流本身的错误（校验失败、模型不在列表）不重试。
const POOL_TRANSIENT_RE = /代理|proxy|网关|gateway|50[234]|超时|timeout|timed out|连接失败|连接被重置|ECONNRESET|原站|显存|out of memory|OOM|result_lost|暂时|稍后|TOKEN_INVALID|token.*(invalid|expired)|ACCOUNT_(DISABLED|INVALID)|账号.*(失效|过期)/i;
const POOL_PERMANENT_RE = /validation|not in list|value_not_in|不在列表|参数|需要管理员|TARGET_BUSY|已取消|QUEUE_LIMIT|WORKFLOW_/i;

async function runPoolWorkflow(cfg, spec, params, opts) {
  const pool = cfg.catalog?.pool;
  if (!pool?.enabled || !pool?.baseUrl) throw new Error('选了号池工作流，但设置里没有启用号池');
  // 随机种子：号池默认用工作流里存的种子，不填每次结果一样
  const p = { ...params };
  if (spec.roles?.seed && (p.seed == null || p.seed === '')) p.seed = crypto.randomInt(1, 2 ** 47);
  const limit = Math.max(1, Number(cfg.catalog?.poolConcurrency) || 4);
  const retries = Math.max(0, Number(cfg.catalog?.poolRetries ?? 2));
  return withPoolSlot(limit, async () => {
    const out = spec.category === 't2i' || spec.category === 'i2i' ? 'image' : 'video';
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (opts.isAborted?.()) throw new Error('已取消');
      // 每次重提都重新组装并上传素材：上一条任务失败后，号池可能已经清掉它的素材
      const wf = buildWorkflow(spec, p);
      const assetIds = await materializeUploads(cfg, spec, wf);
      try {
        return await poolGenerate(pool, {
          workflow: { id: spec.pool.id, revision: spec.pool.revision, kind: spec.pool.kind },
          parameters: poolParameters(wf, spec.template),
          assetIds,
          kind: out,
          target: opts.dedupeKey ? { shot_id: String(opts.dedupeKey).slice(0, 120), project_id: opts.projectId || '' } : undefined,
          idempotencyKey: attempt === 0 ? opts.idempotencyKey : undefined,
        }, { timeoutMs: opts.timeoutMs, isAborted: opts.isAborted, onSubmitted: opts.onSubmitted, onStatus: opts.onStatus });
      } catch (e) {
        lastErr = e;
        const msg = String(e?.message || e);
        if (opts.isAborted?.() || attempt >= retries || POOL_PERMANENT_RE.test(msg) || !POOL_TRANSIENT_RE.test(msg)) throw e;
        logger.warn('号池任务临时性失败，自动重提', { attempt: attempt + 1, error: msg.slice(0, 200) });
        opts.onStatus?.({ kind: 'progress', message: '号池临时失败（' + msg.slice(0, 40) + '），自动重提第 ' + (attempt + 1) + ' 次' });
        await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
      }
    }
    throw lastErr;
  });
}

// 从 outputs 里挑出目标类别（image/video/audio）
export function pickOutput(outputs, kind) {
  return outputs.find((o) => o.kind === kind);
}

export async function downloadToFile(cfg, out, localAbsPath) {
  const buf = out.poolOutput ? await poolDownload(cfg.catalog.pool, out)
    : (out.apiData || out.apiUrl) ? (out.kind === 'audio' ? fixWavHeader(await downloadApiImage(out)) : await downloadApiImage(out))
    : await downloadTaskOutput(cfg, out);
  fs.mkdirSync(path.dirname(localAbsPath), { recursive: true });
  fs.writeFileSync(localAbsPath, buf);
  // 接口出的视频可能是 H.265 10-bit（浏览器和单镜直出放不了），统一转成 H.264
  if (out.apiUrl && out.kind === 'videos') await ensureH264(localAbsPath);
  return localAbsPath;
}

// 分镜未显式指定 mode 时的确定性推断兜底（保证存量分镜行为不变）：
//  - 0 媒体 → image（文生：不连接任何媒体，等同 text，经 spec 的 mode.map 映射成节点 image）
//  - 仅 1~2 张图（无音/视频）→ image（1 张 = 图生，2 张 = 首尾帧）
//  - 其余（≥3 图 或 含音/视频）→ reference（参考生视频）
// text 与 digital_human 不做自动推断，只由显式 mode 触发：text 与「未绑定媒体」无法区分，
// digital_human 与 reference 在「1 图 + 1 音频」上歧义。
export function inferVideoMode(references) {
  const refs = Array.isArray(references) ? references : [];
  const images = refs.filter((r) => r.type === 'image').length;
  const videos = refs.filter((r) => r.type === 'video').length;
  const audios = refs.filter((r) => r.type === 'audio').length;
  if (!images && !videos && !audios) return 'image';
  if (!videos && !audios && images <= 2) return 'image';
  return 'reference';
}
