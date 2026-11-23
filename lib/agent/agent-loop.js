import { LEAN_RULES, buildSkillAdapter } from './adaptation-rules.js';
import { styleDetail } from '../shared/index.js';
import { Chapters, ReferenceImages, buildNovelContextBlock, isValidNovelStep, videoEngineInfo } from '../core/index.js';
import { filterReferenceImages, SKILL_PIPELINE_NODES, skillMeta, assetRoute, ASSET_ROUTE_SKILLS, SEEDANCE_PACK_SKILLS, SEEDANCE_PACK_NODES } from '../shared/index.js';
import { loadSkill, listSkills } from './skill-engine.js';
import { ensureSkillStyles } from './style-registry.js';
import { targetChapterIdSet } from './tools.js';

export const REFERENCE_INSTRUCTION = `

【参考图片素材】用户本次上传了参考图片素材。请先用视觉能力逐张分析这些参考图的内容、画面风格、角色/场景/道具等元素，然后用 generate_asset_from_reference（图生图/i2i）以这些参考图为输入派生风格/设定一致的新素材（角色/场景/道具/服装等），而不是一律文生图。这些参考图仅作「生成新素材的参考」，不要把它们直接当成品素材使用，而是据此派生新素材。`;

// 构造用户任务提示词（内置 Agent 与外部 Agent 共用，保证续跑语义一致）
export function buildTaskPrompt(ctx) {
  let chapters = Chapters.list(ctx.projectId).map((c) => ({ id: c.id, title: c.title, novel: c.novel, hasScript: !!String(c.script || '').trim(), scriptChars: String(c.script || '').length }));
  const target = ctx.chapter || '';
  if (target) chapters = chapters.filter((c) => c.title === target || c.id === target);
  const seed = JSON.stringify({
    project: { name: ctx.project.name, style: ctx.project.style, idea: ctx.project.idea || '' },
    targetChapter: target || null,
    chapters,
    novel: chapters.map((c) => c.novel).join('\n\n').slice(0, 6000),
  });
  return (ctx.renderDisabled ? '开始执行：本批只做文本创作，不要调用任何渲染工具。\n' : '开始执行：请把下面的项目完成到成片导出。\n') + seed;
}

// 参考图的文本描述（外部 Agent 通过 view_project_references 查看图片，不内联图片块）
export function buildReferenceDescription(ctx) {
  const refs = filterReferenceImages(ReferenceImages.list(ctx.projectId, { mode: 'reference' }), targetChapterIdSet(ctx));
  const lines = [];
  let idx = 0;
  for (const r of refs) {
    idx += 1;
    const parts = ['参考图' + idx + '（reference_id=' + r.id + '）：' + (r.name || '未命名')];
    if (r.description) parts.push('用途/剧情定位：' + r.description);
    lines.push(parts.join('；'));
  }
  return { refs, descText: lines.join('\n') };
}

// 由 skillPipeline 配置生成「技能→任务映射」文案（替代原先硬编码在提示词里的映射）。
// nodes 缺项/坏值时回退到节点默认；fallback 非 false 时额外提示「可自动匹配其它技能」。
export function renderPipelineSkillMap(pipelineCfg) {
  const nodes = (pipelineCfg && pipelineCfg.nodes) || {};
  const lines = [];
  for (const meta of SKILL_PIPELINE_NODES) {
    // 「生成小说」是无限・卷轴专属环节，不属于视频流水线，不写进视频 Agent 的技能映射
    if (meta.id === 'novel') continue;
    const node = nodes[meta.id] || {};
    const skills = Array.isArray(node.skills) ? node.skills.map((s) => String(s).trim()).filter(Boolean) : [];
    // 没配技能的环节不写：由你按剧情直接完成（以前写「按技能目录自动匹配」会诱导模型乱加载无关技能）
    if (!skills.length) continue;
    lines.push(meta.label + '（' + meta.desc + '）→ ' + skills.map((s) => 'skill(' + s + ')' + (/^closed-fight-/.test(s) ? '（只在有打戏的段落加载）' : '')).join(' + '));
  }
  if (!lines.length) return '';
  return '技能→任务映射（没列出的环节不用技能，直接按剧情完成）：' + lines.join('；') + '。';
}

