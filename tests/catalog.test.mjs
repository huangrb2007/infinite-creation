import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeApiWorkflow, isApiFormat } from '../lib/core/catalog/analyze.js';
import { classifyPath } from '../lib/core/catalog/comfy-source.js';
import { poolWorkflowToSpec } from '../lib/core/catalog/pool-source.js';
import { uiToApi } from '../lib/core/catalog/ui-to-api.js';
import { secondsToPoolFrames } from '../lib/core/catalog/pool-client.js';
import { buildWorkflow } from '../lib/core/workflow-runner.js';
import { getDefaultSpecById } from '../lib/core/workflow-specs.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const wf = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'workflows', f), 'utf8'));

// 自动识别结果应与仓库里手写的规格一致（同一份工作流）
const SAME_AS_HANDWRITTEN = [
  ['MiniMax_H3_Easy_r2v.json', 'minimax_h3_r2v', ['positive_prompt', 'seconds', 'resolution', 'aspect_ratio', 'width', 'height', 'seed']],
  ['image_qwen_image_2_1_t2i_api.json', 'qwen_image_2_1_t2i_api', ['positive_prompt', 'negative_prompt', 'width', 'height', 'seed']],
  ['image_qwen_image_2_1_image_edit_api.json', 'qwen_image_2_1_i2i_api', ['positive_prompt', 'negative_prompt', 'image', 'seed']],
  ['qwen3_tts_voice_design.json', 'qwen3_tts_voice_design', ['text', 'voice_description', 'seed']],
  ['Qwen3-TTS_Voice_Clone_Reference.json', 'qwen3_tts_voice_clone', ['text', 'ref_audio', 'seed']],
  ['audio_minimax_music_3.json', 'minimax_music3', ['caption', 'lyrics', 'max_duration', 'seed']],
];

for (const [file, specId, roles] of SAME_AS_HANDWRITTEN) {
  test('自动识别与手写规格一致：' + file, () => {
    const json = wf(file);
    assert.ok(isApiFormat(json));
    const hand = getDefaultSpecById(specId);
    const a = analyzeApiWorkflow(json, { name: file });
    assert.strictEqual(a.category, hand.kind);
    for (const r of roles) {
      assert.deepStrictEqual({ node: a.roles[r]?.node, field: a.roles[r]?.field }, { node: hand.roles[r].node, field: hand.roles[r].field }, r);
    }
    assert.ok(a.ready, a.issues.join('；'));
  });
}

test('节点标题标签优先于自动识别', () => {
  const json = {
    1: { class_type: 'CLIPTextEncode', inputs: { text: 'a' }, _meta: { title: '备用' } },
    2: { class_type: 'CLIPTextEncode', inputs: { text: 'b' }, _meta: { title: '正向 #prompt' } },
    3: { class_type: 'LoadImage', inputs: { image: 'x.png' }, _meta: { title: '参考 #image2' } },
    4: { class_type: 'LoadImage', inputs: { image: 'y.png' }, _meta: { title: '参考 #image1' } },
    5: { class_type: 'SaveImage', inputs: { filename_prefix: 'o', images: ['6', 0] } },
  };
  const a = analyzeApiWorkflow(json, { category: 'i2i' });
  assert.strictEqual(a.roles.positive_prompt.node, '2');
  assert.deepStrictEqual(a.slots.image.map((s) => s.node), ['4', '3']);
});

test('云端文件夹归类：按你的字母前缀文件夹', () => {
  assert.strictEqual(classifyPath('U视频-MINIMAX-H3/U01-minimax_h3_多图参考生视频基础版.json').category, 'r2v');
  assert.strictEqual(classifyPath('U视频-MINIMAX-H3/U47-TaoMateHD数字人.json').category, 'digital_human');
  assert.strictEqual(classifyPath('N声音生成-音乐生成-声音克隆/N06-Qwen3TTS音频克隆.json').category, 'tts_clone');
  assert.strictEqual(classifyPath('N声音生成-音乐生成-声音克隆/N08-MiniMax_Music3基础工作流.json').category, 'music');
  assert.strictEqual(classifyPath('J视频-对口型数字人/J04-对口型-InfiniteTalk单人图像驱动.json').category, 'digital_human');
  assert.strictEqual(classifyPath('P视频-动作迁移/P15-动作迁移-Wan2.2-Animate-动作迁移V7.1.json').category, 'motion');
  assert.strictEqual(classifyPath('M高清放大去水印/M01-放大-SUPIR高清放大.json').skip, true);
  assert.strictEqual(classifyPath('U视频-MINIMAX-H3/U01-x.json').series, 'U');
});

