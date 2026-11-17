// 小说 → 剧本 → 分镜 → 视频提示词 的改编规范（写进 Agent 系统提示词，优先级高于各技能文档），
// 以及配套的代码校验用的剧本解析。
//
// 起因（真实项目复盘）：3000 字的一章被改成 5 场、每场只出 1 个镜头，共 60 秒；
// 原文的开场钩子、背景交代、主角内心独白、系统提示音全部丢失（分镜 narration 全空），
// 台词被砍到每镜一两句；场与场之间没有任何过渡，成片像幻灯片硬切。
// 根因是提示词里「同一场景合并成一镜、仅场景切换才换镜」+「台词超长就压缩」这两条，
// 而且全程没有任何关于旁白 / 内心独白的规定。

// （旧的 ADAPTATION_RULES 已删：技能模式下创作规则全部来自技能文档。）

// —— 剧本 / 分镜里的「声音行」解析 ——
// 一行形如「名字（修饰）：内容」。旁白类 = 名字是 旁白/画外音/解说/OS/VO，或修饰里带 内心/OS/心声/独白/画外音/旁白，
// 或名字带 系统/短信/广播/电话/手机/提示音 等非人物声源。
const VOICE_LINE_RE = /^\s*[【\[]?([^：:\n【】\[\]]{1,24}?)[】\]]?\s*[：:]\s*(.+)$/;
const NARRATOR_NAME_RE = /^(旁白|画外音|解说|字幕|OS|VO|os|vo)|系统|短信|广播|电话那头|手机|提示音|播报|新闻/;
const NARRATOR_MOD_RE = /内心|OS|os|心声|独白|画外音|旁白|VO|vo|心想|心里/;
const NOT_SPEAKER_RE = /^(出场人物|场景|动作|时间|地点|人物|道具|备注|景别|镜头|画面|音效|BGM|bgm|转场|第.{1,4}场)/;

