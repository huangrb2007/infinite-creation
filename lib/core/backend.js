import { generate, downloadOutput, uploadToInput, interrupt, freeComfy, checkComfyUI } from './comfyui.js';
import * as rh from './runninghub.js';

// —— 渲染后端分派层 ——
// 原生 ComfyUI 逻辑（comfyui.js）保持不变；这里按 cfg.comfyui.provider 分派：
//   native     → 走 comfyui.js（传 cfg.comfyui.baseUrl）
//   runninghub → 走 runninghub.js 标准 OpenAPI（用 cfg.comfyui.apiKey / tier）
const isRunningHub = (cfg) => cfg?.comfyui?.provider === 'runninghub';

// 提交 + 等待完成，返回 { prompt_id, outputs, entry }（RunningHub 下 prompt_id = taskId）
export function generateTask(cfg, workflow, opts) {
  if (isRunningHub(cfg)) return rh.runninghubGenerate(cfg, workflow, opts);
  return generate(cfg.comfyui.baseUrl, workflow, opts);
}

// 上传参考文件，返回「上传后的文件名」：runninghub 返回平台 fileName。
// 其余通道（本机 / 云端 ComfyUI / 号池）延迟到真正提交时再上传：此时才知道这一步用哪个工作流、
// 走哪个后端（同一镜头的参考图，视频走号池、图片走云端 ComfyUI 时要传到不同地方）。
// 返回占位串，由 workflow-runner 在提交前替换成真实文件名 / 号池 asset 引用。
export const LAZY_PREFIX = '@@ic-local:';
export async function uploadTaskInput(cfg, localPath, filename) {
  if (isRunningHub(cfg)) return rh.runninghubUpload(cfg, localPath);
  return LAZY_PREFIX + JSON.stringify([localPath, filename]);
}
export function parseLazy(v) {
  if (typeof v !== 'string' || !v.startsWith(LAZY_PREFIX)) return null;
  try { const [abs, name] = JSON.parse(v.slice(LAZY_PREFIX.length)); return { abs, name }; } catch { return null; }
}
export { uploadToInput };

// 下载产物，返回 Buffer
export async function downloadTaskOutput(cfg, out) {
  if (isRunningHub(cfg)) return rh.runninghubDownload(out.fileUrl);
  return downloadOutput(cfg.comfyui.baseUrl, out);
}

// 打断/取消任务：runninghub 需 taskId（无 taskId 时 no-op，由 generateTask 内部 isAborted 兜底）
export function interruptTask(cfg, taskId) {
  if (isRunningHub(cfg)) return taskId ? rh.runninghubCancel(cfg, taskId) : Promise.resolve();
  return interrupt(cfg.comfyui.baseUrl);
}

// 释放显存：runninghub 云端无需（无 /free 端点）
export function freeBackend(cfg) {
  if (isRunningHub(cfg)) return Promise.resolve();
  return freeComfy(cfg.comfyui.baseUrl);
}

// 就绪检查
export function checkBackend(cfg) {
  if (isRunningHub(cfg)) return rh.runninghubCheck(cfg);
  return checkComfyUI(cfg.comfyui.baseUrl);
}
