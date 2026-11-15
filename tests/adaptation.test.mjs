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
