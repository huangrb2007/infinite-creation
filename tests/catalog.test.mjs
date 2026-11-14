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

test('LLM 接口的图片模型出现在文生图 / 图生图类别，并按 OpenAI images 接口提交', async () => {
  const { apiImageSpecs, runApiImage } = await import('../lib/core/catalog/api-image.js');
  const { classifyModel } = await import('../lib/core/llm.js');
  assert.strictEqual(classifyModel('gpt-image-1'), 'image');
  assert.strictEqual(classifyModel('qwen2.5-vl-72b'), 'vision');
  assert.strictEqual(classifyModel('deepseek/deepseek-v4.1-flash'), 'text');
  const cfg = { llm: { baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'k', models: [{ id: 'gpt-image-1', kind: 'image' }, { id: 'x', kind: 'text' }] } };
  const specs = apiImageSpecs(cfg);
  assert.deepStrictEqual(specs.map((s) => s.key), ['api:t2i:gpt-image-1', 'api:i2i:gpt-image-1']);
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    // 先试异步任务路径，OpenAI 官方这类站点会 404，再走 /images/generations
    if (url.endsWith('/image/generations')) return new Response('{"error":{"message":"Invalid URL"}}', { status: 404 });
    return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('png').toString('base64') }] }), { status: 200 });
  };
  try {
    const r = await runApiImage(cfg, specs[0], { positive_prompt: '一只猫', width: 1344, height: 768 });
    assert.strictEqual(calls[1].url, 'http://127.0.0.1:1/v1/images/generations');
    assert.deepStrictEqual(calls[1].body, { model: 'gpt-image-1', prompt: '一只猫', n: 1, size: '1344x768' });
    assert.strictEqual(r.outputs[0].apiData.toString(), 'png');
  } finally { globalThis.fetch = orig; }
});

test('号池生图工作流（参考图可选）同时出现在文生图和图生图', async () => {
  const { withT2iVariant } = await import('../lib/core/catalog/pool-source.js');
  const { categoryOfName } = await import('../lib/core/catalog/categories.js');
  const schema = [{ nodeId: '37', fieldName: 'prompt', fieldValue: '' }];
  for (let i = 101; i <= 103; i++) schema.push({ nodeId: String(i), fieldName: 'image', fieldType: 'IMAGE' });
  const spec = poolWorkflowToSpec({ id: 'q', name: 'Qwen Image 2.1', kind: 'image', schema, mapping: { prompt: '37:prompt' } });
  const list = withT2iVariant(spec);
  assert.deepStrictEqual(list.map((s) => [s.key, s.category, s.ready]), [['pool:q', 'i2i', true], ['pool:q#t2i', 't2i', true]]);
  assert.ok(!list[1].roles.image);
  assert.strictEqual(list[1].pool.id, 'q');
  assert.strictEqual(categoryOfName('SCAIL2视频角色替换工作流_api'), 'motion');
});

test('号池标成视频的角色替换工作流归到动作迁移', () => {
  const spec = poolWorkflowToSpec({ id: 's', name: 'SCAIL2视频角色替换工作流_api', kind: 'video', category: 'r2v',
    schema: [{ nodeId: '1', fieldName: 'image', fieldType: 'IMAGE' }, { nodeId: '2', fieldName: 'video', fieldType: 'VIDEO' }], mapping: {} });
  assert.strictEqual(spec.category, 'motion');
  assert.deepStrictEqual(spec.roles.character, { node: '1', field: 'image' });
});

