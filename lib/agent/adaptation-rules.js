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
  '1. 信息不丢：小说里的每个情节点、关键心理活动、背景交代、伏笔都要在剧本里有对应内容。禁止把一章压缩成梗概；剧本的台词 + 旁白总字数一般不少于小说正文的 40%。',
  '2. 三种声音都要用，并且写成可以直接配音的独立行：',
  '   · 对白：`人物名（情绪/动作）：台词`，角色开口说话。',
  '   · 内心独白：`人物名（内心OS）：……`。小说里人物心里想的话（「算了，惹不起还躲不起吗」「等老子有钱了……」）一律写成内心OS，嘴不动、声音是画外音。禁止改成角色对着空气自言自语，也禁止删掉。',
  '   · 旁白：`旁白：……`。背景交代、时间地点、因果铺垫、人物前史（如父母双亡、供女友考研）、开场钩子、章末悬念用旁白讲。系统 / 手机 / 广播等非人物声音写成 `系统（画外音）：……`、`短信（画外音）：……`。',
  '3. 开场 3 秒钩子：小说若有卷首语 / 简介式开头（「杀伐果断，绝对利己……」），改成开场旁白 + 高能画面蒙太奇，不要直接跳过。没有的话，用本章最强的冲突或悬念做一句开场旁白。',
  '4. 每场结尾写清人物去向或情绪落点（骑车离开、关门、转身），下一场开头写清怎么到的（到达、进门），给转场留抓手。章末留悬念（旁白或定格画面）。',
  '5. 场次按「时间或地点变化」划分；一场戏里内容多就写多，不要为了少出镜头而删内容。',
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
  '5. 人物外貌 / 服装不要写（参考图已带），但人物在做什么、情绪如何、环境如何必须写足。提示词长度以把以上内容写全为准，一般 150–300 个英文词。',
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
