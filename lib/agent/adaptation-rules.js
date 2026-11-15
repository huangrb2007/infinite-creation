// 小说 → 剧本 → 分镜 → 视频提示词 的改编规范（写进 Agent 系统提示词，优先级高于各技能文档），
// 以及配套的代码校验用的剧本解析。
//
// 起因（真实项目复盘）：3000 字的一章被改成 5 场、每场只出 1 个镜头，共 60 秒；
// 原文的开场钩子、背景交代、主角内心独白、系统提示音全部丢失（分镜 narration 全空），
// 台词被砍到每镜一两句；场与场之间没有任何过渡，成片像幻灯片硬切。
// 根因是提示词里「同一场景合并成一镜、仅场景切换才换镜」+「台词超长就压缩」这两条，
// 而且全程没有任何关于旁白 / 内心独白的规定。

export const ADAPTATION_RULES = [
  '【短剧改编与分镜规范（最高优先级：与任何技能文档冲突时以本节为准）】',
  '',
  '一、剧本改编（小说 → 剧本）',
  '1. 信息不丢，但也不是朗读原文：小说里的每个情节点、关键心理活动、背景交代、伏笔都要在剧本里有对应内容，禁止把一章压缩成梗概；同时旁白要提炼——能用画面交代的（环境、动作、外貌、表情）交给画面，不要写进旁白逐句念。剧本的台词 + 旁白总字数控制在小说正文的 30%–45%（低于 25% 或高于 50% 会被拒绝）。',
  '2. 三种声音都要用，并且写成可以直接配音的独立行：',
  '   · 对白：`人物名（情绪/动作）：台词`，角色开口说话。',
  '   · 内心独白：`人物名（内心OS）：……`。小说里人物心里想的话（「算了，惹不起还躲不起吗」「等老子有钱了……」）一律写成内心OS，嘴不动、声音是画外音。禁止改成角色对着空气自言自语，也禁止删掉。',
  '   · 旁白：`旁白：……`。背景交代、时间地点、因果铺垫、人物前史（如父母双亡、供女友考研）、开场钩子、章末悬念用旁白讲。系统 / 手机 / 广播等非人物声音写成 `系统（画外音）：……`、`短信（画外音）：……`。',
  '3. 开场 3 秒钩子：小说若有卷首语 / 简介式开头（「杀伐果断，绝对利己……」），改成开场旁白 + 高能画面蒙太奇，不要直接跳过。没有的话，用本章最强的冲突或悬念做一句开场旁白。',
  '4. 每场结尾写清人物去向或情绪落点（骑车离开、关门、转身），下一场开头写清怎么到的（到达、进门），给转场留抓手。章末留悬念（旁白或定格画面）。',
  '5. 场次按「时间或地点变化」划分；一场戏里内容多就写多，不要为了少出镜头而删内容。',
  '6. 不编造：只改编原文已有的情节、人物和对话。原文在哪里结束，剧本就在哪里结束；不要续写后面的剧情，不要新增原文没有的事件、道具或人物关系。允许新增的只有：一句开场钩子旁白、一句章末悬念旁白，以及把原文的叙述改写成旁白 / 内心OS 时的措辞调整。',
  '7. 台词、旁白、系统音的文字里不要带【】〔〕这类括号和「滴滴」之外的符号标记——视频模型会把它们当成屏幕上的字渲染出来。',
  '',
  '二、分镜节奏（剧本 → 分镜）',
  '1. 一场戏拆成多个镜头，不是一场一镜。常规一场 3–8 镜：建立镜头（交代环境与人物位置）→ 动作 / 对白镜头（按情绪节拍切）→ 反应镜头 / 特写 → 收尾镜头（人物离开或情绪定格）。3000 字左右的一章通常 15–30 镜。',
  '2. 单镜时长 4–10 秒为主，纯反应 / 插入特写 3–4 秒，只有口播很长的镜头才到 12–15 秒。时长 ≈（台词 + 旁白字数）÷ 4.5 + 动作缓冲 1–2 秒；禁止拖长：上限 = 字数 ÷ 4 + 4 秒，没有口播的纯画面镜头不超过 8 秒（超了会被拒绝）。一句十来个字的话只要 4–5 秒。',
  '3. 台词和旁白一句都不许为了凑时长而删改：一镜放不下（字数 > 时长 × 5）就拆成两镜，或延长该镜。分镜里 dialogue + narration 的总字数要覆盖剧本台词 + 旁白的 85% 以上。',
  '4. narration 字段必须用起来：剧本里的 `旁白：`、`（内心OS）`、`（画外音）` 行全部写进对应镜头的 narration，每行保留前缀（`旁白：…` / `林冬（内心OS）：…` / `系统（画外音）：…`）；角色开口说的话才写进 dialogue。一个镜头可以只有 narration 没有 dialogue（旁白盖在画面上）。',
  '5. 旁白 / 前史要配画面：讲前史、回忆、背景时出「蒙太奇 / 闪回镜头」（如车祸现场的遗像、深夜送快递、给女友转账），不要让人物干站着听旁白。',
  '6. 转场必须设计，禁止硬切：',
  '   · 换场后的第一个镜头是建立镜头：先 1–2 秒新环境全景（时间、天气、光线、地标），人物再入画或被镜头找到；scene_name 换了就必须这样开。',
  '   · 上一场最后一镜的落幅与下一场第一镜的起幅要有关联：动作接续（骑车出画 → 骑车入画）、视线 / 声音先入（先听到喇叭声 / 门铃声再切）、相似形匹配（烟头火星 → 城市霓虹）、或旁白搭桥（「当晚，江边。」）。在两镜的 sub_shots 里把这个关联写出来。',
  '   · 时间跳跃用空镜（天色变化、时钟、城市夜景）+ 旁白过渡。',
  '7. 同场景相邻镜头：起幅 = 上一镜落幅（人物位置、朝向、手里拿的东西、光线一致），景别要有变化（全 → 中 → 近 → 特写交替），不要连续几镜同一景别同一机位。',
  '8. sub_shots 按时间轴写（`0-3s：…；3-6s：…`），每段写清：景别 + 运镜 + 环境 / 光线 + 人物在画面中的位置和朝向 + 具体动作和表情 + 这段里谁说哪句话（或哪句旁白响起）。',
  '',
  '三、视频提示词（分镜 → video_prompt）',
  '1. 先交代画面再讲动作：开头一句写清时间、地点、天气、主光源与色调、关键陈设（场景参考图只管样子，镜头里发生的环境细节要写出来：热浪扭曲的路面、霓虹倒影、感应灯忽明忽暗）。',
  '2. 每个时间段都要有：景别、机位 / 运镜、前景和背景各有什么、人物位置朝向、带力度的动作、表情变化、环境音 / 音效。禁止只写「他站着说话」。',
  '3. 镜头首尾要写：`The shot opens on …`（起幅，对应上一镜落幅或建立镜头）和 `The shot ends on …`（落幅，给下一镜接）。换场第一镜以环境全景起幅。',
  '4. 声音写法（原文台词保持中文、放在引号里）：',
  '   · 对白：写谁说、带什么情绪和语速、嘴在动。',
  '   · 内心独白：写成 `voice-over of <角色> inner thoughts, his/her lips stay closed and do not move, the voice sounds close and intimate: "……"`，同时描述他此刻的表情和小动作。',
  '   · 旁白：写成 `off-screen narrator voice-over (calm, deep storytelling voice, no one on screen is speaking, all lips stay closed): "……"`。全片旁白用同一句音色描述，保持一致。',
  '   · 系统 / 电子音：写成 `off-screen synthetic system voice with a cold robotic electronic tone: "……"`，并配全息光幕 / 屏幕亮起等画面。',
  '   · 镜头里 narration 和 dialogue 的每一句都必须原文出现在提示词里，按时间先后排进对应时间段，不得遗漏、不得改写。',
  '5. 人物长相和服装不要写（参考图已带，应用出片时会自动加一句「服装发型与参考图完全一致」的锁定）。人物在做什么、情绪如何、环境如何必须写足。提示词长度以把以上内容写全为准，一般 150–300 个英文词。',
  '9. 参考素材一律用「双花括号 + 资产名」指代：`{{林冬}}`、`{{沈婉月}}`、`{{小区走廊}}`、`{{手机}}`，角色的声音参考写 `{{林冬的声音}}`。应用在出片时自动换成模型认的编号，所以不要写 __MINIMAX_H3_REF_N__、<Picture N> 这类编号（技能文档里的编号写法在本应用里都换成花括号）。花括号里的名字必须是这一镜已绑定的资产；画面里出现的每个角色都要绑定并用花括号指代——没绑定的角色模型会自己编一个长相和衣服。',
  '6. 固定声线：在人物圣经里建一张「声线表」——每个会出声的角色、旁白、系统音各一句固定的声线描述（年龄段与性别、音域音色、常态语速音量、句尾习惯、禁止的腔调）。之后每条提示词里逐字复制同一句，当下的情绪只写在这一句台词的表演里。这样同一个人、同一个旁白在不同镜头里声音不漂。',
  '7. 台词和旁白里不用省略号：迟疑、被打断、欲言又止写成可见的动作、呼吸或对方插话。同一时刻只有一个声音在说，听的人闭嘴并给出由这句话触发的反应。',
  '8. 每条提示词最后一句交代末帧：人物位置、姿态、视线、手里的东西；同场景下一镜从这个状态完整复位，不要只写「承接上一镜」。',
].join('\n');

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