test('LLM 接口图片模型：异步任务协议（提交 + 轮询 + 上传参考图），不支持时退回 OpenAI 协议', async () => {
  const http = await import('node:http');
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { runApiImage } = await import('../lib/core/catalog/api-image.js');
  const seen = [];
  const mk = (taskMode) => http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push(req.method + ' ' + req.url + ' ' + (req.headers['content-type'] || '').split(';')[0] + ' ' + (body.startsWith('{') ? body : ''));
      res.setHeader('Content-Type', 'application/json');
      if (!taskMode && req.url === '/v1/image/generations') { res.statusCode = 404; return res.end('{"error":{"message":"Invalid URL"}}'); }
      if (req.url === '/v1/files/upload') return res.end('{"url":"https://cdn.example/ref.png"}');
      if (req.url === '/v1/image/generations') return res.end('{"task_id":"t1","status":"queued"}');
      if (req.url === '/v1/image/generations/t1') return res.end('{"code":"success","data":{"status":"SUCCESS","result_url":"https://cdn.example/out.png"}}');
      if (req.url === '/v1/images/generations') return res.end('{"data":[{"url":"https://cdn.example/oa.png"}]}');
      res.statusCode = 404; res.end('{}');
    });
  });
  const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));
  const ref = path.join(os.tmpdir(), 'ic-ref-test.png');
  fs.writeFileSync(ref, Buffer.from([1, 2, 3]));

  const a = mk(true);
  const pa = await listen(a);
  const cfgA = { llm: { baseUrl: 'http://127.0.0.1:' + pa + '/v1', apiKey: 'k' } };
  const r1 = await runApiImage(cfgA, { model: 'img', category: 'i2i' }, { positive_prompt: '猫', image: ref, width: 1920, height: 1080 });
  assert.strictEqual(r1.outputs[0].apiUrl, 'https://cdn.example/out.png');
  const submit = seen.find((s) => s.startsWith('POST /v1/image/generations '));
  assert.ok(submit.includes('"size":"16:9"') && submit.includes('"resolution":"2k"') && submit.includes('"images":["https://cdn.example/ref.png"]'), submit);
  a.close();

  seen.length = 0;
  const b = mk(false);
  const pb = await listen(b);
  const r2 = await runApiImage({ llm: { baseUrl: 'http://127.0.0.1:' + pb + '/v1' } }, { model: 'img', category: 't2i' }, { positive_prompt: '猫' });
  assert.strictEqual(r2.outputs[0].apiUrl, 'https://cdn.example/oa.png');
  assert.ok(seen.some((s) => s.startsWith('POST /v1/images/generations')));
  b.close();
});

test('获取模型列表：用站点目录（/api/pricing）的 tags 和说明分类', async () => {
  const http = await import('node:http');
  const { listLlmModels } = await import('../lib/core/llm.js');
  const srv = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/v1/models') return res.end(JSON.stringify({ data: [{ id: 'deepseek/x' }, { id: 'acme/gm-4' }, { id: 'acme-image-v2' }] }));
    if (req.url === '/api/pricing') return res.end(JSON.stringify({ data: [
      { model_name: 'deepseek/x', tags: 'llm', description: '多模态对话模型，支持文本和图片输入' },
      { model_name: 'acme/gm-4', tags: 'llm', description: '纯文本对话' },
      { model_name: 'acme-image-v2', tags: 'image', display_name: 'Acme Image' },
      { model_name: 'acme-video', tags: 'video,kling' },
    ] }));
    res.statusCode = 404; res.end('{}');
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const { models, site } = await listLlmModels({ baseUrl: 'http://127.0.0.1:' + srv.address().port + '/v1' });
  srv.close();
  assert.deepStrictEqual(models.map((m) => m.id + ':' + m.kind), ['acme-image-v2:image', 'acme/gm-4:text', 'deepseek/x:vision']);
  assert.strictEqual(site.find((m) => m.id === 'acme-video').kind, 'video');
});

