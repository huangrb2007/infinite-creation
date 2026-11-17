// 技能目录的中文说明与适用环节（流水线编排面板 + Agent 提示词共用）。
//
// zh      一句话说清这个技能做什么（面板列表直接显示，鼠标悬停看完整 description）
// stages  适用的流水线环节（SKILL_PIPELINE_NODES 的 id）；面板里默认只列出适用于当前环节的技能
// mode    auto        可在全自动流水线里直接用
//         suite       「漫剧老李」套装子技能：方法可用，但规则里含 Seedance 投喂格式，最终提示词仍按 h3-prompt-writing 落地
//         interactive 需要用户逐步确认（会要求「停下来问用户」），全自动流水线里不推荐
//         other       与短剧流水线无关（广告片、游戏片头、科普等），默认收起
// 新装的技能不在表里时按 other 处理，仍可在「显示全部」里找到。
export const SKILL_META = {
  // —— AIFISHER「一键下沉剧」技能（用户本机安装，不随安装包分发）——
  'novel-to-script': { zh: '小说 / 网文转正规分场剧本：重新分配信息（动作、台词、内心声、闪切），不缩写', stages: ['script'], mode: 'auto' },
  'script-normalize': { zh: '现成剧本格式清洗：台词一字不改，只换成标准分场格式', stages: ['script'], mode: 'auto' },
  'minimax-drama-prompt': { zh: 'MiniMax H3 文戏：剧本分段（10–15 秒）、人物场景资产、逐段提示词（总流水线主技能）', stages: ['pipeline', 'storyboard', 'video_prompt'], mode: 'auto' },
  'closed-drama': { zh: '文戏指导：保留台词、锁定声线、倾听反应与呼吸感镜头、情绪表演库', stages: ['storyboard', 'video_prompt'], mode: 'auto' },
  'closed-fight-stable': { zh: '武戏指导 · 稳定版：一镜到底、21 拍、三起两落（打戏段落用）', stages: ['storyboard'], mode: 'auto' },
  'closed-fight-wild': { zh: '武戏指导 · 疯癫版：招神破佛、法相巨物、连招（玄幻打戏用）', stages: ['storyboard'], mode: 'auto' },
  'shared-assets': { zh: '统一绘图铁律：东亚面孔、哑光无油光、双眼对称、场景空镜', stages: ['character', 'scene', 'prop', 'costume', 'age'], mode: 'auto' },
  'studio-character-assets': { zh: '人物生图提示词（写实 / 真人画风）', stages: ['character', 'costume', 'age'], mode: 'auto' },
  'studio-scene-assets': { zh: '场景生图提示词：电影级材质与光影（写实 / 真人画风）', stages: ['scene'], mode: 'auto' },
  'gpt-3d-drama-assets': { zh: '3D 漫剧角色设定图与场景资产提示词（3D / 国漫画风）', stages: ['character', 'scene', 'costume', 'age'], mode: 'auto' },
  'studio-assets-3d': { zh: '仙宫 3D 漫剧专用场景与人物提示词引擎（仙侠 / 玄幻 3D）', stages: ['character', 'scene'], mode: 'auto' },
  'closed-mj-assets': { zh: 'Midjourney 资产提示词（只在出图模型是 MJ 时用）', stages: [], mode: 'other' },
  'minimax-fight-assets': { zh: '打斗武戏资产规划（对接 RunningHub 武戏应用）', stages: [], mode: 'other' },
  'drama-ip-scout': { zh: '番茄小说榜单整理与短剧改编潜力初筛（选题 · 热门 IP）', stages: [], mode: 'other' },
  // —— 应用自带（AIFISHER 技能没装时的后备）——
  'director-assistant': { zh: '导演助理：剧本设计成 H3 分镜与提示词（后备）', stages: ['storyboard', 'video_prompt', 'pipeline'], mode: 'auto' },
  'h3-prompt-writing': { zh: 'MiniMax H3 提示词格式（后备）', stages: ['video_prompt'], mode: 'auto' },
  'novel-adaptation': { zh: '小说忠实改编成短剧剧本（后备）', stages: ['script'], mode: 'auto' },
  'asset-extraction': { zh: '资产提取：出镜的人都建角色，屏幕 / 光幕 / 带字物件每种状态单独建道具', stages: ['character', 'prop', 'scene'], mode: 'auto' },
  'image-prompt-writing': { zh: '资产出图提示词（后备）', stages: ['character', 'prop', 'scene', 'costume', 'age'], mode: 'auto' },
  'tts-voice-design': { zh: '为角色、旁白、系统音写音色描述（voice_desc）', stages: ['voice'], mode: 'auto' },
  'webnovel-writing': { zh: '按简介规划、起稿、续写中文网文（无限・卷轴）', stages: ['novel'], mode: 'auto' },
  'music-caption-rewriter': { zh: '把配乐描述改写成 MiniMax Music3 结构化 caption', stages: ['music'], mode: 'auto' },
  'multi-search-engine': { zh: '联网检索资料', stages: [], mode: 'other' },
  'lemo-opuscar': { zh: '无限・秩影：代码渲染风格化短片', stages: [], mode: 'other' },
};

export const SKILL_MODE_LABEL = {
  auto: '可全自动',
  suite: '套装子技能',
  interactive: '需人工确认',
  other: '与短剧无关',
};

export function skillMeta(name) {
  return SKILL_META[name] || { zh: '', stages: [], mode: 'other' };
}
