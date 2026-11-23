import { test } from 'node:test';
import assert from 'node:assert';
import { voiceStats, narrationChars, narrationSentences, dialogueChars, sceneCount, promptHasLine } from '../lib/agent/adaptation-rules.js';

test('剧本声音行解析：对白 / 旁白 / 内心OS / 系统音分开计数，场头和说明行不算', () => {
  const script = [
    '【第1场｜傍晚｜十字路口】',
    '出场人物：林冬、司机',
    '场景/动作描述：热浪扭曲路面。',
    '旁白：七月的江城，热得像蒸笼。',
    '林冬（内心OS）：算了，惹不起还躲不起吗。',
    '系统（画外音）：【滴！绑定成功】',
    '沈婉月（掩鼻）：离我远点！',
    '【第2场｜夜｜江边】',
  ].join('\n');
  const v = voiceStats(script);
  assert.strictEqual(v.dialogue, 4);
  assert.strictEqual(v.narrationLines.length, 3);
  assert.ok(v.story > 0 && v.story < v.narration); // 系统音不算「讲故事的声音」
  assert.strictEqual(sceneCount(script), 2);
});

test('分镜 narration / dialogue 字数与句子提取', () => {
  assert.strictEqual(narrationChars('旁白：你好，世界。\n林冬（内心OS）：算了'), 6);
  assert.strictEqual(narrationChars('不带前缀的口播稿'), 8);
  assert.deepStrictEqual(narrationSentences('旁白：你好。\n\n林冬（内心OS）：算了'), ['你好。', '算了']);
  assert.strictEqual(dialogueChars('林冬（冷笑）：滚。'), 1);
});

test('视频提示词是否带上了某句台词（忽略标点）', () => {
  const p = 'Off-screen narrator voice-over: "在这座钢筋水泥的森林里，父母走后，赵雨菲是他唯一的指望。"';
  assert.ok(promptHasLine(p, '在这座钢筋水泥的森林里，父母走后，赵雨菲是他唯一的指望。现在，指望也没了。'));
  assert.ok(!promptHasLine(p, '日子没法过了。'));
});

test('技能模式：画风选视觉档位；适配说明只讲接口（花括号参考、Ref2VA、不提问）', async () => {
  const { visualTierOf, buildSkillAdapter } = await import('../lib/agent/adaptation-rules.js');
  assert.equal(visualTierOf('YHKT科幻国漫 semi-realistic 3D Chinese animation'), '默认 3DCG 档');
  assert.equal(visualTierOf('写实真人电影'), '真人电影档');
  assert.equal(visualTierOf('二次元三渲二'), '游戏内三渲二实机建模档');
  const t = buildSkillAdapter({ style: 'YHKT科幻国漫', styleDetailText: '', webSearch: false });
  for (const k of ['{{林冬}}', '{{林冬的声音}}', 'Ref2VA', '不要停下来提问', 'update_shot', '正面大头照', 'lips remain completely closed']) assert.ok(t.includes(k), k);
  assert.ok(!/30%|建立镜头|禁止硬切/.test(t));
});

test('{{资产名}} 占位符按实际参考顺序换成编号；没绑定的名字退回纯文字', async () => {
  const { resolveNamedRefs, namedRefTokens } = await import('../lib/agent/adaptation-rules.js');
  const refs = [{ type: 'image', name: '王胜' }, { type: 'image', name: '沈婉月' }, { type: 'image', name: '小区走廊' }, { type: 'audio', name: '王胜的声音' }];
  const r = resolveNamedRefs('{{沈婉月}} clings to {{王胜}} in {{小区走廊}}; voice {{王胜的音色}}; {{路人}} passes', refs);
  assert.strictEqual(r.prompt, '__MINIMAX_H3_REF_2__ clings to __MINIMAX_H3_REF_1__ in __MINIMAX_H3_REF_3__; voice __MINIMAX_H3_REF_4__; 路人 passes');
  assert.deepStrictEqual(r.unresolved, ['路人']);
  assert.deepStrictEqual(namedRefTokens('{{林冬}} and {{ 林冬 }} and {{手机}}'), ['林冬', '手机']);
});

