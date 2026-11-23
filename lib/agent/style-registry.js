// 白昼技能包（short-drama-visual-style-sheets）自带的画风：装了并启用这个技能时，从它的
// references/visual-styles-and-video-prefixes.md 读出每套画风的「视频前置词 + 角色 / 场景渲染词 + 道具前置词」，
// 注册进画风库。画风文本留在用户本地的技能包里，不进代码仓库。
import fs from 'node:fs';
import path from 'node:path';
import { registerStylePresets } from '../shared/index.js';
import { skillDir, disabledSkillNames } from './skill-engine.js';

const SKILL = 'short-drama-visual-style-sheets';
const FILE = 'references/visual-styles-and-video-prefixes.md';
let cache = { mtime: 0, list: [] };

const KIND = { 'korean-3d': '3D', 'realistic-3d': '3D' };
const SLUG = { 半写实3DCG: 'korean-3d', 写实CG3D: 'realistic-3d', 现实主义真人电影: 'live-action', 日系青夏质感: 'jp-summer', 韩系都市甜腻: 'kr-urban-sweet', 东方怪诞美学: 'oriental-grotesque', 市井乡土写实: 'rustic-realism', '韩系2.5D': 'korean-25d' };
const PREVIEW = {
  'korean-3d': '半写实 3D 国漫女主，暖金侧光的古风庭院',
  'realistic-3d': '写实 CG 3D 男主，戏剧光影的城市夜景',
  'live-action': '真人女主坐在小镇面馆里，钨丝暖光',
  'jp-summer': '真人女主站在夏日草木间，自然光',
  'kr-urban-sweet': '真人男女主在大学校园里，暖金柔光',
  'oriental-grotesque': '真人女主站在幽暗的东方古宅门前',
  'rustic-realism': '真人中年女人站在乡村院子里，自然光',
  'korean-25d': '韩系 2.5D 精致女主，柔和的室内光',
};

function codeBlockAfter(text, from) {
  const a = text.indexOf('```', from);
  if (a < 0) return '';
  const b = text.indexOf('\n', a);
  const c = text.indexOf('```', b + 1);
  return c > b ? text.slice(b + 1, c).trim() : '';
}

/** 解析画风文档 → 预设列表 */
export function parseBundleStyles(md) {
  const text = String(md || '');
  const rows = [];
  for (const line of text.split('\n')) {
    const m = /^\|\s*`([^`]+)`\s*\|\s*\*\*([^*]+)\*\*\s*\|\s*([^|]*)\|.*\|\s*([^|]*)\|\s*$/.exec(line);
    if (m && m[1] !== 'none') rows.push({ bid: m[1].trim(), name: m[2].trim(), fit: m[3].trim().replace(/^—$/, ''), prop: m[4].trim() });
  }
  const sec2 = text.indexOf('## 二、');
  const sec3 = text.indexOf('## 三、');
  const sec4 = text.indexOf('## 四、');
  const out = [];
  for (const r of rows) {
    const head = '（`' + r.bid + '`）';
    const v = text.indexOf(head, sec2);
    const nextHead = v >= 0 ? text.indexOf('\n###', v + head.length) : -1;
    const same = v >= 0 ? /与「\*\*([^*]+)\*\*」完全一致/.exec(text.slice(v, nextHead > v ? nextHead : v + 200)) : null;
    const video = v >= 0 && v < sec3 && !same ? codeBlockAfter(text, v) : '';
    const c = text.indexOf(head, sec3);
    const seg = c >= 0 ? text.slice(c, sec4 > c ? sec4 : undefined) : '';
    const ci = seg.indexOf('角色风格渲染词');
    const si = seg.indexOf('场景风格渲染词');
    const slug = SLUG[r.name] || r.bid.replace(/^style-/, '').slice(0, 12);
    const kind = KIND[r.bid] || (/2\.5D/i.test(r.name) ? '2.5D' : '真人');
    out.push({
      id: 'bz-' + slug,
      bundleId: r.bid,
      name: r.name,
      kind,
      family: kind === '真人' ? 'realistic' : '3d',
      fit: r.fit || (kind === '真人' ? '适配真人' : '适配 3D'),
      video,
      sameAs: same ? same[1] : '',
      character: ci >= 0 ? codeBlockAfter(seg, ci) : '',
      scene: si >= 0 ? codeBlockAfter(seg, si) : '',
      prop: r.prop,
      preview: PREVIEW[slug] || '',
      source: 'skill',
      group: '白昼',
    });
  }
  for (const p of out) if (!p.video && p.sameAs) p.video = out.find((x) => x.name === p.sameAs)?.video || '';
  return out.filter((p) => p.video || p.character);
}

/** 装了并启用白昼画风技能时，把它的画风注册进画风库（按文件修改时间缓存） */
export function ensureSkillStyles() {
  try {
    if (disabledSkillNames().has(SKILL)) return [];
    const dir = skillDir(SKILL);
    const f = dir ? path.join(dir, FILE) : '';
    if (!f || !fs.existsSync(f)) return [];
    const mt = fs.statSync(f).mtimeMs;
    if (mt !== cache.mtime) cache = { mtime: mt, list: parseBundleStyles(fs.readFileSync(f, 'utf8')) };
    registerStylePresets(cache.list);
    return cache.list;
  } catch {
    return [];
  }
}
