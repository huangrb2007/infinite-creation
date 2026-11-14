// 号池工作流目录 → 工作流规格。
// 号池的 capabilities 给出 mapping（业务字段 → 节点ID:字段名）和 schema（全部可填字段），
// 这里把它转成与本地规格同构的 spec：template 是「虚拟 API 工作流」（只有可填字段），
// 提交时 workflow-runner 再把它摊平成 parameters。
import { poolCapabilities } from './pool-client.js';
import { categoryOfName, CATEGORY_MAP } from './categories.js';
import { REQUIRED_ROLES } from './analyze.js';

const MAPPING_ROLES = {
  prompt: 'positive_prompt', negativePrompt: 'negative_prompt', negative_prompt: 'negative_prompt',
  seed: 'seed', width: 'width', height: 'height', aspectRatio: 'aspect_ratio', aspect_ratio: 'aspect_ratio',
  duration: 'seconds', seconds: 'seconds', resolution: 'resolution',
  text: 'text', voiceDescription: 'voice_description', voice_description: 'voice_description',
  caption: 'caption', lyrics: 'lyrics', maxDuration: 'max_duration',
};
const ASPECT_FULL = {
  '1:1': '1:1 (Square)', '3:4': '3:4 (Portrait Standard)', '4:3': '4:3 (Standard)',
  '9:16': '9:16 (Portrait Widescreen)', '16:9': '16:9 (Widescreen)', '21:9': '21:9 (Ultrawide)',
};

function split(key) {
  const i = String(key).lastIndexOf(':');
  return i > 0 ? { node: key.slice(0, i), field: key.slice(i + 1) } : null;
}

function mediaTypeOf(f) {
  const s = (String(f.fieldType || '') + ' ' + String(f.fieldName || '')).toLowerCase();
  if (/video/.test(s)) return 'video';
  if (/audio/.test(s)) return 'audio';
  if (/image/.test(s)) return 'image';
  return '';
}

export function poolWorkflowToSpec(w) {
  const template = {};
  const slots = { image: [], audio: [], video: [] };
  for (const f of w.schema || []) {
    const node = String(f.nodeId);
    template[node] = template[node] || { class_type: 'PoolField', inputs: {}, _meta: { title: node } };
    const mt = mediaTypeOf(f);
    if (mt) slots[mt].push({ node, field: f.fieldName });
    template[node].inputs[f.fieldName] = mt ? '' : (f.fieldValue ?? '');
  }
  const roles = {};
  for (const [k, v] of Object.entries(w.mapping || {})) {
    const role = MAPPING_ROLES[k];
    const nf = split(v);
    if (!role || !nf) continue;
    roles[role] = { ...nf };
    if (role === 'seconds' && /length$/i.test(nf.field)) roles[role].transform = 'frames24';
    if (role === 'aspect_ratio' && /\(/.test(String(template[nf.node]?.inputs?.[nf.field] ?? ''))) roles[role].map = ASPECT_FULL;
  }
  const byName = categoryOfName(w.name);
  let category = (w.category && CATEGORY_MAP[w.category]) ? w.category : byName;
  // 号池只分视频/图片，动作迁移、数字人也是「视频」，名字里写明了就以名字为准
  if (byName === 'motion' || byName === 'digital_human') category = byName;
  if (!category) category = w.kind === 'image' ? (slots.image.length ? 'i2i' : 't2i') : 'r2v';
  if (category === 'i2i' && slots.image[0]) roles.image = slots.image[0];
  if (category === 'tts_clone' && slots.audio[0]) roles.ref_audio = slots.audio[0];
  if (category === 'digital_human') { if (slots.image[0]) roles.avatar = slots.image[0]; if (slots.audio[0]) roles.speech = slots.audio[0]; }
  if (category === 'motion') { if (slots.image[0]) roles.character = slots.image[0]; if (slots.video[0]) roles.driving_video = slots.video[0]; }
  const issues = (REQUIRED_ROLES[category] || []).filter((r) => !roles[r]).map((r) => '号池映射里没有「' + r + '」');
  if (w.capabilities && w.capabilities.verified === false) issues.push('号池标记为未验证');
  return {
    key: 'pool:' + w.id,
    source: 'pool',
    backend: 'pool',
    id: 'pool:' + w.id,
    name: w.name,
    category,
    kind: category,
    template,
    roles,
    slots: Object.fromEntries(Object.entries(slots).filter(([, v]) => v.length)),
    outputs: ['*'],
    pool: { id: w.id, revision: w.revision || '', kind: w.kind || '' },
    issues,
    ready: issues.length === 0,
  };
}

// 号池的生图工作流多数是「参考图可选」（如 Qwen Image 2.1：不传图就是文生图，传图就是改图），
// 号池只给一个分类，这里补一份文生图条目（key 加 #t2i，不绑参考图，空图字段提交时会被跳过）。
export function withT2iVariant(spec) {
  if (spec.category !== 'i2i' || spec.pool?.kind !== 'image') return [spec];
  const roles = { ...spec.roles };
  delete roles.image;
  const issues = (REQUIRED_ROLES.t2i || []).filter((r) => !roles[r]).map((r) => '号池映射里没有「' + r + '」');
  return [spec, { ...spec, key: spec.key + '#t2i', category: 't2i', kind: 't2i', roles, issues, ready: issues.length === 0 }];
}

export async function fetchPoolCatalog(pool) {
  const cap = await poolCapabilities(pool);
  return {
    version: cap.catalog_version || '',
    limits: cap.limits || {},
    specs: (cap.workflows || []).map(poolWorkflowToSpec),
  };
}
