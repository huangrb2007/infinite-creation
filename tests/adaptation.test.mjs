import { test } from 'node:test';
import assert from 'node:assert';
import { voiceStats, narrationChars, narrationSentences, dialogueChars, sceneCount, promptHasLine, ADAPTATION_RULES } from '../lib/agent/adaptation-rules.js';

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

test('改编规范包含旁白、转场、拆镜三块硬要求', () => {
  for (const k of ['内心OS', '建立镜头', '禁止硬切', 'narration 字段必须用起来', '固定声线']) assert.ok(ADAPTATION_RULES.includes(k), k);
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
  for (const s of STYLE_LIBRARY) assert.ok(fs.existsSync(new URL('../studio/public/styles/' + s.id + '.jpg', import.meta.url)), s.id + ' 缺预览图');
});