test('精简模式：按模板自动拼视频提示词——台词、内心独白、旁白、系统音各有固定写法，顺序跟 lines 一致', async () => {
  const { composeVideoPrompt, splitLines, parseVoiceLine, promptHasLine } = await import('../lib/agent/adaptation-rules.js');
  const lines = '沈婉月（嫌恶）：离我远点！\n林冬（内心OS）：算了。\n旁白：他知道，麻烦才刚开始。\n系统（画外音）：倒计时五小时。\n司机（画外音，暴躁）：滚远点！';
  const p = composeVideoPrompt(
    { duration: 9, visual: '夜，电梯厅。', sub_shots: '0-4s：双人中景。', lines },
    { characters: [{ name: '林冬', voice_desc: '青年男性，低沉' }, { name: '沈婉月', voice_desc: '青年女性，尖亮' }], scenes: [{ name: '电梯厅' }], style: '国漫' },
  );
  for (const l of ['离我远点！', '算了。', '他知道，麻烦才刚开始。', '倒计时五小时。', '滚远点！']) assert.ok(promptHasLine(p, l), l);
  assert.ok(p.indexOf('离我远点') < p.indexOf('算了') && p.indexOf('算了') < p.indexOf('他知道'));
  assert.ok(/沈婉月 speaks aloud with lip sync \(voice reference \{\{沈婉月的声音\}\}.*tone: 嫌恶/.test(p));
  assert.ok(/Inner-thought voice-over of 林冬, his or her lips stay closed/.test(p));
  assert.ok(/Off-screen narrator voice-over/.test(p) && /Off-screen synthetic system voice/.test(p));
  assert.ok(p.includes('{{林冬}}') && p.includes('{{电梯厅}}'));
  assert.ok(!/是沈婉月/.test(p)); // 中文说明句会被模型念出来
  assert.deepStrictEqual(splitLines(lines), { dialogue: '沈婉月（嫌恶）：离我远点！', narration: '林冬（内心OS）：算了。\n旁白：他知道，麻烦才刚开始。\n系统（画外音）：倒计时五小时。\n司机（画外音，暴躁）：滚远点！' });
  assert.strictEqual(parseVoiceLine('司机（画外音，暴躁）：滚远点！').emotion, '暴躁');
});

test('画风库：名字展开成风格关键词，自定义风格不展开', async () => {
  const { STYLE_LIBRARY, styleDetail } = await import('../lib/shared/index.js');
  const fs = await import('node:fs');
  assert.ok(STYLE_LIBRARY.length >= 12);
  assert.ok(styleDetail('YHKT科幻国漫').includes('3D'));
  assert.strictEqual(styleDetail('我自己写的风格'), '');
  // 内置预览图：选择器里写死的那批必须有文件；新加的题材画风由用户在选择器里用自己的出图模型生成
  const picker = fs.readFileSync(new URL('../studio/src/components/StylePicker.jsx', import.meta.url), 'utf8');
  const builtin = JSON.parse('[' + /BUILTIN_PREVIEWS = new Set\(\[([^\]]*)\]/.exec(picker)[1].replace(/'/g, '"') + ']');
  for (const id of builtin) assert.ok(fs.existsSync(new URL('../studio/public/styles/' + id + '.jpg', import.meta.url)), id + ' 缺预览图');
});

test('流式进度：模型长时间写一个工具参数时每 30 秒汇报一次已生成字数', async () => {
  const { createStreamMeter } = await import('../lib/agent/openclaude-agent.js');
  let t = 0; const got = [];
  const m = createStreamMeter((r) => got.push(r.detail), { now: () => t });
  assert.equal(m({ type: 'assistant' }), false);
  m({ type: 'stream_event', event: { type: 'message_start' } });
  m({ type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'tool_use', name: 'mcp__ic__set_chapter_script' } } });
  for (let i = 0; i < 10; i++) { t += 10000; m({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: 'x'.repeat(100) } } }); }
  assert.equal(got.length, 3);
  assert.match(got[0], /set_chapter_script/);
  assert.match(got[2], /1000 字符|900 字符/);
});

test('人物图统一版式：删掉旧的左 1/3 特写 / 右 2/3 三视图 / 两栏，追加「上方大头照 + 下方无头三视图」', async () => {
  const { applyCharacterSheet, SKILL_CHARACTER_SHEET_LAYOUT } = await import('../lib/agent/adaptation-rules.js');
  const p = '竖版9:16人物设定图，纯白背景。画面左侧三分之一是一张极近面部特写。26岁女性，鹅蛋脸，杏眼。画面右侧三分之二从左到右并排同一人物的正面全身、侧面全身、背面全身三视图。白衬衫，黑色平底鞋。';
  const out = applyCharacterSheet(p);
  const body = out.split(SKILL_CHARACTER_SHEET_LAYOUT)[0];
  assert.ok(!/三视图|三分之一|三分之二/.test(body), out);
  assert.match(body, /26岁女性，鹅蛋脸，杏眼/);
  assert.match(body, /白衬衫，黑色平底鞋/);
  assert.ok(out.endsWith(SKILL_CHARACTER_SHEET_LAYOUT));
  assert.match(SKILL_CHARACTER_SHEET_LAYOUT, /上方约 40% 区域为同一人物的正面大头照/);
  assert.match(SKILL_CHARACTER_SHEET_LAYOUT, /不露头、下巴和面部/);
  // 已经是新版式的不重复追加
  assert.equal(applyCharacterSheet(out), out);
});

test('非写实画风：去写实词、画风锚点、视频画风锁', async () => {
  const ar = await import('../lib/agent/adaptation-rules.js');
  const sh = await import('../lib/shared/index.js');
  const p = ar.stripRealismTerms('青年男性，次表面散射，微距可见毛孔，photorealistic skin pores，短发', '3D动画电影');
  assert.ok(!/毛孔|次表面|photorealistic|微距/.test(p), p);
  assert.ok(p.includes('青年男性') && p.includes('短发'));
  assert.equal(ar.stripRealismTerms('真人写实，可见毛孔', '真人写实'), '真人写实，可见毛孔');
  assert.match(sh.styleAnchor('3D动画电影'), /^画风：3D动画电影，三维动画风格/);
  assert.match(sh.styleNegative('3D动画电影'), /photorealistic/);
  assert.equal(sh.styleNegative('真人写实'), '');
  assert.match(ar.videoStyleLock('3D动画电影'), /Visual style lock: fully stylized 3D CG/);
  assert.equal(ar.videoStyleLock('真人写实'), '');
  assert.match(ar.stylizedRule('日系动漫风'), /二维动画/);
});