test('号池目录转规格：映射、素材槽、帧数换算', () => {
  const spec = poolWorkflowToSpec({
    id: 'w1', name: 'H3 全能参考', kind: 'video', revision: 'r1',
    mapping: { prompt: '12:text', duration: '30:length', seed: '25:seed', aspectRatio: '42:aspect_ratio' },
    schema: [
      { nodeId: '12', fieldName: 'text', fieldType: 'STRING', fieldValue: '' },
      { nodeId: '30', fieldName: 'length', fieldType: 'INT', fieldValue: 121 },
      { nodeId: '25', fieldName: 'seed', fieldType: 'INT', fieldValue: 1 },
      { nodeId: '42', fieldName: 'aspect_ratio', fieldType: 'LIST', fieldValue: '16:9 (Widescreen)' },
      { nodeId: '7', fieldName: 'image', fieldType: 'IMAGE' },
      { nodeId: '8', fieldName: 'image', fieldType: 'IMAGE' },
    ],
  });
  assert.strictEqual(spec.category, 'r2v');
  assert.strictEqual(spec.backend, 'pool');
  assert.strictEqual(spec.slots.image.length, 2);
  const built = buildWorkflow(spec, {
    positive_prompt: 'hi', seconds: 13.7, aspect_ratio: '9:16', seed: 5,
    references: [{ type: 'image', filename: 'asset:a' }, { type: 'image', filename: 'asset:b' }, { type: 'image', filename: 'asset:c' }],
  });
  assert.strictEqual(built['30'].inputs.length, 329);
  assert.strictEqual(built['42'].inputs.aspect_ratio, '9:16 (Portrait Widescreen)');
  assert.strictEqual(built['7'].inputs.image, 'asset:a');
  assert.strictEqual(built['8'].inputs.image, 'asset:b');
  assert.strictEqual((secondsToPoolFrames(5) - 1) % 8, 0);
});

test('界面格式转换：子图展开、Primitive、Reroute、静音节点', () => {
  const ui = {
    nodes: [
      { id: 1, type: 'PrimitiveNode', mode: 0, widgets_values: ['你好'], outputs: [{ links: [1] }] },
      { id: 2, type: 'Reroute', mode: 0, inputs: [{ name: '', link: 1 }], outputs: [{ links: [2] }] },
      { id: 3, type: 'sg-1', mode: 0, inputs: [{ name: 'text', link: 2 }], outputs: [{ links: [3] }] },
      { id: 4, type: 'SaveText', mode: 0, inputs: [{ name: 'text', link: 3 }], widgets_values: ['out'] },
      { id: 5, type: 'SaveText', mode: 2, inputs: [], widgets_values: ['muted'] },
    ],
    links: [[1, 1, 0, 2, 0, 'STRING'], [2, 2, 0, 3, 0, 'STRING'], [3, 3, 0, 4, 0, 'STRING']],
    definitions: {
      subgraphs: [{
        id: 'sg-1',
        inputs: [{ name: 'text', linkIds: [10] }],
        outputs: [{ name: 'out', linkIds: [11] }],
        nodes: [{ id: 7, type: 'Upper', mode: 0, inputs: [{ name: 'text', widget: { name: 'text' }, link: 10 }], widgets_values: ['', 42, 'randomize'] }],
        links: [{ id: 10, origin_id: -10, origin_slot: 0, target_id: 7, target_slot: 0 }, { id: 11, origin_id: 7, origin_slot: 0, target_id: -20, target_slot: 0 }],
      }],
    },
  };
  const oi = {
    Upper: { input: { required: { text: ['STRING'], seed: ['INT', {}] } }, input_order: { required: ['text', 'seed'] } },
    SaveText: { input: { required: { filename_prefix: ['STRING'], text: ['STRING', { forceInput: true }] } }, input_order: { required: ['filename_prefix', 'text'] } },
  };
  const { prompt, issues } = uiToApi(ui, oi);
  assert.deepStrictEqual(issues, []);
  assert.deepStrictEqual(Object.keys(prompt).sort(), ['3:7', '4']);
  assert.strictEqual(prompt['3:7'].inputs.text, '你好');
  assert.strictEqual(prompt['3:7'].inputs.seed, 42);
  assert.deepStrictEqual(prompt['4'].inputs.text, ['3:7', 0]);
  assert.strictEqual(prompt['4'].inputs.filename_prefix, 'out');
});

test('Zealman 选参考节点：参考图写进 ref_image_N 字段，没用到的清空', () => {
  const wf = {
    403: { class_type: 'ZealmanH3PickReferenceMedia', inputs: { prompt: 'p', seconds: 10, aspect_ratio: '16:9 (Widescreen)', ref_image_0: 'a.png', ref_image_1: 'b.png' } },
    265: { class_type: 'MiniMaxH3ReferenceToVideo', inputs: { prompt: ['403', 0] } },
    397: { class_type: 'SelfLiftH3Sampler', inputs: { seed: 1, positive: ['265', 0] } },
    364: { class_type: 'VHS_VideoCombine', inputs: { filename_prefix: 'x', images: ['397', 0] } },
  };
  const a = analyzeApiWorkflow(wf, { category: 'r2v' });
  assert.strictEqual(a.family, 'Zealman H3 选参考');
  assert.deepStrictEqual(a.roles.positive_prompt, { node: '403', field: 'prompt' });
  const built = buildWorkflow({ ...a, id: 't', template: wf, outputs: a.outputs }, {
    positive_prompt: 'new', seconds: 6, aspect_ratio: '9:16',
    references: [{ type: 'image', filename: 'c.png' }],
  });
  assert.strictEqual(built['403'].inputs.prompt, 'new');
  assert.strictEqual(built['403'].inputs.aspect_ratio, '9:16 (Portrait Widescreen)');
  assert.strictEqual(built['403'].inputs.ref_image_0, 'c.png');
  assert.strictEqual(built['403'].inputs.ref_image_1, '');
  assert.ok(built['364']);
});
