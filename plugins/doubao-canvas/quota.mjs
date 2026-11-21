// 豆包每日免费额度统计（本软件自己记账，不改画布助手）。
//
// 口径（默认按用户实测，插件设置里可改）：
//   每个号每天一份共用的免费额度：只用 mini 能出 quota_mini 次（默认 5），只用 fast 能出 quota_fast 次（默认 2），
//   混着用按比例扣：mini 一次 = 1/5 份，fast 一次 = 1/2 份。例：用了 1 次 fast → 还剩 mini 2 次或 fast 1 次。
//   其它模型（如 Seedance 2.5）按 fast 算（宁可少估）。
//   只数成功出片；豆包报「额度用完」的号当天直接记 0。北京时间每天 0 点清零。
//
// 数据来源：
//   1) 本软件经插件出的片（generate 成功 / 额度用完时记账，最准）；
//   2) 画布助手的任务列表 /api/tasks（含字字动画、手动提交的；只返回最近 100 条，按任务号去重合并）；
//   3) 画布助手账号状态 /api/accounts（强制冷却 / 冷却中）。
// 校正：额度用完那一刻记下当天实际用了几次 mini / fast，和设置不符时在额度表里提示。

import fs from 'node:fs';
import path from 'node:path';

const KEEP_DAYS = 14;

export function bjDay(ts = Date.now()) {
  return new Date(ts + 8 * 3600_000).toISOString().slice(0, 10);
}
/** 北京时间当天 0 点的时间戳（毫秒） */
export function bjDayStart(ts = Date.now()) {
  return Date.parse(bjDay(ts) + 'T00:00:00+08:00');
}

export function modelKind(model) {
  const m = String(model || '').toLowerCase();
  if (/mini/.test(m)) return 'mini';
  return 'fast';
}

export function caps(params = {}) {
  const n = (v, d) => { const x = Math.round(Number(v)); return x >= 1 && x <= 100 ? x : d; };
  return { mini: n(params.quota_mini, 5), fast: n(params.quota_fast, 2) };
}

/** 已用 → 剩余（按共用额度折算） */
export function remainingOf(used, cap, exhausted = false) {
  if (exhausted) return { mini: 0, fast: 0, share: 0 };
  const share = Math.max(0, 1 - (used.mini || 0) / cap.mini - (used.fast || 0) / cap.fast);
  const eps = 1e-9;
  return { mini: Math.floor(share * cap.mini + eps), fast: Math.floor(share * cap.fast + eps), share };
}

function ledgerPath(dataDir) {
  return path.join(dataDir || '.', 'doubao-quota.json');
}
export function loadLedger(dataDir) {
  try {
    const j = JSON.parse(fs.readFileSync(ledgerPath(dataDir), 'utf8'));
    if (j && typeof j === 'object' && j.days) return j;
  } catch {}
  return { days: {} };
}
export function saveLedger(dataDir, led) {
  const days = Object.keys(led.days).sort();
  for (const d of days.slice(0, Math.max(0, days.length - KEEP_DAYS))) delete led.days[d];
  try {
    fs.mkdirSync(path.dirname(ledgerPath(dataDir)), { recursive: true });
    const tmp = ledgerPath(dataDir) + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(led, null, 1));
    fs.renameSync(tmp, ledgerPath(dataDir));
  } catch {}
}
function accOf(led, day, account) {
  const d = (led.days[day] = led.days[day] || { accounts: {} });
  return (d.accounts[account] = d.accounts[account] || { tasks: {}, exhausted: false });
}
function usedOf(acc) {
  const u = { mini: 0, fast: 0 };
  for (const k of Object.values(acc?.tasks || {})) u[k === 'mini' ? 'mini' : 'fast'] += 1;
  return u;
}

/** 记一条成功出片 */
export function recordDone(dataDir, { account, taskId, model, ts = Date.now() }) {
  account = String(account || '').trim();
  if (!account || !taskId) return;
  const led = loadLedger(dataDir);
  accOf(led, bjDay(ts), account).tasks[String(taskId)] = modelKind(model);
  saveLedger(dataDir, led);
}
/** 记「额度用完」：当天剩余清零，并记下用完时的实际用量（用于校正） */
export function recordExhausted(dataDir, { account, ts = Date.now() }) {
  account = String(account || '').trim();
  if (!account) return;
  const led = loadLedger(dataDir);
  const a = accOf(led, bjDay(ts), account);
  if (!a.exhausted) { a.exhausted = true; a.usedAtExhaust = usedOf(a); }
  saveLedger(dataDir, led);
}

const QUOTA_ERR = /额度|quota/i;

/**
 * 合并画布助手的任务列表 / 账号状态，返回每个号的今日额度。
 * tasks: /api/tasks 的 tasks 数组；accounts: /api/accounts 的 data 数组
 */