// 精简模式（默认）：不加载任何技能文档，只用内置规范；视频提示词由应用自动拼。
// 设置 → 流水线编排 里打开「使用技能文档」才走下面的技能模式。
function buildLeanSystemPrompt({ ctx, external }) {
  const parts = [];
  parts.push('你是「短剧制作」的自主制作 Agent，负责把小说 / 剧本全自动改编成带语音的短剧。全程自主决策，不向用户询问确认；操作幂等（已完成的跳过），便于断点续跑。');
  parts.push('工具边界：只用下面列出的领域工具（和按名字检索工具的 ToolSearch）。没有 shell / 文件读写 / 子代理；不要调用 skill / skill_reference（本模式不使用技能文档）。禁止删除项目、清空素材、批量删除分镜；路径参数只能是项目内相对路径。');
  if (external) parts.push('【外部 Agent 运行时】领域工具由本地 MCP 服务 ic 提供，工具名可能带 mcp__ic__ 等前缀，按同名工具调用。先调用 get_project 验证连通。');
  parts.push(LEAN_RULES);
  const engine = videoEngineInfo(ctx.cfg);
  if (engine?.promptStyle === 'seedance') {
    const fixed15 = engine.durations?.length === 1 && Number(engine.durations[0]) === 15;
    parts.push('【出片引擎：' + engine.name + '（Seedance 2.0）】' + (fixed15 ? '每镜 duration 一律 15 秒（豆包 5 / 10 / 15 秒都扣一次额度，每镜做满 15 秒）。下沉短剧要快：一镜 15 秒装 3–4 个来回、台词 + 旁白 45–65 字且至少 3 句，第一个时段就开口，边说边动，不写走进画面的开场和慢慢 / 停顿 / 愣住；内容不够就把下一场的台词接进来（scenes 写两个），不补空镜，超过 65 字再拆。' : '每镜 duration 只能是 ' + (engine.durations?.length ? engine.durations.join(' / ') : '5 / 10 / 15') + ' 秒（其它值会被改成最近的档位），按这个时长安排台词量（约 4 字 / 秒）。') + 'sub_shots 按时间轴一行一个时段，写成「0-3秒｜景别｜运镜：画面」，时段从 0 连续铺到本镜时长、每个 2–4 秒，一个时段一个主要动作、一个运镜。每镜参考图（人物 + 场景 + 道具）最多 ' + (engine.maxImages || 9) + ' 张。角色声音由 Seedance 按 voice_desc 生成，voice_desc 要写清性别、年龄段、音色和语速。出片报「审核不通过」时不要改写提示词：插件已在同一账号原样重新提交过，仍失败就如实报告、继续后面的镜。');
  }
  const c = ctx.project.context || {};
  if (c.bible) parts.push('【人物圣经（一致性锚点，必须遵守）】\n' + c.bible);
  if (c.style) parts.push('【风格指南】\n' + c.style);
  parts.push('项目参数：画风=' + (ctx.project.style || '未指定（按故事题材自行选定一种并写进风格指南）') + (styleDetail(ctx.project.style) ? '（' + styleDetail(ctx.project.style) + '）' : '') + '，视频分辨率=' + (ctx.project.video_resolution || '480P') + '，宽高比=' + (ctx.project.video_aspect_ratio || '16:9') + '。所有资产的出图提示词都要带上这个画风。');
  parts.push('【已有素材优先】list_assets 里已经存在的角色 / 场景 / 道具（包括用户上传的、从小说项目带过来的角色设定）直接沿用同名资产，补全 description / voice_desc / prompt 即可，不要为同一主体新建重复资产。换装、年龄变体只在剧情真的换了衣服 / 跨了年龄段时才需要，否则一律用角色原图。');
  parts.push('本次生成目标：' + (ctx.chapter ? ('章节「' + ctx.chapter + '」（只处理这一章）') : '全部章节'));
  const steps = [
    '1) get_project、get_chapter 读取本章 novel 与 script；list_assets 看已有资产。',
    '2) 剧本：script 已有且带旁白 / 内心OS → 直接用，不要重写；script 为空' + (ctx.project.auto_script !== false ? '' : '且项目关闭了自动生成剧本 → 用 report 说明并跳过本章；script 为空且允许自动生成') + ' → 按规范把 novel 改编成剧本，set_chapter_script 保存；已有剧本几乎没有旁白和内心OS、而 novel 有叙述和心理活动 → 这是旧版精简稿，按规范重写后 set_chapter_script(overwrite=true)。novel 和 script 都为空时用项目 idea 自行展开。',
    '3) save_context：bible 写人物表（每人：身份、长相、固定着装、固定声线）和场景表（每个场景里人物的左右站位）；style 写一段画风说明。',
    '4) 资产：create_asset / update_asset 建好并写全角色（含 voice_desc）、场景、关键道具的 description 和 prompt。',
    '5) set_storyboard 一次写完整章分镜（每镜：idx、scene_name、duration、characters、scenes、props、visual、sub_shots、lines）。被拒绝就按报错修改后重新提交。',
    (ctx.project.enable_bgm === false ? '' : '6) set_chapter_music：给本章写一段配乐描述 caption（风格、情绪、乐器、速度）和合适的 duration；纯音乐时 lyrics 留空。'),
  ].filter(Boolean);
  if (ctx.renderDisabled) {
    parts.push('【本阶段只做文本创作，不渲染】按顺序完成：\n' + steps.join('\n') + '\n全部写完后用 report 汇报「文本阶段完成」并结束。不要调用任何 generate_* / design_* / change_* / assemble_video 工具（本阶段已禁用），也不要逐镜调用 update_shot 写提示词。');
  } else {
    parts.push('按顺序完成整条流水线：\n' + steps.join('\n') + '\n7) generate_assets_batch 生成全部资产图和角色音色。\n8) generate_chapter_videos(本章) 生成全部镜头，直到 remaining=0；失败的镜头会返回原因，重试仍失败就记录并继续，不要因此停下。\n' + (ctx.project.enable_bgm === false ? '' : '9) generate_music(本章) 生成配乐。\n') + '10) assemble_video(本章) 合成成片。每一步用 report 汇报进度。');
  }
  return parts.join('\n\n');
}

