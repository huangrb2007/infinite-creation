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
  return (String(script || '').match(/^[ \t]*[【\[]?第[\d一二三四五六七八九十百零两]+场/gm) || []).length;
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
export const SKILL_CHARACTER_SHEET_LAYOUT = '角色设定图版式：画面上半部分是该角色的一张大面部特写（头肩近景，五官、发型、神态清晰）；下半部分从左到右并排三张从头到脚的完整全身图：正面全身、正右侧面全身、背面全身，头顶到脚尖完整入画不裁切。四个区域是同一个角色、同一套服装和配饰，比例严格一致。纯浅灰或纯白背景，不出现文字、标注和其他人物。';

// 按项目画风选导演助理的视觉档位（技能只支持三档；项目画风里的具体描述始终是外观主锚）
export function visualTierOf(style) {
  const s = String(style || '');
  if (/真人|实拍|写实真人|live.?action|photoreal/i.test(s)) return '真人电影档';
  if (/三渲二|3渲2|二次元|动漫|日漫|卡通|2D|二维|手绘|赛璐璐|cel/i.test(s)) return '游戏内三渲二实机建模档';
  return '默认 3DCG 档';
}

export function buildSkillAdapter({ style, styleDetailText, webSearch }) {
  const tier = visualTierOf((style || '') + ' ' + (styleDetailText || ''));
  return [
    '【本应用里怎么落地技能（只规定接口；拍法、节奏、表演、镜头数与时长一律按技能设计）】',
    '1. 全自动运行：技能里「先问用户参考片段 / 偏好」「等用户确认」的步骤，一律按项目设置和剧情自己决定后继续，不要停下来提问。技能说「上网学习类似片段」时，' + (webSearch ? '可以用 web_search 查少量参考（每章不超过 3 次），查不到就按自身知识继续' : '本应用未开联网搜索，直接按你已有的影视知识设计') + '。',
    '2. 视觉档位：项目画风「' + (style || '未指定') + '」' + (styleDetailText ? '（' + styleDetailText + '）' : '') + ' → 采用技能的「' + tier + '」。项目画风是外观主锚；档位里提到的具体作品名只作质感参照，不要把角色画成那部作品的人物。',
    '3. 交付方式：不输出 .txt 文件。分镜用 set_storyboard 写入——每一条分镜 = 一段 H3 视频（duration 4–15 秒，段内可以按技能设计多个 [Shot]）；每段的最终 H3 提示词用 update_shot(shot_id, video_prompt) 写入。全部段落写完才算这一章的提示词完成。',
    '4. H3 格式：段落绑定了参考图时用 h3-prompt-writing 的全参考模式（Ref2VA）六段式：subject_definitions / summary / retention_analysis / detailed_description / overall_soundscape / non_diegetic_music，字段名和顺序照技能。时间线总长 = 这一段的 duration。背景音乐由应用另外生成，non_diegetic_music 写 None。',
    '5. 参考素材标签：技能里写 <Picture N>、<Audio N> 的地方，一律写成「双花括号 + 资产名」：角色设定图 {{林冬}}、场景图 {{小区走廊}}、道具 {{手机}}、角色音色 {{林冬的声音}}。应用出片时按这一段实际提交的参考顺序换成正确编号——你不知道顺序，所以绝不能写 <Picture 1> 这类编号。<Subject N> 和说话人编号 (S1) 照技能正常用，例如：`<Subject 1> is 林冬, the character shown in {{林冬}}.`、`{{林冬的声音}} is the voice-timbre reference for <Subject 1> (S1).`。花括号里只能是已有资产名；画面里出现的每个角色都要写进这一段的 characters 并在提示词里用花括号指代。',
    '6. 本应用生成的参考图：角色设定图 = 上方一张大面部特写 + 下方从左到右正面全身 / 正右侧全身 / 背面全身（就是技能 h3-delivery.md 里的多视图版式，按那一节的分区规则写）；场景图是没有人物的空场景；道具图是白底单品。',
    '7. 声音：这一段 lines 里的每一句（对白、内心OS、旁白、系统 / 短信等画外音）都必须原文写进提示词，按技能的说话人格式放进 <d>[Chinese] 原文</d>，按顺序、每句一次，不增删改字。旁白是画外叙述者（画面里没人开口）；内心OS 是该角色的画外音、他的嘴保持闭合。',
    '8. 音色：角色的声线写在角色资产的 voice_desc 里（应用据此生成音色样本，提示词里用 {{角色名的声音}} 指代），不要为角色另建 voice 资产。旁白、系统音这类非角色声音各建一个 category=voice 的资产（如「旁白」「系统音」，description 写声线），应用同样生成样本；用到它的段落在 audios 里绑定，提示词里用 {{旁白}}、{{系统音}} 指代。',
    '9. 分镜字段：characters 写全这一段画面里出现的每个角色（不只是说话的人）；scenes 写所在场景；props 写起作用的道具；lines 按出现顺序一行一句（`沈婉月（嫌恶）：离我远点！`、`林冬（内心OS）：……`、`旁白：……`、`系统（画外音）：……`）；sub_shots 用中文简述这一段的镜头设计（给人看，方便审片）；visual 一句话交代时间地点光线。',
  ].join('\n');
}