export function buildQuota({ dataDir, params = {}, tasks = [], accounts = [], now = Date.now() }) {
  const cap = caps(params);
  const day = bjDay(now);
  const start = bjDayStart(now);
  const led = loadLedger(dataDir);
  let changed = false;
  for (const t of tasks || []) {
    const ts = (Number(t?.created) || 0) * 1000;
    if (ts < start || !t?.account || !t?.id) continue;
    const a = accOf(led, day, String(t.account));
    if (t.status === 'done' && !a.tasks[t.id]) { a.tasks[t.id] = modelKind(t.model); changed = true; }
    if (t.status === 'quota_exhausted' && !a.exhausted) { a.exhausted = true; a.usedAtExhaust = usedOf(a); changed = true; }
  }
  for (const acc of accounts || []) {
    const name = String(acc?.name || acc?.id || '');
    if (!name) continue;
    const cooled = acc.forced_cooldown || Number(acc.cooldown_remaining) > 0;
    if (cooled && QUOTA_ERR.test(String(acc.last_error || ''))) {
      const a = accOf(led, day, name);
      if (!a.exhausted) { a.exhausted = true; a.usedAtExhaust = usedOf(a); changed = true; }
    }
  }
  if (changed) saveLedger(dataDir, led);

  const today = led.days[day]?.accounts || {};
  const names = [...new Set([...(accounts || []).map((a) => String(a?.name || a?.id || '')).filter(Boolean), ...Object.keys(today)])];
  const info = new Map((accounts || []).map((a) => [String(a?.name || a?.id || ''), a]));
  const rows = names.map((name) => {
    const a = today[name] || { tasks: {}, exhausted: false };
    const ai = info.get(name) || {};
    const used = usedOf(a);
    const rem = remainingOf(used, cap, a.exhausted);
    const cooled = ai.forced_cooldown || Number(ai.cooldown_remaining) > 0;
    let state = '可用';
    if (a.exhausted) state = '今日用完';
    else if (cooled) state = '冷却中' + (ai.last_error ? '（' + String(ai.last_error).slice(0, 24) + '）' : '');
    else if (info.size && !ai.logged_in) state = '未登录';
    else if (ai.schedule_enabled === false) state = '不参与调度';
    const usable = state === '可用';
    return {
      account: name, group: ai.group || '', used, remaining: usable ? rem : { mini: 0, fast: 0, share: 0 },
      state, usable, busy: !!ai.busy, logged_in: !!ai.logged_in, schedule_enabled: ai.schedule_enabled !== false,
    };
  });
  const total = rows.reduce((s, r) => ({ mini: s.mini + r.remaining.mini, fast: s.fast + r.remaining.fast }), { mini: 0, fast: 0 });
  return { day, cap, rows, total, hint: calibrationHint(led, cap) };
}

/** 近几天「用完时实际用了多少」和设置不符 → 给出建议 */
export function calibrationHint(led, cap) {
  const obs = [];
  for (const d of Object.values(led.days || {})) {
    for (const a of Object.values(d.accounts || {})) if (a.exhausted && a.usedAtExhaust) obs.push(a.usedAtExhaust);
  }
  if (obs.length < 2) return '';
  const pureFast = obs.filter((u) => u.mini === 0 && u.fast > 0).map((u) => u.fast);
  const pureMini = obs.filter((u) => u.fast === 0 && u.mini > 0).map((u) => u.mini);
  const tips = [];
  const mode = (arr) => { const c = new Map(); for (const x of arr) c.set(x, (c.get(x) || 0) + 1); return [...c.entries()].sort((a, b) => b[1] - a[1])[0]; };
  if (pureFast.length >= 2) { const [v, n] = mode(pureFast); if (v !== cap.fast && n >= 2) tips.push('实测只用 fast 时 ' + n + ' 个号都在第 ' + v + ' 次后用完（设置是 ' + cap.fast + ' 次），建议把「fast 每日次数」改成 ' + v); }
  if (pureMini.length >= 2) { const [v, n] = mode(pureMini); if (v !== cap.mini && n >= 2) tips.push('实测只用 mini 时 ' + n + ' 个号都在第 ' + v + ' 次后用完（设置是 ' + cap.mini + ' 次），建议把「mini 每日次数」改成 ' + v); }
  const early = obs.filter((u) => u.mini / cap.mini + u.fast / cap.fast < 0.999).length;
  if (!tips.length && early >= 3 && early * 2 > obs.length) tips.push('有 ' + early + ' 次是没用到设置的次数就报额度用完，豆包可能改了额度规则（或审核失败也扣次数），留意一下');
  return tips.join('；');
}

/** 按额度派号：挑今天还能出这个模型、不忙、额度最多的号 */
export function pickAccount(q, model, { group = '', reserved = new Map() } = {}) {
  const kind = modelKind(model);
  const cand = q.rows
    .filter((r) => r.usable && (!group || r.group === group))
    .map((r) => {
      const res = reserved.get(r.account) || { mini: 0, fast: 0 };
      const used = { mini: r.used.mini + res.mini, fast: r.used.fast + res.fast };
      return { r, left: remainingOf(used, q.cap)[kind] };
    })
    .filter((x) => x.left > 0)
    .sort((a, b) => (a.r.busy - b.r.busy) || (b.left - a.left));
  return cand[0]?.r.account || '';
}