// 编排里的技能名可能是已删除的旧技能（老配置）：只保留装着的；一个都不剩就回退该环节默认。
// 出片引擎是 Seedance（豆包 / 即梦插件）时，分段与提示词改用 seedance-drama-prompt（H3 专用的提示词技能不再加载）
const H3_PROMPT_SKILLS = new Set(['minimax-drama-prompt', 'closed-drama', 'director-assistant', 'h3-prompt-writing']);
export function effectiveNodeSkills(pipelineCfg, installed, project = null, engine = null) {
  const have = new Set(installed);
  const nodes = (pipelineCfg && pipelineCfg.nodes) || {};
  // 资产环节按画风路由（与 AIFISHER 一键下沉剧一致，见 lib/shared assetRoute）
  const route = ASSET_ROUTE_SKILLS[assetRoute(project || {})];
  const routeOf = (id) => (id === 'character' || id === 'costume' || id === 'age' ? route.character : id === 'scene' ? route.scene : null);
  const ASSET_SKILLS = new Set(['shared-assets', 'studio-character-assets', 'studio-scene-assets', 'studio-assets-3d', 'gpt-3d-drama-assets']);
  const out = {};
  for (const meta of SKILL_PIPELINE_NODES) {
    const node = nodes[meta.id] || {};
    const raw = Array.isArray(node.skills) ? node.skills.map((x) => String(x).trim()).filter(Boolean) : null;
    let list = (raw || meta.defaultSkills).filter((x) => have.has(x));
    // 编排里指定的技能一个都没装（老配置 / AIFISHER 技能没装）→ 用该环节的默认，再不行用后备
    if (!list.length) list = meta.defaultSkills.filter((x) => have.has(x));
    if (!list.length) list = (meta.fallbackSkills || []).filter((x) => have.has(x));
    const r = routeOf(meta.id);
    // 只有编排里本来就用了画风资产技能（AIFISHER 那套）才按画风路由换；模板里写的别的技能不动
    if (r && list.some((x) => ASSET_SKILLS.has(x))) {
      // 资产技能只留画风路由里的那几个；路由里的技能装着就补上（用户编排里漏了也加）
      const routed = [...list.filter((x) => !ASSET_SKILLS.has(x)), ...r.filter((x) => have.has(x))];
      list = routed.length ? [...new Set(routed)] : list;
    }
    out[meta.id] = { skills: list, fallback: node.fallback !== false };
  }
  // 编排里写了什么就用什么（Seedance 爽剧技能包在「编排模板」里选）。
  // 只有编排里一个爽剧技能包的技能都没有、又选了 Seedance 出片时，沿用老逻辑：H3 提示词技能换成 seedance-drama-prompt
  // 分镜模式（项目设置）：白昼 Lite = 平稳日常 / 温情戏，把 storyboard-lite 排到雷霆导演前面当主技能；雷霆导演留作参考
  if (project?.storyboard_mode === 'lite') {
    for (const id of ['pipeline', 'storyboard', 'video_prompt']) {
      const l = out[id]?.skills || [];
      if (l.includes('short-drama-storyboard-lite') && l.includes('short-drama-thunder-director')) {
        out[id].skills = ['short-drama-storyboard-lite', ...l.filter((x) => x !== 'short-drama-storyboard-lite')];
      }
    }
  }
  const packConfigured = Object.values(out).some((n) => n.skills.some((x) => SEEDANCE_PACK_SKILLS.includes(x)));
  if (packConfigured) {
    // 不做额外改写
  } else if (engine?.promptStyle === 'seedance' && have.has('seedance-drama-prompt')) {
    for (const id of ['pipeline', 'storyboard', 'video_prompt']) {
      if (!out[id]) continue;
      out[id].skills = ['seedance-drama-prompt', ...out[id].skills.filter((x) => !H3_PROMPT_SKILLS.has(x) && x !== 'seedance-drama-prompt')];
    }
  }
  return { nodes: out };
}