test('只用号池 / LLM 接口时：运行前不检查 ComfyUI；没有音色来源时音色阶段跳过', async () => {
  const { kindUnavailable, kindUsesComfy, voiceDesignSkipped } = await import('../lib/core/workflow-specs.js');
  const { preflight } = await import('../lib/agent/stages.js');
  const cfg = {
    comfyui: { baseUrl: 'http://127.0.0.1:1' },
    llm: { baseUrl: 'http://127.0.0.1:1/v1', models: [{ id: 'img', kind: 'image' }] },
    catalog: { cloud: { enabled: false }, selected: { t2i: 'api:t2i:img', i2i: 'api:i2i:img', music: 'none' } },
  };
  assert.strictEqual(kindUsesComfy(cfg, 't2i'), false);
  assert.strictEqual(kindUnavailable(cfg, 'tts'), true);
  assert.strictEqual(voiceDesignSkipped(cfg), true);
  assert.strictEqual(kindUnavailable(cfg, 'music'), true);
  // 资产图 + 音色：都不需要 ComfyUI，不应报「ComfyUI 未就绪」
  const r = await preflight(['image', 'tts'], cfg);
  assert.ok(r);
  // 开着云端读取、又没选：内置工作流要用 ComfyUI → 仍然检查
  const cfg2 = { ...cfg, catalog: { selected: {} } };
  assert.strictEqual(kindUsesComfy(cfg2, 't2i'), true);
  await assert.rejects(preflight(['image'], cfg2), /ComfyUI 未就绪/);
});

test('超时为 0（关了排队调度）表示不限时：LLM 接口出图和号池任务都不能立刻判超时', async () => {
  const { runApiImage } = await import('../lib/core/catalog/api-image.js');
  const { poolGenerate } = await import('../lib/core/catalog/pool-client.js');
  const orig = globalThis.fetch;
  let polls = 0;
  globalThis.fetch = async (url) => {
    url = String(url);
    if (url.endsWith('/v1/image/generations')) return new Response('{"task_id":"t9"}', { status: 200 });
    if (url.endsWith('/v1/image/generations/t9')) return new Response('{"data":{"status":"SUCCESS","result_url":"https://x/a.webp"}}', { status: 200 });
    if (url.endsWith('/v1/jobs')) return new Response('{"id":"j1","status":"QUEUED"}', { status: 200 });
    if (url.endsWith('/v1/jobs/j1')) { polls++; return new Response(JSON.stringify({ id: 'j1', status: polls < 2 ? 'RUNNING' : 'SUCCESS', outputs: [] }), { status: 200 }); }
    return new Response('{}', { status: 404 });
  };
  try {
    const r = await runApiImage({ llm: { baseUrl: 'http://h/v1' } }, { model: 'm', category: 't2i' }, { positive_prompt: '猫' }, { timeoutMs: 0 });
    assert.strictEqual(r.outputs[0].filename.endsWith('.webp'), true);
    const j = await poolGenerate({ baseUrl: 'http://p', key: 'k' }, { workflow: { id: 'w' }, parameters: {} }, { timeoutMs: 0, pollMs: 5 });
    assert.ok(j);
    assert.strictEqual(polls, 2);
  } finally { globalThis.fetch = orig; }
});

test('LLM 接口语音模型作为音色设计来源：按性别年龄挑预置音色', async () => {
  const { apiAudioSpecs, pickPresetVoice } = await import('../lib/core/catalog/api-audio.js');
  const specs = apiAudioSpecs({ llm: { models: [{ id: 'qwen3-tts-flash', kind: 'audio' }, { id: 'suno-generation', kind: 'audio' }] } });
  assert.deepStrictEqual(specs.map((s) => s.key), ['api:tts:qwen3-tts-flash']);
  assert.ok(['Cherry', 'Chelsie', 'Serena'].includes(pickPresetVoice('青年女性，温柔', 'a')));
  assert.ok(['Ethan', 'Kai'].includes(pickPresetVoice('少年男声', 'b')));
  assert.ok(['Eldric Sage', 'Arthur'].includes(pickPresetVoice('老年男性', 'c')));
  assert.strictEqual(pickPresetVoice('小孩，童声'), 'Mochi');
});

