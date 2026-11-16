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
  // 短剧流水线（2026-11 起只保留用户指定的这一套：导演助理 + H3 提示词规范）
  'director-assistant': { zh: '导演助理：把剧本设计成 H3 分镜与提示词（视觉档位、表演、轴线与切点连续性、特效）', stages: ['storyboard', 'video_prompt', 'pipeline'], mode: 'auto' },
  'h3-prompt-writing': { zh: 'MiniMax H3 提示词格式（Ref2VA 六段式、参考标签、说话人与台词写法）', stages: ['video_prompt'], mode: 'auto' },
  'novel-adaptation': { zh: '小说忠实改编成短剧剧本：不编造、三种声音分行、旁白提炼', stages: ['script'], mode: 'auto' },
  'asset-extraction': { zh: '资产提取：人·物·场三清单；出镜的人都建角色，屏幕 / 光幕每种状态单独建道具并写清文字', stages: ['character', 'prop', 'scene'], mode: 'auto' },
  'image-prompt-writing': { zh: '资产出图提示词：人物设定图（左 1/3 面部特写 + 右 2/3 全身三视图）、无人场景、白底道具', stages: ['character', 'prop', 'scene', 'costume', 'age'], mode: 'auto' },
  'tts-voice-design': { zh: '为角色、旁白、系统音写音色描述（voice_desc），供应用生成音色样本', stages: ['voice'], mode: 'auto' },
  // 其它功能各自用的技能（不进短剧流水线）
  'webnovel-writing': { zh: '按简介规划、起稿、续写中文网文（无限・卷轴）', stages: ['novel'], mode: 'auto' },
  'music-caption-rewriter': { zh: '把配乐描述改写成 MiniMax Music3 结构化 caption', stages: ['music'], mode: 'auto' },
  'multi-search-engine': { zh: '联网检索资料（年代、品牌、术语查证）', stages: [], mode: 'other' },
  'lemo-opuscar': { zh: '无限・秩影：代码渲染风格化短片（不走 ComfyUI）', stages: [], mode: 'other' },
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