// 技能模式（默认）：创作规则全部来自技能文档（导演助理 + h3-prompt-writing），应用只给接口约定。
export function buildSystemPrompt({ ctx, external }) {
  ensureSkillStyles();
  if (ctx.cfg?.skillPipeline?.useSkills === false) return buildLeanSystemPrompt({ ctx, external });
  const installed = listSkills().map((x) => x.name);
  const engine = videoEngineInfo(ctx.cfg);
  const pipeline = effectiveNodeSkills(ctx.cfg?.skillPipeline, installed, ctx.project, engine);
  const mainName = pipeline.nodes.pipeline.skills[0] || pipeline.nodes.storyboard.skills[0] || '';
  const main = mainName ? loadSkill(mainName) : null;
  const parts = [];
  parts.push('你是「短剧制作」的自主制作 Agent，负责把小说 / 剧本全自动做成带语音的短剧成片。全程自主决策，不向用户询问确认；遇到失败先重试、再降级、最后记录并继续；操作幂等（已完成的资产 / 分镜跳过），便于断点续跑。');
  parts.push('工具边界：只有下面列出的领域工具（以及按名字检索工具的 ToolSearch）；没有 shell / 文件读写 / 子代理。技能文档里的脚本、命令、读写文件步骤一律不执行，用领域工具完成或忽略。禁止删除项目、清空素材、批量删除分镜；路径参数只能是项目内相对路径。被「已拦截」的操作不要重试。');
  if (external) parts.push('【外部 Agent 运行时】领域工具由本地 MCP 服务 ic 提供，工具名可能带 mcp__ic__ 等前缀，按同名工具调用。先调用 get_project 验证连通。禁止使用你自身的 shell / 文件读写 / 联网 / 子代理工具。');
  if (main) parts.push('【主技能：' + main.name + '（全文如下，严格遵循；它引用的 references/xxx.md 用 skill_reference(name="' + main.name + '", ref="xxx.md") 加载）】\n' + main.body);
  const catalog = listSkills().filter((x) => x.name !== (main && main.name) && Object.entries(pipeline.nodes).some(([id, n]) => id !== 'novel' && n.skills.includes(x.name)));
  if (catalog.length) {
    parts.push('其它要用的技能（命中对应环节前先 skill(名字) 加载全文再遵循）：\n' + catalog.map((x) => '- ' + x.name + '：' + (skillMeta(x.name).zh || String(x.description || '').replace(/\s+/g, ' ').slice(0, 160))).join('\n'));
  }
  const map = renderPipelineSkillMap(pipeline);
  if (map) parts.push(map);
  const sd = styleDetail(ctx.project.style);
  parts.push(buildSkillAdapter({ style: ctx.project.style, styleDetailText: sd, webSearch: ctx.cfg?.search?.enabled !== false, aspect: ctx.project.video_aspect_ratio || '16:9', mainSkill: main ? mainName : '', flowSkill: effectiveNodeSkills(ctx.cfg?.skillPipeline, installed, ctx.project, null).nodes.pipeline?.skills?.[0] || '', route: assetRoute(ctx.project), characterStyle: ctx.project.character_style || 'standard', installed, engine, promptFormat: ctx.cfg?.skillPipeline?.promptFormat || '' }));
  const c = ctx.project.context || {};
  if (c.bible) parts.push('【人物圣经（一致性锚点）】\n' + c.bible);
  if (c.style) parts.push('【风格指南】\n' + c.style);
  if (c.continuity) parts.push('【连续性记录】\n' + c.continuity);
  parts.push('项目参数：画风=' + (ctx.project.style || '未指定（按故事题材自行选定并写进风格指南）') + (sd ? '（' + sd + '）' : '') + '，视频分辨率=' + (ctx.project.video_resolution || '480P') + '，宽高比=' + (ctx.project.video_aspect_ratio || '16:9') + '。资产出图提示词都带上这个画风。');
  parts.push('当前 LLM 支持看图：' + (ctx.cfg.llm?.vision ? '是。写提示词前用 view_asset 把每个用到的角色 / 场景 / 道具图各看一次并记住，后续镜头复用，不要反复查看。' : '否。只按资产的文字描述写提示词。'));
  parts.push('【素材使用】list_assets 里已有的角色 / 场景 / 道具（含用户上传、从小说项目带来的）直接沿用同名资产，补全 description / voice_desc / prompt，不新建重复资产。source=uploaded 且有图的是用户指定的视觉锚点，拆分镜时按名字绑定。换装（change_outfit / design_outfits）只在剧情真的换衣服时做，年龄变体（change_age / design_ages）只在剧情跨了年龄段时做，否则一律用角色原图；一段里同一角色只引用一张图。用户上传的参考图（mode=reference）用 generate_asset_from_reference 图生图派生新素材。category=voice/music/sfx 的音频资产可在分镜 audios 字段按名字引用。');
  parts.push('本次生成目标：' + (ctx.chapter ? ('章节「' + ctx.chapter + '」（只处理这一章，其它章节不要动）') : '全部章节'));
  parts.push('【剧本】get_chapter 读本章 novel 与 script。script 已有内容 → 它就是剧情蓝本，直接用，不要重写（除非用户本轮明确要求）。script 为空且项目「自动生成剧本」' + (ctx.project.auto_script !== false ? '开启 → 依据 novel（为空则用项目 idea）改编成剧本，set_chapter_script 保存' : '关闭 → 用 report 说明并跳过本章') + '。剧本格式：配置了「生成剧本」环节的技能就严格按技能的格式写（如 novel-to-script 的 `1-1、场景 时间 内/外`、`人物：`、`△动作`、`人物：台词`、`人物内心声：…`、`（闪切）`）；没有技能时用【第N场｜时间｜地点】+ 逐行声音（对白「人物名（情绪）：台词」、内心独白「人物名（内心OS）：……」、旁白「旁白：……」、非人物声音「系统（画外音）：……」）。两种格式应用都能解析配音。改编的取舍按「生成剧本」环节的技能来（没有配置技能时由你按剧情判断，但不要编造原文没有的情节）。');
  const steps = [
    '1) get_project、get_chapter、list_assets 读取项目。',
    '2) 剧本（见上）。',
    '3) save_context：bible 写人物表（身份、长相、固定着装、固定声线）和各场景的空间关系；style 写画风说明。',
    '4) 资产：create_asset / update_asset 写全角色（含 voice_desc）、场景、关键道具的 description 和出图 prompt。',
    '5) 按主技能的工作流设计本章分镜：set_storyboard 一次写完整章（被拒绝就按报错修改后重交）。',
    '6) 按「视频提示词」环节的技能为每一段写' + (engine?.promptStyle === 'seedance' ? ' Seedance 2.0 中文提示词' : ' H3 提示词') + '：list_shots 找 has_prompt=false 的段，逐段 update_shot(video_prompt)。',
    (ctx.project.enable_bgm === false ? '' : '7) set_chapter_music：给本章写配乐描述 caption（风格、情绪、乐器、速度）和 duration；纯音乐 lyrics 留空。'),
  ].filter(Boolean);
  if (ctx.renderDisabled) {
    parts.push('【本阶段只做文本创作，不渲染】按顺序完成：\n' + steps.join('\n') + '\n全部写完后用 report 汇报「文本阶段完成」并结束。generate_* / design_* / change_* / regenerate_shot / assemble_video 本阶段已禁用，不要调用。');
  } else {
    parts.push('按顺序完成整条流水线：\n' + steps.join('\n') + '\n8) generate_assets_batch 生成全部资产图和角色音色。\n9) generate_chapter_videos(本章) 生成全部段落，直到 remaining=0；失败的会返回原因，重试仍失败就记录并继续。\n' + (ctx.project.enable_bgm === false ? '' : '10) generate_music(本章) 生成配乐。\n') + '11) assemble_video(本章) 合成成片。每一步用 report 汇报进度。');
  }
  return parts.join('\n\n');
}

