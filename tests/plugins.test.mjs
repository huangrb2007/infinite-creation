// 生成插件框架 + 内置「豆包画布助手」插件 + Seedance 提示词切换。
// 豆包画布助手用本地假服务模拟（同样的 HTTP 接口），不连真实账号。
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ic-plugins-'));
process.env.IC_DATA_DIR = TMP;
process.env.HOME = TMP; // 令牌文件位置（~/.doubao_dola）指到临时目录
process.env.USERPROFILE = TMP;

const core = await import('../lib/core/index.js');
const { getCatalogSpec } = await import('../lib/core/catalog/index.js');
const { effectiveNodeSkills } = await import('../lib/agent/agent-loop.js');
const { buildSkillAdapter, composeSeedancePrompt, seedanceShotLines, stripSeedanceTimecodes } = await import('../lib/agent/adaptation-rules.js');
test.after(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {} });

const cfgWith = (extra = {}) => ({ catalog: { selected: { r2v: 'plugin:doubao-canvas' }, plugins: {}, ...extra } });

test('内置豆包插件：出现在视频类别，模型族 Seedance', () => {
  const list = core.listPlugins(cfgWith());
  const p = list.find((x) => x.id === 'doubao-canvas');
  assert.ok(p, '找不到内置插件');
  assert.equal(p.error, '');
  assert.equal(p.family.promptStyle, 'seedance');
  const specs = core.pluginSpecs(cfgWith());
  const s = specs.find((x) => x.key === 'plugin:doubao-canvas');
  assert.equal(s.category, 'r2v');
  assert.equal(s.backend, 'api-plugin');
  assert.equal(core.videoPromptStyle(cfgWith()), 'seedance');
  // 停用后不再出现，也不再切换写法
  const off = cfgWith({ plugins: { 'doubao-canvas': { enabled: false } } });
  assert.equal(core.pluginSpecs(off).length, 0);
  assert.equal(core.videoPromptStyle(off), '');
  // 没选插件：不影响原来的 H3 写法
  assert.equal(core.videoPromptStyle({ catalog: { selected: { r2v: 'pool:abc' } } }), '');
  const info = core.videoEngineInfo(cfgWith());
  assert.deepEqual(info.durations, [5, 10, 15]);
  assert.equal(info.maxImages, 9);
});

test('Seedance 编号：只给实际上传的图编号，开头补素材声明；时长按档位取', () => {
  const fam = core.familyOf('seedance-2.0');
  const refs = [
    { type: 'image', name: '林冬', category: 'character', filename: '/a.png' },
    { type: 'audio', name: '林冬的声音', filename: '/a.wav' },
    { type: 'image', name: '出租屋', category: 'scene', filename: '/b.png' },
  ];
  const used = [refs[0], refs[2]];
  const out = core.familyPrompt('__MINIMAX_H3_REF_1__开口说：“谁？”__MINIMAX_H3_REF_2__ 在 __MINIMAX_H3_REF_3__', refs, used, fam);
  assert.match(out, /^@图片1是林冬的角色形象图；@图片2是出租屋的场景图。/);
  assert.match(out, /@图片1开口说/);
  assert.match(out, /林冬的声音 在 @图片2/);
  const e = { durations: [5, 10, 15] };
  assert.equal(core.snapSeconds(4, e), 5);
  assert.equal(core.snapSeconds(7, e), 10);
  assert.equal(core.snapSeconds(10, e), 10);
  assert.equal(core.snapSeconds(14, e), 15);
  assert.equal(core.snapSeconds(30, e), 15);
});