test('流式 TTS 的 WAV 头长度占位值被改正', async () => {
  const { fixWavHeader } = await import('../lib/core/catalog/api-audio.js');
  const pcm = Buffer.alloc(4800);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(0xffffffff, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(24000, 24); h.writeUInt32LE(48000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(0x7fffffff, 40);
  const f = fixWavHeader(Buffer.concat([h, pcm]));
  assert.strictEqual(f.readUInt32LE(40), 4800);
  assert.strictEqual(f.readUInt32LE(4), 44 + 4800 - 8);
});

test('号池素材口只认 fieldType 为 IMAGE/AUDIO/VIDEO 的字段，ref_image_size 等普通参数不算', () => {
  const spec = poolWorkflowToSpec({ id: 'h3', name: 'MINIMAX-H3 U39', kind: 'video', schema: [
    { nodeId: '136', fieldName: 'ref_image_size', fieldType: 'STRING', fieldValue: 'match' },
    { nodeId: '148', fieldName: 'trim_to_audio', fieldType: 'BOOLEAN', fieldValue: true },
    { nodeId: '136__story_image_0', fieldName: 'image', fieldType: 'IMAGE' },
    { nodeId: '136__story_audio_0', fieldName: 'audio', fieldType: 'AUDIO' },
  ], mapping: { prompt: '1:text' } });
  assert.deepStrictEqual(spec.slots.image.map((s) => s.node), ['136__story_image_0']);
  assert.deepStrictEqual(spec.slots.audio.map((s) => s.node), ['136__story_audio_0']);
});

test('LLM 接口视频 / 音乐模型按类别归类，请求体按站点格式拼', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { apiMediaSpecs, buildVideoBody, videoFamily, apiRefPrompt } = await import('../lib/core/catalog/api-media.js');
  const { apiImageSpecs } = await import('../lib/core/catalog/api-image.js');
  const models = [
    { id: 'MiniMax-H3', kind: 'video' }, { id: 'seedance-2.0-mini-multi', kind: 'video' }, { id: 'kling-o3-std-r2v', kind: 'video' },
    { id: 'hailuo-2.3-i2v-pro', kind: 'video' }, { id: 'seedance-2.0-mini-t2v', kind: 'video' }, { id: 'kling-v3.0-std-motion', kind: 'video' },
    { id: 'workfisher-upscaler', kind: 'video' }, { id: 'mureka-v9-bgm', kind: 'audio' }, { id: 'suno-generation', kind: 'audio' },
    { id: 'seedream-v5-pro-t2i', kind: 'image' }, { id: 'seedream-v5-pro-i2i', kind: 'image' }, { id: 'midjourney-imagine', kind: 'image' },
  ];
  const specs = apiMediaSpecs({ llm: { models } });
  const cat = (c) => specs.filter((s) => s.category === c).map((s) => s.name + (s.ready ? '' : '?'));
  assert.deepStrictEqual(cat('r2v'), ['MiniMax-H3', 'seedance-2.0-mini-multi', 'kling-o3-std-r2v', 'hailuo-2.3-i2v-pro?', 'seedance-2.0-mini-t2v?']);
  assert.deepStrictEqual(cat('motion'), ['kling-v3.0-std-motion']);
  assert.deepStrictEqual(cat('digital_human'), ['MiniMax-H3']);
  assert.deepStrictEqual(cat('music'), ['mureka-v9-bgm', 'suno-generation']);
  const img = apiImageSpecs({ llm: { models } });
  assert.deepStrictEqual(img.map((s) => s.category + ':' + s.name), ['t2i:seedream-v5-pro-t2i', 'i2i:seedream-v5-pro-i2i']);
  assert.strictEqual(videoFamily('hailuo-2.3-t2v-standard'), 't2v');
  assert.strictEqual(apiRefPrompt('__MINIMAX_H3_REF_1__ 说话，音色 __MINIMAX_H3_REF_2__，场景 __MINIMAX_H3_REF_3__', [{ type: 'image' }, { type: 'audio' }, { type: 'image' }]), '@Image 1 说话，音色 @Audio 1，场景 @Image 2');

  // 参考素材是「本地文件」标记，拼请求体时上传换直链
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ic-api-'));
  const a = path.join(dir, 'a.png'); fs.writeFileSync(a, 'x');
  const b = path.join(dir, 'b.wav'); fs.writeFileSync(b, 'y');
  const lazy = (p) => '@@ic-local:' + JSON.stringify([p, path.basename(p)]);
  const orig = globalThis.fetch;
  let n = 0;
  globalThis.fetch = async () => new Response(JSON.stringify({ url: 'https://cdn/' + (++n) }), { status: 200 });
  try {
    const cfg = { llm: { baseUrl: 'http://h/v1' } };
    const refs = [{ type: 'image', filename: lazy(a) }, { type: 'audio', filename: lazy(b) }];
    const h3 = await buildVideoBody(cfg, specs.find((s) => s.name === 'MiniMax-H3' && s.category === 'r2v'), { positive_prompt: '__MINIMAX_H3_REF_1__', seconds: 11, resolution: '720P', aspect_ratio: '9:16', references: refs });
    assert.strictEqual(h3.duration, 11);
    assert.strictEqual(h3.resolution, '768P');
    assert.deepStrictEqual(h3.metadata.h3_request.content.map((c) => c.role || c.type), ['text', 'reference_image', 'reference_audio']);
    assert.strictEqual(h3.metadata.h3_request.ratio, '9:16');
    const dh = await buildVideoBody(cfg, specs.find((s) => s.category === 'digital_human'), { positive_prompt: 'x', seconds: 30, references: refs });
    assert.deepStrictEqual(dh.metadata.h3_request.content.map((c) => c.role || c.type), ['text', 'reference_image', 'drive_audio']);
    assert.strictEqual(dh.metadata.h3_request.audio_control.mode, 'lock_source');
    const multi = await buildVideoBody(cfg, specs.find((s) => s.name === 'seedance-2.0-mini-multi'), { positive_prompt: 'x', seconds: 5, resolution: '480P', references: refs });
    assert.deepStrictEqual(multi.metadata.content.map((c) => c.type), ['image_url', 'audio_url']);
    assert.strictEqual(multi.seconds, '5');
    const r2v = await buildVideoBody(cfg, specs.find((s) => s.name === 'kling-o3-std-r2v'), { positive_prompt: 'x', seconds: 5, references: refs });
    assert.strictEqual(r2v.images.length, 1);
  } finally { globalThis.fetch = orig; }
});

test('H3 ComfyUI 系模型的请求格式；站点报不允许的分辨率 / 比例 / 时长时按消息自动改成最接近的', async () => {
  const { videoFamily, fixBodyFromError, apiRefPrompt, nearestOf } = await import('../lib/core/catalog/api-media.js');
  assert.strictEqual(videoFamily('minimax-h3-comfyui-max-10020'), 'h3comfy');
  assert.strictEqual(apiRefPrompt('__MINIMAX_H3_REF_1__ 说 __MINIMAX_H3_REF_2__', [{ type: 'image' }, { type: 'audio' }], 'angle'), '<Picture 1> 说 <Audio 1>');
  assert.strictEqual(apiRefPrompt('__MINIMAX_H3_REF_2__', [{ type: 'image' }, { type: 'audio' }], 'angle-noaudio'), '参考音频 1');
  assert.strictEqual(nearestOf('1080p', ['480p', '608p', '768p']), '768p');
  assert.strictEqual(nearestOf('4:3', ['16:9', '9:16'], 'ratio'), '16:9');
  const b = { model: 'x', prompt: 'p', seconds: '11', metadata: { resolution: '720p', ratio: '21:9' } };
  assert.ok(fixBodyFromError(b, 'Aspect ratio must be 16:9 or 9:16 and resolution one of 480p, 608p, 768p, 672p'));
  assert.deepStrictEqual(b.metadata, { resolution: '768p', ratio: '16:9' });
  const c = { model: 'x', prompt: 'p', seconds: '11', metadata: {} };
  assert.ok(fixBodyFromError(c, 'seconds must be one of 5, 10'));
  assert.strictEqual(c.seconds, '10');
  const h = { model: 'MiniMax-H3', prompt: 'p', duration: 20, resolution: '768P', metadata: { h3_request: { duration: 20, resolution: '768P', ratio: '16:9' } } };
  assert.ok(fixBodyFromError(h, 'duration must be between 4 and 15'));
  assert.strictEqual(h.duration, 15);
  assert.strictEqual(h.metadata.h3_request.duration, 15);
  assert.strictEqual(fixBodyFromError({ metadata: {} }, 'prompt is required'), false);
});