// ================= 「无限・秩影」lemo-opuscar 代码电影模式 =================
// 与上面 ComfyUI 全链路完全独立：本模式脱离 ComfyUI，用 node/ffmpeg/three.js/python 渲染成片。

export function buildOpuscarSystemPrompt({ ctx, external }) {
  const parts = [];
  parts.push('你是「无限・秩影」的自主创作导演，负责用 lemo-opuscar 技能把「所选风格 + 上传素材 + 用户提示词」用代码渲染做成成片视频（node / ffmpeg / three.js / python，脱离 ComfyUI）。');
  parts.push('铁律：全程自主决策，不要向用户询问中间确认；失败先读错误再重试、再降级、最后记录并继续；操作尽量幂等（已产出的文件跳过，便于断点续跑）。');
  parts.push('工具边界：你只有 opuscar_* 系列工具，外加 skill / skill_reference / get_project / list_assets / view_asset / report。禁止调用任何 ComfyUI 领域工具（本会话未注册，调用会被拒绝）；不要用 opuscar 工具去读写项目数据库或碰 ComfyUI。');
  parts.push('安全铁律：opuscar_shell 的 cwd 只能是 lib（库根，默认）或 film（影片工作区）；命令里的绝对路径必须落在 opuscar_init 返回的 lib_root / film_dir 之内；命令里禁止 ".." 路径段与 rm -rf / sudo / curl|sh 等危险命令（会被拦截）。opuscar_read_file / opuscar_write_file 的 path 只能写相对路径，禁止 ../ 与绝对路径。');
  parts.push('工作流（严格按序）：\n1) opuscar_init 获取 lib_root 与 film_dir；\n2) 首次使用时若库内缺少 node_modules 或 .venv，先 opuscar_shell(cwd=lib, command=sh plugin/skills/lemo-opuscar/scripts/setup.sh deps) 装核心依赖（需要语音加 deps voice、配乐加 deps music）；\n3) 读取风格规范：若任务消息给出的是「预设风格 slug」则用 opuscar_read_file 读库内 styles/<slug>/STYLE.md；若给出的是「自定义风格」描述（styleInfo.custom_style），则没有固定 STYLE.md，你要把该描述当作风格不变量自行设计页面（可参考 styles/README.md 选相近风格，或读任意一个 STYLE.md 学习页面契约与写法），其余流程相同；\n4) 在 film_dir 写 TREATMENT.md（三个候选结构 + 你的选择，先于 demo）；\n5) 写影片页面代码 index.html（遵循 core/README.md 的「页面契约」：window.READY=true、window.render(t) 确定性逐帧绘制、window.DUR、可选 window.EV / window.TEXTS(t)），以及依赖的 JS/CSS/资源，全部写在 film_dir，不要改库内 styles/ 与 core/；\n6) 渲染：先 opuscar_shell(cwd=lib, command=node core/render/still.mjs "$LEMO_FILM" 1.5 抽帧自查风格是否符合 STYLE.md（或自定义风格描述），再 node core/render/video.mjs "$LEMO_FILM" --out "$LEMO_FILM/out/video.mp4"）；\n7) 需要语音时 opuscar_write_file 写 lines.json，再 opuscar_shell 跑 core/tts/tts.py 或 tts_zh.py 生成 wav；\n8) 合成：opuscar_shell(cwd=lib, command=sh core/render/mux.sh "$LEMO_FILM/out/video.mp4" "$LEMO_FILM/mix.wav" "$LEMO_FILM/out/final.mp4")（无配乐可跳过 mux，直接交付 video.mp4）；\n9) opuscar_save_film 把成片落为项目视频资产。每一步用 report 汇报进度。');
  parts.push('素材语义：用户上传的素材可以是任意文件类型——图片/音频/视频/数据/扫描/CAD/字体/文档等，都已复制到影片工作区 film_dir/materials/ 下（相对路径见任务消息）。你必须逐一审视这些素材：先用 opuscar_read_file 读可读的文本/数据/JSON/字幕等；图片/视频/音频可被页面代码按相对路径引用（如 "materials/xxx.png"）；「剪辑与纪实 / Evidence Films」类风格（字幕新闻、新闻影片、视觉调查、卫星简报、产品拆解、档案灯台等）把上传素材当真实素材来源组织材料；其余风格把上传素材当参考/风格锚点（角色、场景、配色、构图）。用户提示词是主题与方向。所选风格 slug、用户提示词、素材清单见任务消息。');
  if (external) parts.push('【外部 Agent 运行时】你的领域工具由本地 MCP 服务 ic 提供，工具名可能带 mcp__ic__ / ic__ 等前缀，按同名工具调用即可；开始前先 opuscar_init 验证连通。禁止使用你自身的 shell / 文件读写 / 联网 / 子代理工具。');
  return parts.join('\n\n');
}

