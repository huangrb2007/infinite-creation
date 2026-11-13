// 短剧制作 · 工作流类别
//
// 类别是「后台设置里一个下拉框」的粒度：每个类别选一个工作流，生产流水线按 kind 取用。
// kind 沿用原项目的任务类型（t2i/i2i/r2v/tts/tts_clone/music），新增 digital_human / motion。
// folders：云端 ComfyUI 工作流目录下的子文件夹名（任一命中即归入该类别，大小写不敏感）。
export const CATEGORIES = [
  { id: 'r2v', label: '视频', desc: '分镜出片（参考图/参考音生成带语音的视频）', output: 'video', folders: ['视频', 'video', 'r2v', 'i2v'] },
  { id: 't2i', label: '文生图', desc: '人物/场景/道具设定图', output: 'image', folders: ['文生图', '图片', 'image', 't2i'] },
  { id: 'i2i', label: '图生图', desc: '换装、年龄变体、按参考图派生素材', output: 'image', folders: ['图生图', '图片编辑', 'edit', 'i2i'] },
  { id: 'tts', label: '音色设计', desc: '按文字描述设计人物音色样本', output: 'audio', folders: ['音色设计', 'voice_design', 'tts'] },
  { id: 'tts_clone', label: '声音克隆', desc: '用一段参考音克隆音色', output: 'audio', folders: ['声音克隆', '音色克隆', 'voice_clone', 'clone'] },
  { id: 'music', label: '背景音乐', desc: '按剧情描述与歌词生成配乐', output: 'audio', folders: ['背景音乐', '音乐', 'music', 'bgm'] },
  { id: 'digital_human', label: '数字人', desc: '头像 + 语音驱动口型', output: 'video', folders: ['数字人', 'digital_human', 'avatar'] },
  { id: 'motion', label: '动作迁移', desc: '参考视频的动作迁移到人物', output: 'video', folders: ['动作迁移', 'motion', 'animate'] },
];

export const CATEGORY_MAP = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));
export const CATEGORY_IDS = CATEGORIES.map((c) => c.id);

// 文件夹名 → 类别 id；找不到返回 ''
export function categoryOfFolder(name) {
  const n = String(name || '').trim().toLowerCase();
  if (!n) return '';
  for (const c of CATEGORIES) {
    if (c.folders.some((f) => f.toLowerCase() === n)) return c.id;
  }
  return '';
}

// 号池目录没有 category 字段时，按名字关键词兜底归类（优先级从具体到宽泛）
const NAME_HINTS = [
  ['digital_human', /数字人|口播|对口型|lip.?sync|talking|infinitetalk|digital.?human/i],
  ['motion', /动作迁移|动作模仿|motion|animate|wan.?animate|迁移/i],
  ['tts_clone', /克隆|clone/i],
  ['tts', /音色|配音|tts|voice/i],
  ['music', /音乐|配乐|bgm|music|歌/i],
  ['i2i', /图生图|编辑|改图|换装|edit|i2i/i],
  ['t2i', /文生图|生图|出图|t2i|text.?to.?image/i],
  ['r2v', /视频|分镜|h3|video|r2v|i2v/i],
];

export function categoryOfName(name) {
  const s = String(name || '');
  for (const [id, re] of NAME_HINTS) if (re.test(s)) return id;
  return '';
}
