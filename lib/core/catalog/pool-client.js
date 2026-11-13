// RH 号池客户端（协议见项目文档「号池客户端对接说明」）。
// 流程：GET /v1/capabilities → POST /v1/assets → POST /v1/jobs（Idempotency-Key）→ 轮询 → 下载校验 → ack。
// 校验码只放请求头，不进日志、URL、提交参数。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { logger } from '../logger.js';

const TERMINAL_OK = new Set(['AWAITING_DOWNLOAD', 'DOWNLOADING', 'SUCCESS']);
const TERMINAL_BAD = new Set(['FAILED', 'CANCELED', 'RELEASED', 'NEEDS_ATTENTION', 'CANCEL_UNCERTAIN']);

function base(pool) {
  const u = String(pool?.baseUrl || '').trim().replace(/\/+$/, '');
  if (!u) throw new Error('未配置号池地址');
  return u;
}

export class PoolError extends Error {
  constructor(status, code, message, details) {
    super(message || code || ('号池请求失败 HTTP ' + status));
    this.status = status;
    this.code = code || '';
    this.details = details || {};
  }
}

async function call(pool, p, init = {}, { timeoutMs = 30_000, raw = false } = {}) {
  const res = await fetch(base(pool) + p, {
    ...init,
    headers: { Authorization: 'Bearer ' + String(pool.key || '').trim(), Accept: 'application/json', ...(init.headers || {}) },
    signal: init.signal || AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    let e = {};
    try { e = (await res.json())?.error || {}; } catch {}
    throw new PoolError(res.status, e.code, e.message, e.details);
  }
  return raw ? res : res.json();
}

export const poolCapabilities = (pool) => call(pool, '/v1/capabilities');
export const poolStatus = (pool) => call(pool, '/v1/pool/status', {}, { timeoutMs: 8000 });
export const poolJob = (pool, id) => call(pool, '/v1/jobs/' + encodeURIComponent(id), {}, { timeoutMs: 15_000 });
export const poolCancel = (pool, id) => call(pool, '/v1/jobs/' + encodeURIComponent(id) + '/cancel', { method: 'POST' });

export async function poolUpload(pool, absPath) {
  const buf = fs.readFileSync(absPath);
  const fd = new FormData();
  fd.append('file', new Blob([buf]), path.basename(absPath));
  const j = await call(pool, '/v1/assets', { method: 'POST', body: fd }, { timeoutMs: 120_000 });
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  if (j.sha256 && j.sha256 !== sha) throw new Error('号池素材上传校验失败（sha256 不一致）：' + path.basename(absPath));
  return j.id;
}

// 视频时长：字段名以 :length 结尾的单位是帧（24fps）。
// 号池对接说明里写「取 17n+5」，但同一文档的实测示例是 13.7 秒 → 329 帧，329 并不满足 17n+5，
// 而满足视频模型常见的 8n+1。这里以实测示例为准取 8n+1，待号池服务器确认后再定。
export function secondsToPoolFrames(sec) {
  const f = Math.max(9, Math.round(Number(sec) * 24));
  return 8 * Math.round((f - 1) / 8) + 1;
}

/**
 * 提交并等待完成，返回 { prompt_id, outputs:[{kind, filename, fileUrl, poolJob, poolOutput}] }。
 * parameters 为「节点ID:字段名 → 值」，值中 "asset:<id>" 引用已上传素材。
 */
export async function poolGenerate(pool, { workflow, parameters, assetIds, kind, target, idempotencyKey }, { timeoutMs = 90 * 60_000, pollMs = 6000, isAborted, onSubmitted, onStatus } = {}) {
  const body = {
    workflow_id: workflow.id,
    workflow_revision: workflow.revision || undefined,
    kind: kind === 'image' ? 'image' : (workflow.kind || kind || 'video'),
    instance_type: pool.instanceType || 'default',
    parameters,
    asset_ids: assetIds,
    target: target || undefined,
  };
  const key = idempotencyKey || ('ic-' + crypto.randomUUID());
  let job;
  try {
    job = await call(pool, '/v1/jobs', { method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(body) }, { timeoutMs: 60_000 });
  } catch (e) {
    if (e.code === 'STORAGE_HIGH_WATERMARK') throw new Error('号池服务器暂停接单（磁盘保护）：' + e.message);
    if (e.code === 'TARGET_BUSY') throw new Error('该镜头已有号池任务在跑：' + (e.details?.job_id || ''));
    throw e;
  }
  onSubmitted?.(job.id);
  const t0 = Date.now();
  let lastPhase = '';
  while (!TERMINAL_OK.has(job.status) && !TERMINAL_BAD.has(job.status)) {
    if (isAborted?.()) {
      try { await poolCancel(pool, job.id); } catch {}
      throw new Error('已取消');
    }
    if (Date.now() - t0 > timeoutMs) throw new Error('号池任务超时：' + job.id);
    await new Promise((r) => setTimeout(r, pollMs));
    try { job = await poolJob(pool, job.id); } catch (e) { logger.warn('号池轮询失败，稍后重试', { error: e.message }); continue; }
    if (job.phase && job.phase !== lastPhase) { lastPhase = job.phase; onStatus?.({ kind: 'progress', message: job.phase }); }
  }
  if (TERMINAL_BAD.has(job.status)) {
    const msg = typeof job.error === 'object' ? job.error?.message : job.error;
    throw new Error('号池任务' + (job.status === 'NEEDS_ATTENTION' ? '需要管理员处理' : '失败') + '：' + (msg || job.status));
  }
  const outputs = (job.outputs || []).filter((o) => o.required !== false && !o.deleted_at).map((o) => ({
    kind: /^video\//.test(o.mime) ? 'videos' : /^audio\//.test(o.mime) ? 'audio' : 'images',
    filename: o.name,
    poolJob: job.id,
    poolOutput: o,
    resultVersion: job.result_version,
  }));
  return { prompt_id: job.id, outputs };
}

// 下载一个输出并校验；全部 required 输出下载完由 poolAck 确认释放账号
export async function poolDownload(pool, out) {
  const o = out.poolOutput;
  const res = await call(pool, o.download_url.startsWith('/') ? o.download_url : '/' + o.download_url, {}, { timeoutMs: 30 * 60_000, raw: true });
  const buf = Buffer.from(await res.arrayBuffer());
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  if ((o.size && buf.length !== o.size) || (o.sha256 && sha !== o.sha256)) throw new Error('号池结果下载校验失败，请重试：' + o.name);
  // 同一任务的输出逐个下载完后再统一 ack：这里每下完一个就尝试 ack 一次（服务器按 required 全齐才转 SUCCESS）
  try {
    await call(pool, '/v1/jobs/' + encodeURIComponent(out.poolJob) + '/ack', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ outputs: [{ id: o.id, size: buf.length, sha256: sha }], result_version: out.resultVersion }),
    });
  } catch (e) {
    logger.warn('号池 ack 失败（结果已保存到本地）', { error: e.message });
  }
  return buf;
}