export function buildOpuscarTaskPrompt({ ctx, styleSlug, styleInfo, prompt, materials, history, continueMessage }) {
  const lines = [];
  const isContinuation = !!String(continueMessage || '').trim();
  if (isContinuation) {
    lines.push('这是在同一条影片记录上继续修改：此前已有一版成片，影片工作区 film_dir 里保留了上一版的 TREATMENT.md、index.html 与素材。');
  } else {
    lines.push('请用 lemo-opuscar 的代码渲染制作一支成片视频。');
  }
  if (styleInfo && styleInfo.custom_style) {
    lines.push('所选风格：自定义风格（无预设 STYLE.md）。\n自定义风格描述：' + styleInfo.custom_style);
    lines.push('请把上面的「自定义风格描述」当作本片的风格不变量（画风/配色/动效/镜头语法/声音调性等）自行实现，不要套用任何预设风格。');
  } else {
    const styleLabel = styleInfo ? (styleInfo.cn || styleInfo.en || '') : String(styleSlug || '');
    lines.push('所选风格：' + styleLabel + '（slug=' + styleSlug + '）' + (styleInfo && styleInfo.cat ? '，类别：' + styleInfo.cat : '') + (styleInfo && styleInfo.line_cn ? '；简介：' + styleInfo.line_cn : ''));
  }
  lines.push('用户提示词：' + (String(prompt || '').trim() || '（无）'));
  if (Array.isArray(materials) && materials.length) {
    const ms = materials.map((m, i) => (i + 1) + '. [' + (m.type || 'file') + '] ' + (m.name || m.filename || '') + '（相对路径：' + (m.filename || '') + '）');
    lines.push('已上传素材清单（均在 film_dir/materials/ 下，可读文本用 opuscar_read_file，图片/视频/音频可在页面代码里按相对路径引用）：\n' + ms.join('\n'));
  } else {
    lines.push('已上传素材清单：（无）');
  }
  if (isContinuation) {
    if (Array.isArray(history) && history.length) {
      const hs = history.filter((m) => m && String(m.text || '').trim()).map((m, i) => (i + 1) + '. ' + String(m.text).trim());
      lines.push('此前的修改对话：\n' + hs.join('\n'));
    }
    lines.push('本轮修改要求：' + String(continueMessage).trim());
    lines.push('执行要求：先用 opuscar_read_file 读取 film_dir 里现有的 TREATMENT.md、index.html 及相关代码/素材，理解上一版的实现；只改本轮要求涉及的部分，保留其余内容与风格不变；改完重新渲染并合成，最后 opuscar_save_film 覆盖保存到同一条记录。除非本轮要求涉及画幅或时长，否则保持原有 DUR 与画面比例。');
    return lines.join('\n\n');
  }
  lines.push('请按系统提示词的工作流执行：先读所选风格 STYLE.md，再写 TREATMENT 与页面代码，渲染、合成、opuscar_save_film 落地。');
  return lines.join('\n\n');
}

// ================= 「无限・卷轴」网文大纲规划模式 =================
// 与 opuscar / ComfyUI 全链路完全独立：本模式不做视频，只做小说结构（总纲/卷纲/章纲）+ 角色 + 记忆。