test('技能模式：选了豆包插件 → 分段与提示词改用 seedance-drama-prompt', () => {
  const all = ['minimax-drama-prompt', 'closed-drama', 'closed-fight-stable', 'novel-to-script', 'seedance-drama-prompt', 'asset-extraction'];
  const engine = core.videoEngineInfo(cfgWith());
  const r = effectiveNodeSkills(null, all, { style: '3D动画电影' }, engine);
  assert.equal(r.nodes.pipeline.skills[0], 'seedance-drama-prompt');
  assert.deepEqual(r.nodes.video_prompt.skills, ['seedance-drama-prompt']);
  assert.ok(r.nodes.storyboard.skills.includes('closed-fight-stable'), '打戏技能保留');
  assert.ok(!r.nodes.storyboard.skills.includes('minimax-drama-prompt'));
  // 没选插件时不变
  const r0 = effectiveNodeSkills(null, all, { style: '3D动画电影' }, null);
  assert.equal(r0.nodes.pipeline.skills[0], 'minimax-drama-prompt');
  const a = buildSkillAdapter({ style: '3D动画电影', aspect: '9:16', mainSkill: 'seedance-drama-prompt', engine });
  assert.match(a, /duration 只能取 5 \/ 10 \/ 15 秒/);
  assert.match(a, /不要写 \{\{林冬的声音\}\}/);
  assert.ok(!/六段式：subject_definitions/.test(a), 'H3 格式条目被替换');
  const lean = composeSeedancePrompt({ duration: 5, lines: '林冬（惊讶）：谁？\n旁白：门外没人。' }, { characters: [{ name: '林冬', voice_desc: '青年男声' }], aspect: '9:16' });
  assert.match(lean, /竖屏 9:16/);
  assert.match(lean, /\{\{林冬\}\}惊讶地开口说：“谁？”/);
  assert.match(lean, /旁白（画外音/);
});

test('豆包插件：经假画布助手提交、轮询、取回成片', async () => {
  // 令牌文件
  fs.mkdirSync(path.join(TMP, '.doubao_dola'), { recursive: true });
  fs.writeFileSync(path.join(TMP, '.doubao_dola', 'bridge_token.json'), 'tok-123');
  const video = path.join(TMP, 'result.mp4');
  fs.writeFileSync(video, Buffer.from('fake-mp4'));
  const img = path.join(TMP, 'ref.png');
  fs.writeFileSync(img, Buffer.from('png'));
  const seen = { body: null, polls: 0, tokens: [] };
  const srv = http.createServer((req, res) => {
    seen.tokens.push(req.headers['x-bridge-token']);
    const send = (code, j) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(j)); };
    if (req.url === '/api/health') return send(200, { status: 'ok', accounts: [{ logged_in: true }, { logged_in: false }] });
    if (req.headers['x-bridge-token'] !== 'tok-123') return send(401, { error: 'unauthorized' });
    if (req.url === '/api/ui/build-info') return send(200, { data: { version: 'V-test' } });
    if (req.url === '/api/generate' && req.method === 'POST') {
      let b = '';
      req.on('data', (c) => { b += c; });
      req.on('end', () => { seen.body = JSON.parse(b); send(200, { task_id: 't1' }); });
      return;
    }
    if (req.url === '/api/tasks/t1') {
      seen.polls += 1;
      return send(200, seen.polls < 2 ? { status: 'running', progress: 40, account: '主账号' } : { status: 'done', result_path: video });
    }
    send(404, {});
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const url = 'http://127.0.0.1:' + srv.address().port;
  try {
    const cfg = cfgWith({ plugins: { 'doubao-canvas': { enabled: true, params: { manager_url: url, target_platform: 'feishu', resolution: '2K' } } } });
    const t = await core.testPlugin(cfg, 'doubao-canvas');
    assert.equal(t.ok, true, t.message);
    assert.match(t.message, /V-test.*账号 2 个，已登录 1 个/);
    const spec = getCatalogSpec(cfg, 'plugin:doubao-canvas');
    const statuses = [];
    const r = await core.runWorkflow(cfg, spec, {
      positive_prompt: '【分镜】0-5秒｜近景｜固定镜头：__MINIMAX_H3_REF_1__低头看手机。',
      seconds: 7, aspect_ratio: '9:16', references: [{ type: 'image', name: '林冬', label: '林冬（人物形象）', filename: img }],
    }, { onStatus: (s) => statuses.push(s.message) });
    assert.equal(seen.body.duration, '10s');
    assert.equal(seen.body.ratio, '9:16');
    assert.equal(seen.body.target_platform, 'feishu');
    assert.equal(seen.body.exec_mode, 'api_popout');
    assert.equal(seen.body.resolution, '2K');
    assert.deepEqual(seen.body.image_paths, [img]);
    assert.match(seen.body.prompt, /^@图片1是林冬的角色形象图。\n【分镜】0-5秒｜近景｜固定镜头：@图片1低头看手机。/);
    assert.ok(statuses.some((m) => /主账号/.test(m)), statuses.join('|'));
    const out = core.pickOutput(r.outputs, 'videos');
    assert.ok(out?.localPath && fs.existsSync(out.localPath));
    const dst = path.join(TMP, 'proj', 'shot1.mp4');
    await core.downloadToFile(cfg, out, dst).catch((e) => { if (!/ffprobe|ffmpeg|spawn|ENOENT/i.test(e.message)) throw e; });
    assert.equal(fs.readFileSync(dst, 'utf8'), 'fake-mp4');
  } finally {
    srv.close();
  }
});

