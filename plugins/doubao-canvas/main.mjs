// 豆包画布助手 · 视频插件（短剧制作 Studio）
//
// 对接本机运行的「豆包画布助手」（默认 http://127.0.0.1:17999）：
//   GET  /api/health              连通性 + 账号列表（免令牌）
//   GET  /api/ui/build-info       画布助手版本
//   POST /api/generate            提交任务 → { task_id }
//   GET  /api/tasks/{id}          任务状态 → { status, progress, detail, account, result_path }
//   POST /api/tasks/resume        画布助手里点过「终止」后恢复接单
// 请求头 X-Bridge-Token：画布助手启动时把本机随机令牌写到 ~/.doubao_dola/bridge_token.json（也在它的程序目录下）。
// 成片由画布助手下载到本机，result_path 是本机路径，这里复制到 outDir 交回宿主。
//
// 本插件只是把任务交给你自己运行、自己登录的画布助手；账号、授权、额度都在画布助手里管理。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const TARGETS = {
  doubao: '豆包生成（官方无水印原片）',
  dola: 'dola生成（不调用 Edge）',
  feishu: '飞书生成（官方无水印原画）',
};
const RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readToken(file) {
  try {
    const t = fs.readFileSync(file, 'utf8').trim();
    if (!t) return '';
    if (t.startsWith('{')) {
      try { const j = JSON.parse(t); return String(j.token || j.bridge_token || j.value || '').trim() || t; } catch { return t; }
    }
    return t;
  } catch { return ''; }
}

// 画布助手启动时把自己的路径写到 ~/.doubao_dola/manager_path.json（root / dir）
function managerDirs() {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.doubao_dola', 'manager_path.json'), 'utf8').replace(/^\uFEFF/, ''));
    return [...new Set([j.root, j.dir].filter((d) => typeof d === 'string' && d.trim()))];
  } catch { return []; }
}

function tokenCandidates(params) {
  const out = [];
  const add = (t) => { t = String(t || '').trim(); if (t && !out.includes(t)) out.push(t); };
  add(params.bridge_token);
  add(process.env.DBM_BRIDGE_TOKEN);
  const exe = String(params.manager_exe || '').trim().replace(/^"|"$/g, '');
  if (exe) add(readToken(path.join(path.dirname(exe), 'bridge_token.json')));
  // 画布助手程序目录里的令牌才是它实际校验用的：用户目录那份是「镜像」，
  // 实测会被重复启动的第二个实例（退出前）覆盖成一个新随机值，导致 401。
  // 所以先按 ~/.doubao_dola/manager_path.json 找到程序目录读它，再读镜像。
  for (const dir of managerDirs()) add(readToken(path.join(dir, 'bridge_token.json')));
  add(readToken(path.join(os.homedir(), '.doubao_dola', 'bridge_token.json')));
  if (process.env.DBM_HOME) add(readToken(path.join(process.env.DBM_HOME, 'bridge_token.json')));
  return out.length ? out : [''];
}

function baseOf(params) {
  return String(params.manager_url || 'http://127.0.0.1:17999').trim().replace(/\/+$/, '');
}

// 带令牌重试：401 换下一个候选令牌
// 画布助手当前实际使用的令牌：它给自己的界面页（/index.html）注入 window.__BRIDGE_TOKEN__。
// 文件里的令牌可能已经过期（重复启动会覆盖用户目录的镜像；打包版的程序目录令牌也不一定是运行中的那个），
// 所以文件令牌都被拒（401）时，从本机界面页取一次，按地址缓存。
const liveTokens = new Map();
async function liveToken(base) {
  if (liveTokens.has(base)) return liveTokens.get(base);
  try {
    const res = await fetch(base + '/index.html', { signal: AbortSignal.timeout(8000) });
    const html = await res.text();
    const m = /window\.__BRIDGE_TOKEN__\s*=\s*"([^"]+)"/.exec(html);
    const tok = m ? m[1] : '';
    if (tok) liveTokens.set(base, tok);
    return tok;
  } catch { return ''; }
}