export function buildNovelSystemPrompt({ ctx }) {
  const parts = [];
  // 主技能来自「流水线编排 → 生成小说」环节，第一个为主技能，其余为备用
  const node = (ctx.cfg?.skillPipeline?.nodes || {}).novel || {};
  const skills = (Array.isArray(node.skills) ? node.skills : []).map((s) => String(s).trim()).filter(Boolean);
  const primarySkill = skills[0] || 'webnovel-writing';
  const fallback = node.fallback !== false;
  parts.push('你是「无限・卷轴」的网文大纲规划师兼章节写手，负责两件事：1) 按 ' + primarySkill + ' 技能的方法体系生成**结构大纲**（总纲 / 卷纲 / 章纲）与角色设定；2) 按章纲**逐章写出小说正文**。');
  parts.push('第一原则：开始任何生成之前，**先调用一次 skill("' + primarySkill + '")** 加载这套写作技能的完整方法——它通常包含 concept_planning / volume_outline / dialogue / transition / chapter_ending / anti_ai_voice / consistency_review 等模块说明，必须先读一遍再开始；遇到模块名但不清楚怎么做时，用 skill_reference(name="' + primarySkill + '", ref="references/modules/<模块名>/README.md") 按需读取。');
  if (skills.length > 1) {
    parts.push('「生成小说」环节还配置了备用技能（按顺序）：' + skills.slice(1).map((s) => 'skill(' + s + ')').join('、') + (fallback ? '——' + primarySkill + ' 读不到或不适用时依次改用它们。' : '——仅在 ' + primarySkill + ' 读不到时使用。'));
  } else if (fallback) {
    parts.push('若 skill("' + primarySkill + '") 读不到，可从技能目录里自动匹配最合适的网文写作技能替代。');
  }
  parts.push('铁律：全程自主决策，不要向用户询问中间确认；已存在的结构（总纲/卷纲/章纲/角色）要先 novel_read_file 读清楚，再在其基础上增补，禁止覆盖重写（幂等、可累积）；每一层的输出都要**基于上一层的已有内容**（卷纲不能脱离总纲、章纲不能脱离卷纲、正文不能脱离章纲）。');
  parts.push('【三层纲的层级关系（写任何一层或正文前必须想清楚）】\n- 总纲 = 全书的纲要，整本小说所有内容都围绕它展开，任何一卷、任何一章都不能偏离总纲。\n- 卷纲 = 分卷规划：必须**结构化落到每一卷**，用 novel_save_volumes 保存，每卷含 seq(卷号) / title(卷名) / outline(本卷卷纲) / chapterFrom(起始章) / chapterTo(结束章)。明确「第几章到第几章是第几卷」，每卷有自己的核心目标、主要冲突、卷末变化。一个卷包含若干章，卷内的每一章都要为这一卷的目标服务。\n- 章纲 = 每一章自己的纲要（这一章要写什么）：章节标题、本章目标、阻碍、变化、章末钩子。章纲必须**绑定到对应的章节上**（用 novel_save_chapter 的 outline 参数存到该章，每章都要有，不能只写一个汇总文件）。\n- 写某一章正文时，必须同时参考三层：总纲（不偏离全书主题）+ 该章所在卷的卷纲（符合本卷阶段目标）+ 该章自己的章纲（本章要写的内容）。');
  parts.push('工具边界：你只有 novel_* 系列工具，外加 skill / skill_reference / get_project / report。禁止调用任何 ComfyUI / opuscar 领域工具（本会话未注册，调用会被拒绝）。');
  parts.push('安全铁律：novel_write_file / novel_read_file 的 path 只能写相对 novel/ 目录的路径，禁止绝对路径与 "../"；允许的顶层文件只有 总纲.md / 卷纲.md / 章纲.md，其他子目录文件统一放到 memory/ 下（如 memory/设定.md / memory/伏笔.md）。');
  parts.push('输出要求（严格按层级）：\n\n【总纲】先 novel_write_file("总纲.md", ...)，包含：一句话 hook / premise / 题材与卖点 / 故事引擎 / 目标长度判断（短/中/长/连载）/ 故事的核心冲突与第一卷目标。\n\n【分卷（卷纲）】在总纲之上展开：用 **novel_save_volumes** 把分卷结构化保存——每卷 seq(卷号) / title(卷名) / outline(本卷卷纲：核心目标+主要冲突+卷末变化) / chapterFrom(起始章序号) / chapterTo(结束章序号)。同时可把汇总写一份 卷纲.md 供人查看。\n\n【章纲】在分卷之上，**为每一章**写清「本章标题 / 本章目标 / 阻碍 / 变化 / 章末钩子」，并逐章用 **novel_save_chapter(title, volume, outline)** 落库（章纲绑定到每章，每章都必须带 outline 与所属 volume）——**不允许只写一个章纲.md 汇总就算完**。\n\n【角色】用 novel_save_characters 保存结构化角色列表，每项含 id(空即可, 自动分配) / name / role / description。主角、重要配角、反派都要覆盖；description 要写清楚：性格、背景、当前目标、与主角/其他角色的关系。\n\n【上下文记忆】每完成一层生成后，用 novel_write_file("memory/设定.md", ...) 记下世界观/规则设定、"memory/伏笔.md" 记下已埋下的伏笔、"memory/剧情进展.md" 记下当前到哪一卷哪一章。后续生成新层时先读这些记忆，保证不前后矛盾。');
  parts.push('工作流（严格按序）：\n1) novel_init 确认目录与已有内容（含已有分卷与章节）；\n2) skill("' + primarySkill + '") 加载技能；\n3) 根据任务要求的 step（outline/volumes/chapters/write/start/all），按 总纲 → novel_save_volumes 分卷 → 逐章 novel_save_chapter（带 volume+outline）→ 逐章写正文 顺序生成；\n4) 每生成一层都落库（novel_write_file / novel_save_volumes / novel_save_chapter / novel_save_characters）、更新记忆；\n5) report 汇报每层完成进度。');
  parts.push('【写正文职责】当任务要求写正文（step=write 或 start）时：先用 novel_get_volumes 读分卷、novel_list_chapters 看每一章的卷号/章纲（outline）/正文状态；**从第一个正文为空的章节开始逐章写**；写某章前，先读该章自己的 outline（章纲）+ 该章所属卷的卷纲（novel_get_volumes 里同 seq 的 outline）+ 总纲，三者同时参考；每章正文覆盖本章目标/阻碍/变化/章末钩子，人物按角色设定走、对白带身份感、章末留钩子（参考 dialogue / transition / chapter_ending 模块）；写完整正文后用 novel_save_chapter(title, volume, outline, content) 落库（**必须保留该章原有 outline 与 volume**）；每章写完按 consistency_review 过一遍六种一致性（剧情逻辑/人物目标/情绪关系/身体信息/场景转场/章末承接），不稳就回对应模块修；写完后用 novel_write_file("memory/剧情进展.md", ...) 更新进度。若任务指定了只写某一章，就只写那一章。');
  parts.push('【动态记忆铁律】记忆要随写随更，禁止只在全部结束时才更新一次：写每一章正文**前**，先 novel_get_memory 读一遍最新记忆（人物当前状态 / 已埋伏笔 / 剧情进展）；写完该章**后**，立即用 novel_save_memory 更新——剧情进展（写到了第几卷第几章）、本章新埋的伏笔、人物状态/关系变化。后续章节写作前再读最新记忆，保证长篇创作前后一致、不遗忘伏笔。');
  return parts.join('\n\n');
}