test('豆包插件：审核不通过直接报错，不当成功', async () => {
  const srv = http.createServer((req, res) => {
    const send = (j) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(j)); };
    if (req.url === '/api/health') return send({ status: 'ok', accounts: [] });
    if (req.url === '/api/generate') { req.resume(); req.on('end', () => send({ task_id: 't2' })); return; }
    if (req.url === '/api/tasks/t2') return send({ status: 'error', detail: '账号「主账号」失败：豆包返回：审核不通过,请修改后重试' });
    send({});
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const cfg = cfgWith({ plugins: { 'doubao-canvas': { params: { manager_url: 'http://127.0.0.1:' + srv.address().port } } } });
    const spec = getCatalogSpec(cfg, 'plugin:doubao-canvas');
    await assert.rejects(core.runWorkflow(cfg, spec, { positive_prompt: 'x', seconds: 5, references: [] }), /审核不通过/);
  } finally {
    srv.close();
  }
});

test('导入插件 zip：拒绝越界路径，合法包装到用户目录', async () => {
  const { default: AdmZip } = await import('adm-zip');
  const z = new AdmZip();
  z.addFile('my-plugin/plugin.json', Buffer.from(JSON.stringify({ id: 'my-plugin', name: '测试', type: 'video', entry: 'main.mjs', model_family: 'h3' })));
  z.addFile('my-plugin/main.mjs', Buffer.from('export async function generate(){ return { files: [] }; }'));
  const r = await core.installPluginZip(z.toBuffer());
  assert.equal(r.id, 'my-plugin');
  const p = core.listPlugins({}).find((x) => x.id === 'my-plugin');
  assert.equal(p.builtin, false);
  assert.equal(p.error, '');
  const bad = new AdmZip();
  bad.addFile('plugin.json', Buffer.from(JSON.stringify({ id: 'Bad Id', type: 'video' })));
  await assert.rejects(core.installPluginZip(bad.toBuffer()), /id 不合法/);
});

test('Seedance 分镜按镜头顺序写，不写秒数；写实画风提醒人脸会被拦', () => {
  assert.equal(seedanceShotLines('0-3秒｜近景｜固定镜头：甲看手机\n3.5s-6s｜中景：抬头'), '镜头1：近景，固定镜头：甲看手机\n镜头2：中景：抬头');
  const t = stripSeedanceTimecodes('风格：3D\n0-4秒｜近景｜推近：甲\n4-9秒｜中景：乙\n声音：只说台词');
  assert.match(t, /^风格：3D\n镜头1：近景，推近：甲\n镜头2：中景：乙\n声音：只说台词$/);
  assert.equal(stripSeedanceTimecodes('镜头1：甲'), '镜头1：甲');
  const lean = composeSeedancePrompt({ duration: 10, sub_shots: '0-5秒｜近景：甲' }, { aspect: '16:9' });
  assert.match(lean, /镜头1：近景：甲/);
  assert.match(lean, /时长：10秒$/);
  assert.ok(!/0-5秒/.test(lean));
  const engine = core.videoEngineInfo(cfgWith());
  assert.match(buildSkillAdapter({ style: '真人写实', engine }), /拦截写实真人脸/);
  assert.ok(!/拦截写实真人脸/.test(buildSkillAdapter({ style: '3D动画电影', engine })));
});