async function call(params, method, p, body, timeoutMs = 60_000) {
  const base = baseOf(params);
  let saw401 = false;
  const cands = tokenCandidates(params);
  if (liveTokens.has(base)) cands.unshift(liveTokens.get(base));
  for (let i = 0; i < cands.length; i++) {
    const tok = cands[i];
    let res;
    try {
      res = await fetch(base + p, {
        method,
        headers: { 'X-Bridge-Token': tok, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      const err = new Error('连不上豆包画布助手（' + base + '）：' + (e?.cause?.code || e?.message || e));
      err.code = 'UNREACHABLE';
      throw err;
    }
    if (res.status === 401) {
      saw401 = true;
      if (liveTokens.get(base) === tok) liveTokens.delete(base); // 画布助手重启换了令牌
      if (i === cands.length - 1) {
        const live = await liveToken(base);
        if (live && !cands.includes(live)) cands.push(live);
      }
      continue;
    }
    const text = await res.text();
    let j;
    try { j = JSON.parse(text); } catch { j = { raw: text }; }
    if (!res.ok) {
      const err = new Error('豆包画布助手返回 ' + res.status + '：' + String(j?.error || j?.message || text).slice(0, 300));
      err.status = res.status;
      throw err;
    }
    return j;
  }
  if (saw401) throw new Error('豆包画布助手令牌校验失败（401）：先启动一次画布助手让它写出令牌，或在插件设置里填「桥接令牌」');
  throw new Error('没有可用的桥接令牌');
}

async function alive(params) {
  try { const h = await call(params, 'GET', '/api/health', null, 5000); return h; } catch { return null; }
}

async function ensureManager(params, onProgress) {
  const h = await alive(params);
  if (h) return h;
  let exe = String(params.manager_exe || '').trim().replace(/^"|"$/g, '');
  if (!exe) { try { exe = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.doubao_dola', 'manager_path.json'), 'utf8').replace(/^\uFEFF/, '')).exe || ''; } catch {} }
  if (exe && fs.existsSync(exe)) {
    onProgress?.('正在启动豆包画布助手');
    try {
      const child = spawn(exe, [], { cwd: path.dirname(exe), detached: true, stdio: 'ignore', windowsHide: false });
      child.unref();
    } catch {}
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
      await sleep(1500);
      const h2 = await alive(params);
      if (h2) return h2;
    }
  }
  throw new Error('豆包画布助手没有运行：请先启动「豆包画布助手.exe」并登录账号' + (exe ? '' : '（也可以在插件设置里填它的路径，出片时自动启动）'));
}

function accountsSummary(h) {
  const accs = Array.isArray(h?.accounts) ? h.accounts : [];
  const logged = accs.filter((a) => a?.logged_in).length;
  return { total: accs.length, logged };
}

// 画布助手 V11.20 起不再在打开账号时自动保存登录态，界面里也去掉了「保存登录状态」，
// 只扫码 / 在网页里登录过的号没有 storage_state.json，被当成「未登录 / 掉线」、不参与派发。
// 这里用画布助手自己的界面接口逐个补存：打开账号页 → 等加载 → 保存登录态 → 关掉（一次只开一个，避免它多开闪退）。
async function syncLogins(params, onLog) {
  const list = await call(params, 'GET', '/api/accounts', null, 15_000);
  const accs = (list?.data || list?.accounts || []).filter((a) => a && a.name);
  const todo = accs.filter((a) => !a.logged_in);
  if (!todo.length) return { ok: true, message: '全部 ' + accs.length + ' 个账号都已是在线状态' };
  let opened = new Set();
  try {
    const st = await call(params, 'GET', '/api/ui/accounts-open-state', null, 10_000);
    opened = new Set(((st?.data?.open) || []).map((x) => String(x?.name || x?.id || '')));
  } catch {}
  const q = (name) => '?id=' + encodeURIComponent(name);
  for (const a of todo) {
    onLog?.('同步 ' + a.name);
    try {
      if (!opened.has(a.name)) await call(params, 'GET', '/api/ui/accounts-open' + q(a.name) + '&popout=0', null, 15_000);
      await sleep(10_000);   // 等账号网页加载出登录态
      await call(params, 'GET', '/api/ui/accounts-save-login' + q(a.name), null, 15_000);
      await sleep(4_000);    // 画布助手异步读 cookie 再落盘（它自己的错开间隔是 3.5 秒）
      if (!opened.has(a.name)) { await call(params, 'GET', '/api/ui/accounts-close' + q(a.name), null, 10_000); await sleep(2_000); }
    } catch {}
  }
  const after = await call(params, 'GET', '/api/accounts', null, 15_000);
  const all = (after?.data || after?.accounts || []).filter((a) => a && a.name);
  const still = all.filter((a) => !a.logged_in).map((a) => a.name);
  return {
    ok: true,
    message: '同步了 ' + todo.length + ' 个账号：现在在线 ' + (all.length - still.length) + ' 个'
      + (still.length ? '；仍未登录 ' + still.length + ' 个（' + still.slice(0, 12).join('、') + (still.length > 12 ? '…' : '') + '），这些号的网页里确实没有登录，需要在画布助手里重新登录' : ''),
  };
}

// 设置页按钮调用的动作
export const actions = {
  async sync_logins(params) {
    if (!(await alive(params))) return { ok: false, message: '连不上画布助手，请先启动它' };
    return syncLogins(params);
  },
  // 自动检测画布助手路径：画布助手运行过一次就会把路径写到 ~/.doubao_dola/manager_path.json
  async detect_manager() {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.doubao_dola', 'manager_path.json'), 'utf8').replace(/^\uFEFF/, ''));
      if (j.exe && fs.existsSync(j.exe)) return { ok: true, value: j.exe, message: '已找到：' + j.exe };
      return { ok: false, message: '记录的路径已不存在：' + (j.exe || '（空）') + '，请启动一次画布助手或点「浏览」手动选择' };
    } catch {
      return { ok: false, message: '没找到记录：请先启动一次豆包画布助手，或点「浏览」手动选择' };
    }
  },
};

export async function test(params) {
  const h = await alive(params);
  if (!h) {
    const exe = String(params.manager_exe || '').trim();
    return { ok: false, message: '连不上 ' + baseOf(params) + '：请先启动豆包画布助手' + (exe && !fs.existsSync(exe) ? '（填的 exe 路径不存在）' : '') };
  }
  let ver = '';
  try { const b = await call(params, 'GET', '/api/ui/build-info', null, 5000); ver = String(b?.data?.version || b?.version || ''); } catch (e) {
    if (/401/.test(e.message)) return { ok: false, message: e.message };
  }
  const { total, logged } = accountsSummary(h);
  return { ok: true, message: '已连接' + (ver ? '（' + ver + '）' : '') + '：账号 ' + total + ' 个，已登录 ' + logged + ' 个' };
}

function nearestRatio(r) {
  const s = String(r || '').replace(/[：∶]/g, ':').replace(/\s+/g, '');
  if (RATIOS.includes(s)) return s;
  const [w, h] = s.split(':').map(Number);
  if (!(w > 0 && h > 0)) return '16:9';
  const t = Math.log(w / h);
  return RATIOS.reduce((best, x) => {
    const [a, b] = x.split(':').map(Number);
    const [c, d] = best.split(':').map(Number);
    return Math.abs(Math.log(a / b) - t) < Math.abs(Math.log(c / d) - t) ? x : best;
  }, '16:9');
}

const MODERATION_RE = /审核不通过|审核未通过|业务码[:：]\s*2(?!\d)|compliance|合规/i;

export async function generate(ctx) {
  const params = ctx.params || {};
  const onProgress = ctx.onProgress || (() => {});
  await ensureManager(params, onProgress);

  const tp = TARGETS[params.target_platform] ? params.target_platform : 'doubao';
  let execMode = String(params.exec_mode || 'api_popout');
  if (!['chat', 'canvas', 'api', 'api_popout'].includes(execMode)) execMode = 'api_popout';
  if (tp === 'feishu') execMode = 'api_popout';                       // 飞书固定外部弹窗
  if (tp === 'dola' && execMode.startsWith('api')) execMode = 'chat';  // 接口直连只支持豆包画布
  const seconds = Math.max(5, Math.min(15, Math.round(Number(ctx.seconds) || 10)));
  const timeoutSec = Math.max(300, Math.round((Number(params.timeout_min) || 60) * 60));
  const round = ctx.regenerate ? (Math.abs(Number(ctx.seed) || Date.now()) % 1_000_000) + 1 : 0;
  const payload = {
    prompt: String(ctx.prompt || '').trim(),
    image_paths: (ctx.images || []).filter((f) => f && fs.existsSync(f)).slice(0, 9),
    generation_round: round,
    force_new_window: round > 0,
    timeout_sec: timeoutSec,
    target: TARGETS[tp],
    target_platform: tp,
    model: String(params.model || 'seedance2.0fast'),
    duration: seconds + 's',
    ratio: nearestRatio(ctx.ratio),
    resolution: tp === 'feishu' ? String(params.resolution || '1080P') : '',
    exec_mode: execMode,
    allow_paid_quota: false,
    // 与字字动画插件对齐：只交付无水印原片；对话模式没开始生成时自动回复的内容和次数
    remove_watermark: true,
    nudge_text: '生成视频',
    nudge_max: 6,
  };
  if (!payload.prompt) throw new Error('提示词为空');
  if (params.account_group) payload.account_group = String(params.account_group).trim();

  let resp = await call(params, 'POST', '/api/generate', payload);
  let taskId = resp?.task_id;
  if (!taskId && resp?.project_stopped) {
    // 画布助手里点过「终止」会拒单：自动恢复后重投一次
    onProgress('画布助手处于停止状态，自动恢复');
    await call(params, 'POST', '/api/tasks/resume', {});
    resp = await call(params, 'POST', '/api/generate', payload);
    taskId = resp?.task_id;
  }
  if (!taskId) throw new Error('豆包画布助手没有接单：' + String(resp?.error || resp?.message || JSON.stringify(resp)).slice(0, 300));
  ctx.onSubmitted?.(taskId);
  onProgress('排队中');

  const poll = Number(process.env.IC_PLUGIN_POLL_MS) || 5000;
  const deadline = Date.now() + timeoutSec * 1000 + 120_000;
  let quotaSince = 0;
  let miss = 0;
  let resubmitted = false;
  let last = '';
  const maxMod = Math.max(0, Math.min(50, Math.round(Number(params.moderation_retries ?? 10))));
  let modTries = 0;
  let pinnedAccount = '';
  while (Date.now() < deadline) {
    if (ctx.isAborted?.()) throw new Error('已取消（画布助手里的这条任务请手动停止）');
    await sleep(poll);
    let t;
    try {
      t = await call(params, 'GET', '/api/tasks/' + encodeURIComponent(taskId), null, 15_000);
    } catch (e) {
      if (e.status === 404) {
        // 画布助手重启可能丢掉刚提交的任务：连续 404 原样补投一次
        miss += 1;
        if (miss >= 2 && !resubmitted) {
          resubmitted = true;
          onProgress('任务在画布助手里丢失，自动补投');
          const r2 = await call(params, 'POST', '/api/generate', payload);
          if (r2?.task_id) { taskId = r2.task_id; miss = 0; ctx.onSubmitted?.(taskId); continue; }
        }
        if (miss >= 4 && resubmitted) throw new Error('画布助手里找不到这条任务（连续 404），请检查画布助手是否重启');
      }
      continue;
    }
    miss = 0;
    const status = String(t?.status || 'queued');
    const detail = String(t?.detail || t?.error || '');
    const acc = String(t?.account || '').trim();
    const pct = Number(t?.progress) || 0;
    const msg = status === 'queued' ? '排队中' : status === 'quota_exhausted' ? '额度用完，换账号续跑' : status === 'robot_verification' ? '遇到安全验证，请到画布助手窗口里完成' : (acc ? acc + ' ' : '') + (detail ? detail.slice(0, 60) : '生成中');
    if (msg !== last) { onProgress(msg, pct > 0 && pct < 100 ? pct : undefined); last = msg; }
    if (status === 'done') {
      const src = t?.result_path;
      if (!src || !fs.existsSync(src)) throw new Error('画布助手说已完成，但成片不在本机：' + (src || '没有给路径'));
      fs.mkdirSync(ctx.outDir, { recursive: true });
      const dst = path.join(ctx.outDir, 'doubao_' + taskId + (path.extname(src) || '.mp4'));
      fs.copyFileSync(src, dst);
      return { files: [dst], taskId };
    }
    if (status === 'compliance_rejection' || (status === 'error' && MODERATION_RE.test(detail))) {
      // 审核不通过：多数是平台对参考图 / 人物的随机审核，不是文案问题。
      // 同一账号、同一内容原样重新提交，次数在插件设置里（默认 10 次）。
      if (modTries < maxMod) {
        modTries += 1;
        if (acc) pinnedAccount = acc;
        onProgress('审核未通过，第 ' + modTries + '/' + maxMod + ' 次原样重新提交' + (pinnedAccount ? '（同一账号 ' + pinnedAccount + '）' : ''));
        await sleep(Math.min(15_000, (poll / 5000) * 3000 * modTries));
        const p2 = { ...payload, generation_round: (payload.generation_round || 0) + modTries * 1000 + (Date.now() % 997), force_new_window: true };
        if (pinnedAccount) p2.account = pinnedAccount;
        let r2 = await call(params, 'POST', '/api/generate', p2);
        if (!r2?.task_id && r2?.project_stopped) {
          await call(params, 'POST', '/api/tasks/resume', {});
          r2 = await call(params, 'POST', '/api/generate', p2);
        }
        if (!r2?.task_id) throw new Error('审核未通过后重新提交，画布助手没有接单：' + String(r2?.error || r2?.message || JSON.stringify(r2)).slice(0, 200));
        taskId = r2.task_id;
        ctx.onSubmitted?.(taskId);
        last = '';
        continue;
      }
      throw new Error('豆包审核未通过（已在同一账号原样重新提交 ' + maxMod + ' 次）：' + (detail || '平台内容审核').slice(0, 160)
        + '。这是平台对参考图 / 人物的审核，不是提示词文案问题：不要改写提示词，记下这段，继续后面的段落。');
    }
    if (status === 'error') throw new Error('豆包生成失败：' + (detail || '画布助手没有给出原因').slice(0, 300));
    if (status === 'cancelled') throw new Error('任务在画布助手里被取消' + (detail ? '：' + detail.slice(0, 120) : ''));
    if (status === 'quota_exhausted') {
      // 不是终态：画布助手会换同组另一个账号续跑
      if (!quotaSince) quotaSince = Date.now();
      if (Date.now() - quotaSince > 10 * 60_000) throw new Error('所有账号额度都用完了（换账号续跑等待超过 10 分钟）');
    } else quotaSince = 0;
  }
  throw new Error('豆包生成超时（' + Math.round(timeoutSec / 60) + ' 分钟）');
}
