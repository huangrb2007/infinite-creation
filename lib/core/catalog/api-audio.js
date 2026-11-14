// LLM 接口自带的语音模型作为「音色设计」来源（目前接 Qwen3-TTS：qwen3-tts-flash 等）。
// 中转站的音频接口是异步任务：POST {base}/audio/generations → GET {base}/audio/generations/{id}，
// prompt 是要朗读的文字，metadata.voice 是预置音色。
// Qwen3-TTS 不能「按文字描述造一个新音色」，这里按音色描述里的性别 / 年龄挑预置音色，
// 同一类里再按角色名分散，避免几个年轻女性角色都是同一个声音。
import { apiBase, authHeaders, sleep } from './api-image.js';

export const TTS_MODEL_RE = /qwen3-tts|qwen-tts/i;

export function apiAudioSpecs(cfg) {
  const models = (cfg?.llm?.models || []).filter((m) => m.kind === 'audio' && TTS_MODEL_RE.test(m.id));
  return models.map((m) => ({
    key: 'api:tts:' + m.id,
    id: 'api:' + m.id,
    source: 'api',
    backend: 'api-audio',
    name: m.id,
    model: m.id,
    category: 'tts',
    kind: 'tts',
    roles: {},
    issues: /instruct/i.test(m.id) ? ['这个站点的 instruct 版目前调用会失败，建议用 qwen3-tts-flash'] : [],
    ready: !/instruct/i.test(m.id),
    family: 'LLM 接口语音模型（按性别年龄选预置音色）',
  }));
}

// 预置音色（这些名字在 work-fisher 的 qwen3-tts-flash 上实测可用）
const VOICES = {
  child: ['Mochi'],
  female_young: ['Cherry', 'Chelsie', 'Serena'],
  female_mature: ['Serena', 'Cherry'],
  male_young: ['Ethan', 'Kai'],
  male_mature: ['Elias', 'Kai', 'Ethan'],
  male_old: ['Eldric Sage', 'Arthur'],
  female_old: ['Serena'],
};

function hash(s) {
  let h = 0;
  for (const ch of String(s)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return h;
}

export function pickPresetVoice(desc, salt = '') {
  const d = String(desc || '');
  const female = /女|妇|姑娘|少女|姐|妈|婆|female|woman|girl/i.test(d);
  const male = /男|爷|叔|哥|爸|伯|少年|male|man|boy/i.test(d) && !/女/.test(d);
  let group;
  if (/童|孩|儿童|小孩|child|kid/i.test(d)) group = 'child';
  else if (/老|年迈|苍老|old|elder/i.test(d)) group = female ? 'female_old' : 'male_old';
  else if (/中年|成熟|沉稳|大叔|阿姨|middle|mature/i.test(d)) group = female ? 'female_mature' : 'male_mature';
  else group = female ? 'female_young' : male ? 'male_young' : 'female_young';
  const list = VOICES[group];
  return list[hash(salt || d) % list.length];
}

export async function runApiAudio(cfg, spec, params, { timeoutMs, isAborted } = {}) {
  if (!cfg.llm?.baseUrl) throw new Error('选了 LLM 接口的语音模型，但没有配置 LLM Base URL');
  const text = String(params.text || '').trim();
  if (!text) throw new Error('缺少朗读文字');
  const voice = params.voice || pickPresetVoice(params.voice_description, params.voice_salt || params.voice_description);
  const metadata = { voice };
  if (/instruct/i.test(spec.model) && params.voice_description) metadata.instructions = String(params.voice_description);
  const limit = Number(timeoutMs) > 0 ? Number(timeoutMs) : 30 * 60_000;
  const t0 = Date.now();
  const res = await fetch(apiBase(cfg) + '/audio/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(cfg) },
    body: JSON.stringify({ model: spec.model, prompt: text, metadata }),
    signal: AbortSignal.timeout(60_000),
  });
  const body = await res.text();
  let j;
  try { j = JSON.parse(body); } catch { throw new Error('语音接口返回的不是 JSON：' + body.slice(0, 200)); }
  if (!res.ok) throw new Error('语音接口报错 ' + res.status + '：' + (j?.error?.message || j?.message || body.slice(0, 300)));
  const id = j?.task_id || j?.id;
  if (!id) throw new Error('语音接口没有返回任务号：' + body.slice(0, 200));
  for (;;) {
    await sleep(3000);
    if (isAborted?.()) throw new Error('已停止');
    if (Date.now() - t0 > limit) throw new Error('语音生成超时');
    let q;
    try {
      const r = await fetch(apiBase(cfg) + '/audio/generations/' + encodeURIComponent(id), { headers: authHeaders(cfg), signal: AbortSignal.timeout(30_000) });
      q = await r.json();
    } catch { continue; }
    const d = q?.data && !Array.isArray(q.data) ? q.data : q;
    const st = String(d?.status || '').toUpperCase();
    if (st === 'SUCCESS' || st === 'SUCCEEDED') {
      const url = d.result_url || d?.data?.content?.audio_url || (d?.data?.content?.audio_urls || [])[0];
      if (!url || !/^https?:/.test(url)) throw new Error('语音任务成功但没有返回音频地址');
      const ext = /\.(wav|mp3|ogg|flac|m4a)(?:[?#]|$)/i.exec(url)?.[1] || 'wav';
      return { prompt_id: id, voice, outputs: [{ kind: 'audio', filename: 'api_' + Date.now() + '.' + ext.toLowerCase(), apiData: null, apiUrl: url }] };
    }
    if (st === 'FAILURE' || st === 'FAILED') throw new Error('语音生成失败：' + (d?.fail_reason || '未知原因'));
  }
}