const stripQuotes = (s) => String(s || '').replace(/^[“"「『【\s]+|[”"」』】\s]+$/g, '');
const charCount = (s) => String(s || '').replace(/[\s，。！？、；：“”‘’"'（）()【】\[\]…—\-,.!?;:]/g, '').length;

/** 解析一段文本里的声音行，返回 { dialogue: 字数, narration: 字数, narrationLines: [..], dialogueLines: [..] } */
export function voiceStats(text) {
  // story = 旁白 + 内心独白（讲故事的声音，不含系统音 / 画外的路人喊话）
  const out = { dialogue: 0, narration: 0, story: 0, narrationLines: [], dialogueLines: [] };
  for (const raw of String(text || '').split(/\r?\n/)) {
    const m = VOICE_LINE_RE.exec(raw);
    if (!m) continue;
    const head = m[1].trim();
    const mod = (head.match(/[(（]([^()（）]*)[)）]/g) || []).join('');
    const name = head.replace(/[(（][^()（）]*[)）]/g, '').trim();
    if (!name || NOT_SPEAKER_RE.test(name)) continue;
    const content = stripQuotes(m[2]);
    const n = charCount(content);
    if (!n) continue;
    if (NARRATOR_NAME_RE.test(name) || NARRATOR_MOD_RE.test(mod)) {
      out.narration += n; out.narrationLines.push(content);
      if (/^(旁白|解说)/.test(name) || /内心|OS|os|心声|独白|心想|心里/.test(mod)) out.story += n;
    }
    else { out.dialogue += n; out.dialogueLines.push(content); }
  }
  return out;
}

/** 分镜 narration 字段：允许不带前缀的纯口播稿，整段都算旁白字数 */
export function narrationChars(narration) {
  let n = 0;
  for (const raw of String(narration || '').split(/\r?\n/)) {
    const m = VOICE_LINE_RE.exec(raw);
    n += charCount(stripQuotes(m ? m[2] : raw));
  }
  return n;
}

/** 分镜 narration 里每一句的口播内容（去掉前缀和引号） */
export function narrationSentences(narration) {
  const out = [];
  for (const raw of String(narration || '').split(/\r?\n/)) {
    const m = VOICE_LINE_RE.exec(raw);
    const c = stripQuotes(m ? m[2] : raw);
    if (charCount(c)) out.push(c);
  }
  return out;
}

export function dialogueChars(dialogue) {
  let n = 0;
  for (const raw of String(dialogue || '').split(/\r?\n/)) {
    const m = VOICE_LINE_RE.exec(raw);
    n += charCount(stripQuotes(m ? m[2] : raw));
  }
  return n;
}

/** 剧本场次数：【第N场…】场头 */
export function sceneCount(script) {
  return (String(script || '').match(/^[ \t]*(?:[【\[]?第[\d一二三四五六七八九十百零两]+场|\d+-\d+[、.．])/gm) || []).length;
}

// 提示词里是否出现了这句话（忽略标点和空白；长句只比对前 10 个字，容忍模型断句）
export function promptHasLine(prompt, line) {
  const norm = (s) => String(s || '').replace(/[\s，。！？、；：“”‘’"'（）()【】\[\]…—\-,.!?;:]/g, '');
  const p = norm(prompt);
  const l = norm(line);
  if (!l) return true;
  return p.includes(l.slice(0, Math.min(10, l.length)));
}

// —— 提示词里的命名占位符 {{资产名}} → 模型认的编号 __MINIMAX_H3_REF_N__ ——
// 以前让 LLM 自己写编号：它并不知道这一镜实际提交了哪些参考、按什么顺序，
// 少绑一个角色编号就全错位（提示词说 REF_2 是王胜，实际第 2 张是走廊）。
const NAMED_REF_RE = /\{\{\s*([^{}]{1,40}?)\s*\}\}/g;
const normName = (s) => String(s || '').replace(/\s+/g, '').replace(/(的)?(声音|音色|嗓音|声线)(参考)?$/, '的声音');

export function namedRefTokens(prompt) {
  const out = [];
  for (const m of String(prompt || '').matchAll(NAMED_REF_RE)) out.push(m[1].trim());
  return [...new Set(out)];
}

/** references: [{type, name, ...}]。返回 { prompt, unresolved: [名字] } */
export function resolveNamedRefs(prompt, references) {
  const unresolved = [];
  const refs = references || [];
  const out = String(prompt || '').replace(NAMED_REF_RE, (m, raw) => {
    const want = normName(raw);
    let i = refs.findIndex((r) => normName(r.name) === want);
    // 「林冬」也可以指代他的服装 / 年龄变体图（name 仍是角色名）；声音只匹配音频
    if (i < 0 && !/的声音$/.test(want)) i = refs.findIndex((r) => r.type !== 'audio' && String(r.label || '').startsWith(raw.trim()));
    // 没绑定 / 还没生成的：声音退回「其固定音色」，其它退回名字本身
    if (i < 0) { unresolved.push(raw.trim()); return /的声音$/.test(want) ? '其固定音色' : raw.trim(); }
    return '__MINIMAX_H3_REF_' + (i + 1) + '__';
  });
  return { prompt: out, unresolved: [...new Set(unresolved)] };
}

// ======================= 精简模式（默认）=======================
// 用户反馈：技能文档太多、互相打架，LLM 花大量时间加载技能和逐镜写英文提示词，还越写动作越多、画面越乱。
// 精简模式：不加载任何技能；LLM 只写 剧本 → 人物 / 场景资产 → 分镜；
// 每镜的视频提示词由应用按固定模板自动拼出（见 composeVideoPrompt），不再让 LLM 写。
// 真正需要约束的只有三件事：台词、人物一致性、旁白等画外音；动作能少则少。

export const LEAN_RULES = [
  '【短剧改编与分镜规范】',
  '',
  '一、剧本（小说 → 剧本）',
  '1. 信息不丢，但也不是朗读原文：每个情节点、关键心理、背景交代都要有对应内容；环境、动作、外貌、表情交给画面，不写进旁白。台词 + 旁白总字数控制在小说正文的 30%–45%（低于 25% 或高于 50% 会被拒绝）。',
  '2. 三种声音写成独立行：对白 `人物名（情绪）：台词`；内心独白 `人物名（内心OS）：……`（心里想的话一律这样写，不改成自言自语，也不删）；旁白 `旁白：……`（前史、因果、时间地点、开场钩子、章末悬念）；非人物声音 `系统（画外音）：……`、`短信（画外音）：……`。',
  '3. 不编造：只改编原文已有的情节和对话，原文在哪里结束剧本就在哪里结束。允许新增的只有一句开场钩子旁白和一句章末悬念旁白。',
  '4. 每场结尾写清人物去向，下一场开头写清怎么到的，给转场留抓手。台词文字里不用【】〔〕和省略号。',
  '5. 已经是剧本格式的章节（有场次、有「人物：台词」）直接用，不要重写。',
  '',
  '二、分镜（剧本 → 分镜）',
  '1. 一场戏拆成多个镜头：换场第一镜是建立镜头（先给新环境全景，人物再入画），之后按「谁在说话 / 情绪转折」切镜。常规一场 3–8 镜。',
  '2. 单镜 4–10 秒为主。时长 ≈（台词 + 旁白字数）÷ 4.5 + 1–2 秒；上限 = 字数 ÷ 4 + 4 秒，无口播的纯画面镜头 ≤ 8 秒。每镜（台词 + 旁白）≤ 时长 × 5 字，放不下就拆镜，不删词。整章台词 + 旁白覆盖剧本 85% 以上。',
  '3. 每镜最多 2 个人开口。这一镜的所有声音按出现顺序写进 lines（一行一句）：`沈婉月（嫌恶）：离我远点！`、`林冬（内心OS）：算了。`、`旁白：……`、`系统（画外音）：……`。',
  '4. characters 写全这一镜画面里出现的每一个角色（不只是说话的人）；scenes 写这一镜所在的场景（每镜必须有一个）；props 只写画面里起作用的关键道具。',
  '5. sub_shots 是时间轴，最多 3 段，每段写：景别 + 人物在画面的位置和朝向 + 一个主导动作或姿态 + 表情。**动作越少越好**：说话的镜头以「站着 / 坐着看向对方说话」「低头看手机」这类稳定姿态为主，一段只写一个动作，不写连串动作和复杂肢体细节——动作写得越多，视频画面越乱。',
  '6. visual 用一两句交代：时间、地点、光线色调、人物左右站位。同一场景里人物的左右站位前后一致；同场景下一镜的起始姿态接上一镜的结束姿态。',
  '7. 旁白讲前史 / 回忆时，画面给对应的回忆或空镜（遗像、深夜送件的背影、城市夜景），不要让人物干站着。',
  '8. 视频提示词由应用根据你写的分镜自动生成，**不要调用 update_shot 写 video_prompt**。',
  '',
  '三、资产',
  '1. 角色：每个有台词或反复出场的角色建一个 character 资产，description 写清年龄性别、长相、发型、**一套固定的日常着装**；voice_desc 写固定声线（年龄段与性别、音色、语速、语气）。一次性的路人不建。',
  '2. 场景：每个场次的地点建一个 scene 资产（空场景，不带人物）。道具：只给反复出现、对剧情关键的建 prop。',
  '3. 资产的 prompt 写成该风格下的出图提示词（中文或英文均可），角色图为白底设定图。',
].join('\n');

const NARRATOR_VOICE = '沉稳、略低的青年男声，讲故事的语气，语速平稳';
const SYSTEM_VOICE = '冰冷、空灵的电子合成音，没有感情起伏';

/** 把一行声音解析成 { name, mod, text, kind }：kind = speech / inner / narrator / system / offscreen */
export function parseVoiceLine(raw) {
  const m = VOICE_LINE_RE.exec(String(raw || ''));
  if (!m) return null;
  const head = m[1].trim();
  const mod = (head.match(/[(（]([^()（）]*)[)）]/g) || []).map((x) => x.slice(1, -1)).join('，');
  const name = head.replace(/[(（][^()（）]*[)）]/g, '').trim();
  const text = stripQuotes(m[2]).replace(/[【】〔〕]/g, '');
  if (!name || !charCount(text) || NOT_SPEAKER_RE.test(name)) return null;
  let kind = 'speech';
  if (/^(旁白|解说)/.test(name)) kind = 'narrator';
  else if (/系统|提示音|播报|广播|电子/.test(name)) kind = 'system';
  else if (/内心|OS|os|心声|独白|心想|心里/.test(mod)) kind = 'inner';
  else if (NARRATOR_NAME_RE.test(name) || /画外音|旁白|VO|vo|门外|电话/.test(mod)) kind = 'offscreen';
  const emotion = mod.split(/[，,、]/).map((x) => x.trim()).filter((x) => x && !/内心|OS|os|心声|独白|画外|旁白|VO|vo|门外|门内|隔门|电话/.test(x)).join('、');
  return { name, mod, text, kind, emotion };
}

/** lines（混排、有序）→ { dialogue, narration }：角色开口说的进 dialogue，其余进 narration */
// 不同技能的声音行写法统一成应用的格式（应用靠它分配音色、判断谁开口）：
//   「徐三金内心声：…」「徐三金内心独白：…」「徐三金心声：…」 → 「徐三金（内心OS）：…」
//   「徐三金OS：…」「徐三金VO：…」 → 「徐三金（内心OS）：…」
//   「徐三金画外音：…」 → 「徐三金（画外音）：…」
export function normalizeVoiceLines(text) {
  return String(text == null ? '' : text)
    .replace(/^(\s*[△]?\s*)([^\s：:（()（）△]{1,16}?)(内心声|内心独白|心声|内心OS|OS|VO)\s*[：:]/gm, (m, pre, name) => (/^(旁白|系统|画外)/.test(name) ? m : pre + name + '（内心OS）：'))
    .replace(/^(\s*)([^\s：:（()（）△]{1,16}?)画外音\s*[：:]/gm, (m, pre, name) => (/^旁白$/.test(name) ? m : pre + name + '（画外音）：'));
}

export function splitLines(lines) {
  const d = [];
  const n = [];
  for (const raw of String(lines || '').split(/\r?\n/)) {
    const v = parseVoiceLine(raw);
    if (!v) continue;
    (v.kind === 'speech' ? d : n).push(raw.trim());
  }
  return { dialogue: d.join('\n'), narration: n.join('\n') };
}

/**
 * 按固定模板拼这一镜的视频提示词（中文）。
 * shot: { duration, visual, sub_shots, dialogue, narration, lines? }
 * ctx: { characters:[{name, voice_desc}], scenes:[{name}], props:[{name}], style }
 */
export function composeVideoPrompt(shot, { characters = [], scenes = [], props = [], style = '' } = {}) {
  // 结构性的句子用英文写、只有画面描述和引号里的台词是中文：
  // 实测中文的「XX是沈婉月」这类说明句会被模型当成台词念出来（每镜开头多一句「是沈婉月」）。
  const out = [];
  const intro = [
    ...characters.map((c) => '{{' + c.name + '}} is the reference image of the character 林冬'.replace('林冬', c.name)),
    ...scenes.map((s) => '{{' + s.name + '}} is the reference image of the location'),
    ...props.map((p) => '{{' + p.name + '}} is the reference image of a prop (' + p.name + ')'),
  ];
  if (intro.length) out.push('References (never spoken aloud): ' + intro.join('; ') + '.' + (characters.length ? ' Every character keeps exactly the face, hairstyle and outfit of their own reference image.' : ''));
  if (style) out.push('Visual style: ' + style + '.');
  if (shot.visual) out.push('Scene: ' + String(shot.visual).trim());
  if (shot.sub_shots) out.push('Shot timeline (' + (Number(shot.duration) || 5) + ' seconds total): ' + String(shot.sub_shots).trim());

  // 声音：优先用有序的 lines；否则按「在时间轴里先出现的在前」把台词和旁白排一下
  let voiceLines = [];
  if (shot.lines) voiceLines = String(shot.lines).split(/\r?\n/).map(parseVoiceLine).filter(Boolean);
  else {
    const all = [...String(shot.dialogue || '').split(/\r?\n/), ...String(shot.narration || '').split(/\r?\n/)].map(parseVoiceLine).filter(Boolean);
    const sub = String(shot.sub_shots || '').replace(/\s/g, '');
    const pos = (v) => { const i = sub.indexOf(v.text.replace(/\s/g, '').slice(0, 6)); return i < 0 ? 1e9 : i; };
    voiceLines = all.map((v, i) => ({ v, i, p: pos(v) })).sort((a, b) => a.p - b.p || a.i - b.i).map((x) => x.v);
  }
  if (voiceLines.length) {
    const byName = Object.fromEntries(characters.map((c) => [c.name, c]));
    const rows = voiceLines.map((v, i) => {
      const c = byName[v.name];
      const voice = c ? 'voice reference {{' + c.name + '的声音}}' + (c.voice_desc ? ', ' + String(c.voice_desc).trim().replace(/[。；;]+$/, '') : '') : '';
      const emo = v.emotion ? '; tone: ' + v.emotion : '';
      let who;
      if (v.kind === 'narrator') who = 'Off-screen narrator voice-over, nobody on screen is speaking and all lips stay closed (' + NARRATOR_VOICE + emo + ')';
      else if (v.kind === 'system') who = 'Off-screen synthetic system voice, nobody on screen is speaking (' + SYSTEM_VOICE + ')';
      else if (v.kind === 'inner') who = 'Inner-thought voice-over of ' + v.name + ', his or her lips stay closed and do not move (' + (voice || 'same voice as when speaking') + emo + ')';
      else if (v.kind === 'offscreen' || !c) who = 'A voice from off screen (' + v.name + ', not visible in frame' + emo + ')';
      else who = v.name + ' speaks aloud with lip sync (' + voice + emo + ')';
      return (i + 1) + '. ' + who + ' says: "' + v.text + '"';
    });
    out.push('Audio, in this order, each quoted line spoken exactly once and only one voice at a time:\n' + rows.join('\n'));
    out.push('Only the quoted lines above are spoken; nothing else in this prompt is read aloud. After the last line there is only ambient sound.');
  } else {
    out.push('No speech in this shot, only ambient sound. Nothing in this prompt is read aloud.');
  }
  out.push('No on-screen text, captions, subtitles, watermarks or logos.');
  return out.join('\n');
}

// ======================= 技能模式（默认）=======================
// 用户 2026-11 的决定：创作规则全部交给技能（导演助理 director-assistant + h3-prompt-writing），
// 应用只规定「接口」——数据怎么写进工具、参考素材怎么指代、全自动不提问。下面这段不含任何拍法 / 节奏 / 字数比例规定。

// 角色设定图版式：与导演助理技能 h3-delivery.md「上方面部特写 + 下方全身三视图」一致
export const SKILL_CHARACTER_SHEET_LAYOUT = '角色设定图版式：左侧 1/3 区域为人物上半身脸部特写（头肩近景，五官、发型、神态清晰）；右侧 2/3 区域整齐排布同一角色三张从头到脚的完整全身三视图：正面、侧面、背面，头顶到脚尖完整入画不裁切。所有区域是同一个角色、同一套服装和配饰，比例严格一致。纯白或浅灰背景，不出现文字、标注和其他人物。';

// 按项目画风选导演助理的视觉档位（技能只支持三档；项目画风里的具体描述始终是外观主锚）
export function visualTierOf(style) {
  const s = String(style || '');
  if (/真人|实拍|写实真人|live.?action|photoreal/i.test(s)) return '真人电影档';
  if (/三渲二|3渲2|二次元|动漫|日漫|卡通|2D|二维|手绘|赛璐璐|cel/i.test(s)) return '游戏内三渲二实机建模档';
  return '默认 3DCG 档';
}

export function buildSkillAdapter({ style, styleDetailText, webSearch, aspect, mainSkill = '', route = '', characterStyle = 'standard', installed = [] }) {
  const aif = mainSkill === 'minimax-drama-prompt';
  const tier = visualTierOf((style || '') + ' ' + (styleDetailText || ''));
  return [
    '【本应用里怎么落地技能（只规定接口；拍法、节奏、表演、镜头数与时长一律按技能设计）】',
    '1. 全自动运行：技能里「先问用户参考片段 / 偏好」「等用户确认」的步骤，一律按项目设置和剧情自己决定后继续，不要停下来提问。技能说「上网学习类似片段」时，' + (webSearch ? '可以用 web_search 查少量参考（每章不超过 3 次），查不到就按自身知识继续' : '本应用未开联网搜索，直接按你已有的影视知识设计') + '。',
    (aif ? '2. 画风：项目画风「' + (style || '未指定') + '」' + (styleDetailText ? '（' + styleDetailText + '）' : '') + '，资产和提示词都按这个画风写，全片统一。' : '2. 视觉档位：项目画风「' + (style || '未指定') + '」' + (styleDetailText ? '（' + styleDetailText + '）' : '') + ' → 采用技能的「' + tier + '」。项目画风是外观主锚；档位里提到的具体作品名只作质感参照，不要把角色画成那部作品的人物。'),
    '3. 交付方式：不输出 .txt 文件。分镜用 set_storyboard 写入——每一条分镜 = 一段 H3 视频（duration 4–15 秒，段内可以按技能设计多个 [Shot]）。短剧节奏要快：段内单个镜头一般 2–4 秒，一段的镜头数约等于 duration ÷ 3；剧本里的（闪切）画面各给一个 1–2 秒的镜头。'
      + (aspect === '9:16' || aspect === '3:4' ? '本项目是竖屏 ' + aspect + '：按竖屏构图（人物居中、近景和中近景为主、上下留出空间，横向大全景少用），提示词里写明 vertical ' + aspect + ' framing。' : '')
      + '每段的最终 H3 提示词用 update_shot(shot_id, video_prompt) 写入。全部段落写完才算这一章的提示词完成。',
    (aif ? '4. 提示词格式：按 minimax-drama-prompt 的 references/prompt-contract.md（最终提示词合同）写，首次可参考 approved-format-example.md 的结构（不抄剧情）；一段 10–15 秒，台词量按技能的预算。背景音乐由应用另外生成，不写背景音乐。' : '4. H3 格式：段落绑定了参考图时用 h3-prompt-writing 的全参考模式（Ref2VA）六段式：subject_definitions / summary / retention_analysis / detailed_description / overall_soundscape / non_diegetic_music，字段名和顺序照技能。时间线总长 = 这一段的 duration。背景音乐由应用另外生成，non_diegetic_music 写 None。'),
    '5. 参考素材标签：技能里写 <Picture N>、<Audio N> 的地方，一律写成「双花括号 + 资产名」：角色设定图 {{林冬}}、场景图 {{小区走廊}}、道具 {{手机}}、角色音色 {{林冬的声音}}。应用出片时按这一段实际提交的参考顺序换成正确编号——你不知道顺序，所以绝不能写 <Picture 1> 这类编号。<Subject N> 和说话人编号 (S1) 照技能正常用，例如：`<Subject 1> is 林冬, the character shown in {{林冬}}.`、`{{林冬的声音}} is the voice-timbre reference for <Subject 1> (S1).`。花括号里只能是已有资产名；画面里出现的每个角色都要写进这一段的 characters 并在提示词里用花括号指代。人物的长相、发型、服装以参考图为准（技能 h3-delivery.md 也要求「不扩写外貌」）：subject_definitions 里只写名字、身份和「appearance and outfit exactly as in {{林冬}}」，不要自己描写衣服发型——写错一件衣服，模型就会照着文字换装。',
    assetRouteNote(route, characterStyle, new Set(installed)),
    (route === 'studio3d' || route === 'realistic') && have6(installed, route)
      ? '6b. 本应用生成的参考图：人物图按上面第 6 条的技能版式出（应用会把版式统一成「左栏站立全身 + 右栏' + (characterStyle === 'refined' ? '面部特写' : '半身胸像') + '」两栏），不要写「三视图」「左侧三分之一 / 右侧三分之二」这类设定图版式；场景图是没有人物的空场景；道具图是白底单品，屏幕 / 光幕类道具图上就是正确的界面和文字——镜头里出现这块屏幕时引用它，不要自己另编屏幕内容。人物的长相和服装以参考图为准。'
      : '6b. 本应用生成的参考图：角色设定图 = 左侧 1/3 一张面部特写 + 右侧 2/3 从左到右正面全身 / 侧面全身 / 背面全身。按分区写：左侧特写是唯一的面部身份来源，右侧三视图只锁身体、服装和配饰，例如 `Use only the left facial close-up in {{林冬}} for facial identity; the three full-body views on the right define body, outfit and accessories.`。场景图是没有人物的空场景；道具图是白底单品，屏幕 / 光幕类道具图上就是正确的界面和文字——镜头里出现这块屏幕时引用它，写明「the screen shows exactly the interface and text in {{道具名}}」，不要自己另编屏幕内容。',
    ...(aif ? [
      '7. 声音写法按技能的「台词与画外音格式」：单人场景的内心声按技能改成画内低声自语——这一段 lines 里写成 `人物（低声自语）：……`（算对白，人物嘴会动）；两人及以上场景可保留画外音，lines 里写 `人物（内心OS）：……` / `人物（画外音）：……`，画外音响起时画面里的人嘴不动。旁白、系统音写 `旁白：……`、`系统（画外音）：……`。',
      '7b. 这一段 lines 里的每一句都必须按原文出现在最终提示词里（标点可调、去掉省略号，字词不改），顺序一致、每句一次。',
    ] : [
      '7. 画外音不对口型：旁白、内心OS、系统音、电话 / 门外喊话这类画外音响起时，画面里所有人嘴巴闭合不动。按技能写法写 says in an off-screen voiceover 并紧跟 while ... lips remain completely closed；纯画外音的段落构图上优先用背影、侧脸、远景、手部和物件特写、或让人物嘴里有事（抽烟、喝水、咬着烟），少给正脸近景。',
      '7b. 声音：这一段 lines 里的每一句（对白、内心OS、旁白、系统 / 短信等画外音）都必须原文写进提示词，按技能的说话人格式放进 <d>[Chinese] 原文</d>，按顺序、每句一次，不增删改字。旁白是画外叙述者（画面里没人开口）；内心OS 是该角色的画外音、他的嘴保持闭合。',
    ]),
    '8. 音色：角色的声线写在角色资产的 voice_desc 里（应用据此生成音色样本，提示词里用 {{角色名的声音}} 指代），不要为角色另建 voice 资产。旁白、系统音这类非角色声音各建一个 category=voice 的资产（如「旁白」「系统音」，description 写声线），应用同样生成样本；用到它的段落在 audios 里绑定，提示词里用 {{旁白}}、{{系统音}} 指代。',
    '9. 分镜字段（资产怎么提取见 asset-extraction 技能）：characters 写全这一段画面里出现的每个角色（不只是说话的人，背影、半身入画也算；配角也必须先建角色资产）；props 写全这一段出现的道具，屏幕 / 光幕按当前显示状态绑定对应的那个道具资产；scenes 写所在场景；lines 按出现顺序一行一句（`沈婉月（嫌恶）：离我远点！`、`林冬（内心OS）：……`、`旁白：……`、`系统（画外音）：……`）；sub_shots 用中文简述这一段的镜头设计（给人看，方便审片）；visual 一句话交代时间地点光线。',
    ...(aif ? [
      '10. AIFISHER「一键下沉剧」五步流程在本应用里全自动执行、没有卡片和确认：读取剧本 → 计划（save_context 写人物表和声线，create_asset 建人物 / 场景 / 道具并写出图提示词）→ 资产由流水线统一生成（不调用技能里提到的 RunningHub 应用、Seedream、画布节点、外接文本节点）→ 分段编排（set_storyboard，一次写完整章）→ 每段最终提示词（update_shot）。技能里的「审核确认」「付费确认」「逐段确认」「创建 / 同步节点」「选择画面比例」都由应用处理，直接继续。',
      '11. 剧本：章节正文是小说 → 按「生成剧本」环节的 novel-to-script 改编；章节已经是剧本（有场次和「人物：台词」）→ 用 script-normalize 只整理格式、台词一字不改。剧本里的内心声写成 `人物内心声：……` 或 `人物（内心OS）：……` 都可以，应用会统一。',
      '12. 打戏：剧本里有打斗的段落，现实 / 武侠用 closed-fight-stable，玄幻 / 法术 / 巨物用 closed-fight-wild 设计动作；技能里 30 秒一镜到底的设计拆成两到三段（每段 ≤ 15 秒），段与段动作接续。',
    ] : []),
  ].join('\n');
}

function have6(installed, route) {
  const need = route === 'studio3d' ? ['studio-assets-3d'] : ['studio-character-assets'];
  const set = new Set(installed || []);
  return !set.size || need.every((n) => set.has(n));
}

// 资产路由说明（与 AIFISHER 一键下沉剧的画风路由一致）
export function assetRouteNote(route, characterStyle = 'standard', have = new Set()) {
  const ok = (n) => !have.size || have.has(n);
  if (route === 'studio3d' && ok('studio-assets-3d')) {
    return '6. 资产提示词（3D 漫剧画风）：人物和场景都按 studio-assets-3d 写（先读它的「制作台约定」，冲突时以约定为准）。人物风格 = '
      + (characterStyle === 'refined'
        ? '精致风格：人物资产走引擎 §4.1.1 极近特写子路由——梦幻面部特写、厚涂琉璃质感、剔透肤质与微距五官，弱化服装与环境；固定着装另在 description 里写清（视频按它换装锁定）。'
        : '普通风格：人物资产走引擎 §4.1.2 胸像子路由——海报感半身像、戏剧光，交代全身或半身服装与职业标志；需要交代全身服装时写成站立全身。')
      + '场景走世界全景 / 环境路由，空镜无人。人物正文只写人物本身（长相、发型、服装、气质、光），不写版式——应用统一排成「左栏站立全身 + 右栏' + (characterStyle === 'refined' ? '面部特写' : '半身胸像') + '」两栏，不要写三视图。';
  }
  if (route === 'gpt3d' && ok('gpt-3d-drama-assets')) {
    return '6. 资产提示词（3D 漫剧 · GPT 路线）：人物和场景按 gpt-3d-drama-assets 写；人物只写长相正文，设定图的画幅、三视图版式与渲染由应用附加。';
  }
  if (route === 'realistic' && ok('studio-character-assets')) {
    return '6. 资产提示词（真人写实画风）：人物按 studio-character-assets，场景按 studio-scene-assets，都叠加 shared-assets 的绘图铁律（东亚面孔、哑光无油光、双眼对称、场景空镜）。人物正文只写人物本身，不写版式——应用统一排成「左栏站立全身 + 右栏半身胸像」两栏，不要写三视图。';
  }
  return '6. 资产提示词：按「人物素材 / 场景素材」环节的技能写，并遵守 shared-assets 的绘图铁律（如已安装）。';
}

// 这条路由下，角色图是否由应用追加「左 1/3 面部特写 + 右 2/3 三视图」版式（技能自己规定了版式的不追加）
export function routeAppendsCharacterSheet(route) {
  return !(route === 'studio3d' || route === 'realistic');
}

// AIFISHER 路线的人物图版式：左栏站立全身 + 右栏面部特写（精致）/ 半身胸像（普通），与 AIFISHER 一键下沉剧的人物资产一致
export function studioCharacterLayout(characterStyle = 'standard', route = 'studio3d') {
  const right = characterStyle === 'refined' && route === 'studio3d'
    ? '右栏是同一人物的极近面部特写：梦幻面部特写，厚涂琉璃质感，剔透肤质与微距五官，眼睛对焦清晰'
    : '右栏是同一人物的半身胸像：海报感构图，戏剧化的柔和侧光，五官清晰';
  return '人物资产图版式：横版左右两栏，浅灰纯色或柔和渐变背景，没有场所、道具和其他人物。左栏是人物从头到脚完整入画的站立全身像，正面或微微侧身，双手空着；' + right + '。两栏是同一个人、同一张脸、同一套服装和发型，不出现文字和标注。';
}

// 把模型写进提示词的「三视图设定图」版式改写成两栏版式（老提示词 / 模型没按技能写时兜底）
export function rewriteSheetToStudio(prompt, layout) {
  let p = String(prompt || '');
  const had = /三视图|左侧\s*(三分之一|1\/3)|右侧\s*(三分之二|2\/3)|character (reference )?sheet|turnaround/i.test(p);
  p = p
    .replace(/竖版\s*9\s*[:：]\s*16\s*人物设定图[，,]?/g, '')
    .replace(/人物设定图[，,]?/g, '')
    .replace(/画面左侧\s*(三分之一|1\/3)\s*(区域)?(是|为)(一张)?/g, '右栏是')
    .replace(/画面右侧\s*(三分之二|2\/3)\s*(区域)?[^。；;]*?(三视图|背面全身)[^。；;：:]*[：:]?/g, '左栏是同一人物的站立全身像：')
    .replace(/[^。]*三视图[^。]*。/g, '');
  return (had || !p.includes('人物资产图版式')) ? p.trim() + '\n' + layout : p;
}
