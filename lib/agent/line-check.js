// 台词照原文核对：分镜里每句角色台词 / 内心独白，必须是原文（小说正文或剧本）里的话——
// 可以删字（删语气词、删半句），不能改字、换说法、调换语序。实测模型会把
// 「你上个月给我送过一瓶洗发露」改成「上个月我给你送过一瓶洗发露」，意思整个反了。
import { t2s } from '../shared/t2s.js';

const STRIP = /[^\p{L}\p{N}]/gu;
export function normText(s) {
  return t2s(String(s || '')).replace(STRIP, '').toLowerCase();
}

/** line 是否是 src 里某一小段的「删字版」：按顺序逐字出现在原文的一个窗口里（窗口不超过台词长度的 1.8 倍 + 12 字） */
export function inSource(line, src) {
  const L = normText(line);
  if (L.length < 4) return true;
  if (src.includes(L)) return true;
  const span = Math.ceil(L.length * 1.8) + 12;
  let from = src.indexOf(L[0]);
  while (from >= 0) {
    let j = from;
    let k = 0;
    const end = Math.min(src.length, from + span);
    while (j < end && k < L.length) { if (src[j] === L[k]) k++; j++; }
    if (k === L.length) return true;
    from = src.indexOf(L[0], from + 1);
  }
  return false;
}

/** 原文里和这句最像的一句（给模型看原话） */
export function closestSentence(line, rawSource) {
  const L = new Set(normText(line));
  let best = '';
  let score = 0;
  for (const sen of t2s(String(rawSource || '')).split(/[\n。！？!?]/)) {
    const s = sen.trim();
    if (!s) continue;
    let hit = 0;
    for (const ch of new Set(normText(s))) if (L.has(ch)) hit++;
    const sc = hit / Math.max(L.size, 1);
    if (sc > score) { score = sc; best = s; }
  }
  return score >= 0.5 ? best.slice(0, 120) : '';
}

const SKIP_SPEAKER = /^(旁白|解说|字幕|系统|画外音|广播)/;
/**
 * 逐行核对：lines 是「人物（情绪）：台词」多行文本；返回不在原文里的行。
 * 旁白、系统音这类允许压缩改写，不核对；原文为空时不核对。
 */
export function lineMismatches(linesText, rawSource) {
  const src = normText(rawSource);
  if (src.length < 50) return [];
  const bad = [];
  for (const raw of String(linesText || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^([^：:]{1,24})[：:](.*)$/.exec(line);
    const speaker = m ? m[1].trim() : '';
    const text = m ? m[2] : line;
    if (SKIP_SPEAKER.test(speaker)) continue;
    if (!inSource(text, src)) bad.push({ line, original: closestSentence(text, rawSource) });
  }
  return bad;
}