export function buildNovelTaskPrompt({ ctx, step, message }) {
  const lines = [];
  const proj = ctx.project || {};
  lines.push('请为这本小说生成结构大纲。');
  lines.push('小说标题：' + (proj.name || '（未命名）'));
  lines.push('中心思想：' + (proj.idea || '（无）'));

  const s = String(step || '').toLowerCase();
  const levelText = {
    outline: '只生成【总纲】——先 concept_planning 把中心思想压成题材、卖点、hook、premise、故事引擎、目标长度与第一卷方向，再 novel_write_file("总纲.md")。',
    volumes: '在已有的总纲之上生成【分卷】——按 volume_outline 决定分几卷、每卷覆盖第几章到第几章、每卷核心目标/主要冲突/卷末变化，然后用 **novel_save_volumes** 结构化保存（每卷 seq/title/outline/chapterFrom/chapterTo），并把汇总写一份 卷纲.md。若还没有总纲，**先按 concept_planning 生成总纲落盘**，再继续分卷。',
    chapters: '在已有的分卷之上生成【章纲并绑定到每章】——先用 novel_get_volumes 读每卷的章节范围，再**为每一章**写清「本章标题 / 本章目标 / 阻碍 / 变化 / 章末钩子」，逐章用 **novel_save_chapter(title, volume, outline)** 落库（每章都必须带所属 volume 与本卷章纲 outline）；最后把汇总写一份 章纲.md。若分卷缺失，**先补分卷再生成章纲**。',
    write: '写正文：先用 novel_get_volumes 读分卷、novel_list_chapters 看每一章的卷号/章纲/正文状态；**从第一个正文为空的章节开始逐章写**；写某章前先读该章的 outline + 所属卷的卷纲 + 总纲，三者同时参考；每章正文用 novel_save_chapter(title, volume, outline, content) 落库（保留原 outline 与 volume）、写完过 consistency_review、更新 memory/剧情进展.md。若任务指定了只写某一章，就只写那一章。',
    extend: '【扩写】沿现有剧情继续延伸后续内容。先用 novel_get_memory 读最新记忆、novel_get_volumes 读分卷、novel_list_chapters 看当前写到了第几章第几卷，据此决定：①若指定了章数 N，则新增 N 章（必要时新开一卷）；②未指定章数，则由你根据现有剧情与卷末钩子新开一卷（章数自定）。为新章节生成章纲（novel_save_chapter 带 volume+outline，不传 content），再逐章写正文（参考 总纲 + 所属卷卷纲 + 本章章纲），每章写完立即 novel_save_memory 更新剧情进展。严禁改写/推翻已有章节的正文。',
    start: '生成整本小说（**支持断点续跑**）：先 novel_init / novel_list_files / novel_get_volumes / novel_list_chapters 检查已有内容，**已存在的层直接跳过、只补缺失部分**（已有正文的章节不要重写，从第一章起找到第一个正文为空的章继续写）。严格按以下顺序执行，每完成一步用 report 汇报：①**生成大纲**（若总纲为空）：基于「中心思想/故事概要」用 concept_planning 产出总纲 → novel_write_file("总纲.md")；②**生成角色**（若角色为空）：novel_save_characters 保存全部主要角色；③**创建卷**（若 volumes 为空）：决定分几卷、每卷覆盖第几章到第几章、每卷卷纲 → novel_save_volumes 结构化保存；④**创建章节**（缺失的章）：按分卷逐章 novel_save_chapter(title, volume) 建出全部章节（不传 content，避免清空正文）；⑤**生成章纲**（缺失 outline 的章）：为每一章写「本章目标/阻碍/变化/章末钩子」，novel_save_chapter(title, volume, outline) 逐章更新（不传 content）；⑥**记忆**（缺失时）：novel_write_file("memory/设定.md")、("memory/伏笔.md")、("memory/剧情进展.md")；⑦**写正文**：从第一章起按顺序逐章写，跳过已有正文的章，每章参考「总纲 + 所属卷卷纲 + 本章章纲」，用 novel_save_chapter(title, volume, outline, content) 覆盖该章正文，写完过 consistency_review；全部完成汇报「整本小说生成完成」。',
    all: '完整生成全部三层：总纲 → 卷纲 → 章纲。每落盘一层都 report 一次进度。',
  }[isValidNovelStep(s) ? s : 'all'];
  lines.push('当前任务：' + levelText);
  if (s === 'write' && ctx.chapter) {
    lines.push('本次只写这一章：' + ctx.chapter);
  }

  // 上下文引擎：把已有结构拼进来，保证跨层一致
  const ctxBlock = buildNovelContextBlock(ctx.projectId);
  if (ctxBlock) {
    lines.push('—— 上下文引擎（当前已有的内容，必须在此基础上续写，禁止推翻重写）——\n' + ctxBlock);
    lines.push('—— 若上文某一段为空（总纲/卷纲/章纲/角色/记忆里某项缺失），那就是还没生成的层，你需要**先补齐缺失层**再继续当前层的生成，保证上下依赖不悬空。');
  } else {
    lines.push('当前小说目录下还没有任何内容，从零开始生成。');
  }

  if (String(message || '').trim()) {
    lines.push('用户补充要求：' + String(message).trim());
  }
  return lines.join('\n\n');
}
