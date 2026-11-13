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
  '0715-scriptwriter': { zh: '大纲扩写为 70–90 集竖屏短剧完整剧本', stages: ['script'], mode: 'auto' },
  'short-drama-scriptwriting': { zh: '微短剧编剧方法：钩子、付费卡点、爽感节奏、分集剧本', stages: ['script'], mode: 'auto' },
  'novel-to-skitscreenplay': { zh: '长篇小说改编成漫剧/短剧剧本格式', stages: ['script'], mode: 'auto' },
  'script-master': { zh: '剧本创作总控（五层知识库，偏人工交互式打磨）', stages: ['script'], mode: 'interactive' },
  'story-pipeline-cn': { zh: '小说→剧本→分镜整条链路，输出可接下游的分镜 JSON', stages: ['script', 'storyboard'], mode: 'auto' },
  'hf-drama-storyboard-script': { zh: '按剧本拆短剧文字分镜（景别、调度、剪辑节奏）', stages: ['storyboard'], mode: 'auto' },
  'scene-blocking-consistency': { zh: '每个场景建站位表，保证跨镜人物左右方位不漂移', stages: ['storyboard', 'video_prompt'], mode: 'auto' },
  'novel-to-storyboard': { zh: '小说/剧本直接转分镜，附角色卡和场景卡', stages: ['storyboard'], mode: 'auto' },
  'script-to-storyboard': { zh: '剧本拆到单镜：景别、机位、台词、时长、提示词', stages: ['storyboard'], mode: 'auto' },
  'media-storyboard-design': { zh: '分镜表格与电影感运镜设计专家包', stages: ['storyboard'], mode: 'auto' },
  'video-cinematography': { zh: '运镜、景别、构图等电影拍摄手法', stages: ['storyboard', 'video_prompt'], mode: 'auto' },
  'h3-prompt-writing': { zh: 'MiniMax H3 视频提示词规范（参考图编号、时长、音画）', stages: ['video_prompt'], mode: 'auto' },
  'image-prompt-writing': { zh: '人物三视图、场景、道具的出图提示词', stages: ['character', 'prop', 'scene', 'costume', 'age'], mode: 'auto' },
  'era-consistency-optimizer': { zh: '检查道具/服饰/建筑与故事年代是否一致', stages: ['scene', 'prop', 'costume', 'storyboard'], mode: 'auto' },
  'prompt-bozo': { zh: '通用绘画/视频提示词参数化生成（含古风元素）', stages: ['character', 'scene', 'prop', 'video_prompt'], mode: 'auto' },
  'tts-voice-design': { zh: '为人物写 Qwen3-TTS 音色描述和试音台词', stages: ['voice'], mode: 'auto' },
  'ai-music-studio': { zh: '按剧情设定配乐风格、结构与人声', stages: ['music'], mode: 'auto' },
  'music-caption-rewriter': { zh: '把配乐描述改写成 MiniMax Music3 结构化 caption', stages: ['music'], mode: 'auto' },
  'novel-to-video': { zh: '本项目主技能：小说全自动改编成带语音的成片', stages: ['pipeline'], mode: 'auto' },
  'webnovel-writing': { zh: '按简介规划、起稿、续写中文网文', stages: ['novel'], mode: 'auto' },
  'multi-search-engine': { zh: '联网检索资料（年代、品牌、术语查证）', stages: ['script', 'scene', 'prop'], mode: 'auto' },

  'short-drama-director': { zh: '漫剧老李全流程总控（要求逐项问用户、按 Seedance 出稿）', stages: ['pipeline'], mode: 'interactive' },
  'sd-script-engine': { zh: '老李套装 · 国内剧剧本与小说改编', stages: ['script'], mode: 'suite' },
  'sd-storyboard-engine': { zh: '老李套装 · 文戏分镜（短剧机位体系）', stages: ['storyboard'], mode: 'suite' },
  'sd-asset-engine': { zh: '老李套装 · 角色/道具/场景三清单与出图提示词', stages: ['character', 'prop', 'scene'], mode: 'suite' },
  'sd-combat-engine': { zh: '老李套装 · 打戏分镜', stages: ['storyboard'], mode: 'suite' },
  'sd-xuanhuan-engine': { zh: '老李套装 · 玄幻仙侠打戏', stages: ['storyboard'], mode: 'suite' },
  'sd-real-engine': { zh: '老李套装 · 真人写实打斗', stages: ['storyboard'], mode: 'suite' },
  'sd-decision-engine': { zh: '老李套装 · 机位选型依据', stages: ['storyboard'], mode: 'suite' },
  'sd-feed-engine': { zh: '老李套装 · 投喂稿（Seedance 格式）', stages: ['video_prompt'], mode: 'suite' },
  'sd-qc-engine': { zh: '老李套装 · 跨镜/跨集连续性质检', stages: ['storyboard'], mode: 'suite' },
  'sd-jieshuo-engine': { zh: '老李套装 · 解说/叙事类视频', stages: ['script'], mode: 'suite' },
  'sd-overseas-engine': { zh: '老李套装 · 海外剧剧本', stages: ['script'], mode: 'suite' },
  'sd-recon-engine': { zh: '老李套装 · 对标爆款采风', stages: ['script'], mode: 'suite' },

  'ai-manga-planner': { zh: '漫剧 9 阶段前期策划（交互式）', stages: ['script'], mode: 'interactive' },
  'manju-director-agent': { zh: '漫剧导演智能体：小说→剧本→元素→分镜', stages: ['storyboard'], mode: 'auto' },
  'manga-drama-generator': { zh: '漫剧全套素材一键生成（含 Excel 表格）', stages: ['storyboard'], mode: 'auto' },
  'manga-full-stack': { zh: '漫剧全栈：分镜公式、角色一致性、运镜模板', stages: ['storyboard', 'video_prompt'], mode: 'auto' },
  'script-to-manga': { zh: '剧本转漫剧视频提示词（Kling/Sora/即梦向）', stages: ['video_prompt'], mode: 'auto' },
  'comic-drama-generator': { zh: '3D 精品漫剧分镜与提示词（Seedance 向）', stages: ['storyboard'], mode: 'auto' },
  'cinematic-ai-comic-director': { zh: '影视级漫剧导演 + 镜头库（WorkBuddy 向）', stages: ['storyboard'], mode: 'auto' },
  'micro-drama-creator': { zh: '短剧/漫剧综合创作助手（偏问答式）', stages: ['script'], mode: 'interactive' },
  'ai-video-script': { zh: '按主题写短视频脚本（营销向）', stages: [], mode: 'other' },

  'lemo-opuscar': { zh: '无限・秩影：代码渲染风格化短片（不走 ComfyUI）', stages: [], mode: 'other' },
  'brand-promo-video-generator': { zh: '品牌/产品宣传片', stages: [], mode: 'other' },
  'co-op-game-intro-generator': { zh: '双人游戏主菜单/开场动画', stages: [], mode: 'other' },
  'papercraft-stop-motion-explainer': { zh: '纸艺定格科普讲解视频', stages: [], mode: 'other' },
  'paper-collage-explainer-generator': { zh: '拼贴风科普讲解视频', stages: [], mode: 'other' },
  'minimalist-product-ad-generator': { zh: '极简产品广告片', stages: [], mode: 'other' },
  '3d-animation-short-generator': { zh: '3D 动画短片', stages: [], mode: 'other' },
  'handdrawn-live-video-generator': { zh: '手绘实景混合视频', stages: [], mode: 'other' },
  'music-video-subtitle-generator': { zh: '音乐 MV 与歌词字幕', stages: [], mode: 'other' },
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
