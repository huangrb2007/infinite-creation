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
process.env.IC_CONFIG = path.join(TMP, 'config.json'); // 不碰仓库里的 config.json
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
  assert.deepEqual(info.durations, [15], '默认固定每段 15 秒（豆包 5/10/15 秒都扣一次额度）');
  const auto = core.videoEngineInfo(cfgWith({ plugins: { 'doubao-canvas': { params: { segment_mode: 'auto' } } } }));
  assert.deepEqual(auto.durations, [5, 10, 15]);
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
  assert.match(a, /duration 一律 15 秒/);
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
    assert.equal(seen.body.duration, '15s');
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

test('豆包插件：审核不通过 → 同一账号原样重新提交，成功后取回成片', async () => {
  process.env.IC_PLUGIN_POLL_MS = '50';
  const video = path.join(TMP, 'result-mod.mp4');
  fs.writeFileSync(video, Buffer.from('mod-ok'));
  const bodies = [];
  const srv = http.createServer((req, res) => {
    const send = (j) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(j)); };
    if (req.url === '/api/health') return send({ status: 'ok', accounts: [] });
    if (req.url === '/api/generate') {
      let b = '';
      req.on('data', (c) => { b += c; });
      req.on('end', () => { bodies.push(JSON.parse(b)); send({ task_id: 'm' + bodies.length }); });
      return;
    }
    const m = /^\/api\/tasks\/m(\d+)$/.exec(req.url || '');
    if (m) {
      const n = Number(m[1]);
      return send(n < 3 ? { status: 'error', account: '号7', detail: '账号「号7」失败：豆包返回：审核不通过,请修改后重试（业务码：2）' } : { status: 'done', result_path: video });
    }
    send({});
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const cfg = cfgWith({ plugins: { 'doubao-canvas': { params: { manager_url: 'http://127.0.0.1:' + srv.address().port } } } });
    const spec = getCatalogSpec(cfg, 'plugin:doubao-canvas');
    const statuses = [];
    const r = await core.runWorkflow(cfg, spec, { positive_prompt: '镜头1：她回头。', seconds: 15, references: [] }, { onStatus: (s) => statuses.push(s.message) });
    assert.equal(bodies.length, 3);
    assert.equal(bodies[0].account, undefined);
    assert.equal(bodies[1].account, '号7');
    assert.equal(bodies[2].account, '号7');
    assert.ok(bodies.every((b) => b.prompt === bodies[0].prompt), '提示词原样不改');
    assert.notEqual(bodies[1].generation_round, bodies[0].generation_round);
    assert.ok(statuses.some((x) => /第 1\/10 次原样重新提交/.test(x)), statuses.join('|'));
    const out = core.pickOutput(r.outputs, 'videos');
    assert.equal(fs.readFileSync(out.localPath, 'utf8'), 'mod-ok');
  } finally {
    srv.close();
    delete process.env.IC_PLUGIN_POLL_MS;
  }
});

test('豆包插件：审核不通过重试次数用完 → 报错并说明不是文案问题', async () => {
  process.env.IC_PLUGIN_POLL_MS = '50';
  let n = 0;
  const srv = http.createServer((req, res) => {
    const send = (j) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(j)); };
    if (req.url === '/api/health') return send({ status: 'ok', accounts: [] });
    if (req.url === '/api/generate') { req.resume(); req.on('end', () => { n += 1; send({ task_id: 't' + n }); }); return; }
    if (/^\/api\/tasks\//.test(req.url)) return send({ status: 'error', detail: '账号「主账号」失败：豆包返回：审核不通过,请修改后重试' });
    send({});
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const cfg = cfgWith({ plugins: { 'doubao-canvas': { params: { manager_url: 'http://127.0.0.1:' + srv.address().port, moderation_retries: 2 } } } });
    const spec = getCatalogSpec(cfg, 'plugin:doubao-canvas');
    await assert.rejects(core.runWorkflow(cfg, spec, { positive_prompt: 'x', seconds: 5, references: [] }), /审核未通过（已在同一账号原样重新提交 2 次）.*不要改写提示词/);
    assert.equal(n, 3);
  } finally {
    srv.close();
    delete process.env.IC_PLUGIN_POLL_MS;
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

test('豆包插件：用户目录的令牌镜像过期时，按 manager_path.json 读画布助手目录里的真令牌', async () => {
  const mgrDir = path.join(TMP, 'mgr');
  fs.mkdirSync(mgrDir, { recursive: true });
  fs.writeFileSync(path.join(mgrDir, 'bridge_token.json'), 'real-token');
  fs.mkdirSync(path.join(TMP, '.doubao_dola'), { recursive: true });
  fs.writeFileSync(path.join(TMP, '.doubao_dola', 'bridge_token.json'), 'stale-token');
  fs.writeFileSync(path.join(TMP, '.doubao_dola', 'manager_path.json'), JSON.stringify({ root: mgrDir, dir: mgrDir, exe: '' }));
  const srv = http.createServer((req, res) => {
    const ok = req.headers['x-bridge-token'] === 'real-token';
    res.writeHead(req.url === '/api/health' || ok ? 200 : 401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(req.url === '/api/health' ? { status: 'ok', accounts: [] } : ok ? { data: { version: 'v' } } : { error: 'unauthorized' }));
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const cfg = cfgWith({ plugins: { 'doubao-canvas': { params: { manager_url: 'http://127.0.0.1:' + srv.address().port } } } });
    const t = await core.testPlugin(cfg, 'doubao-canvas');
    assert.equal(t.ok, true, t.message);
  } finally {
    srv.close();
    fs.rmSync(path.join(TMP, '.doubao_dola', 'manager_path.json'), { force: true });
  }
});

test('豆包插件：「自动检测」从 manager_path.json 读出画布助手路径', async () => {
  const exe = path.join(TMP, 'mgr2', '豆包画布助手.exe');
  fs.mkdirSync(path.dirname(exe), { recursive: true });
  fs.writeFileSync(exe, 'x');
  fs.writeFileSync(path.join(TMP, '.doubao_dola', 'manager_path.json'), JSON.stringify({ exe, root: path.dirname(exe) }));
  const r = await core.runPluginAction(cfgWith(), 'doubao-canvas', 'detect_manager');
  assert.equal(r.ok, true, r.message);
  assert.equal(r.value, exe);
  const bad = await core.runPluginAction(cfgWith(), 'doubao-canvas', 'nope');
  assert.equal(bad.ok, false);
  const p = core.getPlugin(cfgWith(), 'doubao-canvas').params.find((x) => x.key === 'manager_exe');
  assert.equal(p.type, 'file');
});

test('豆包插件：文件里的令牌都过期时，从画布助手界面页取当前令牌', async () => {
  fs.writeFileSync(path.join(TMP, '.doubao_dola', 'bridge_token.json'), 'stale-1');
  const srv = http.createServer((req, res) => {
    if (req.url === '/index.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<html><head><script>window.__BRIDGE_TOKEN__="live-xyz";window.__DBM_DEV__=false;</script></head></html>'); }
    const ok = req.headers['x-bridge-token'] === 'live-xyz';
    res.writeHead(req.url === '/api/health' || ok ? 200 : 401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(req.url === '/api/health' ? { status: 'ok', accounts: [{ logged_in: true }] } : ok ? { data: { version: 'live' } } : { error: 'unauthorized' }));
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const cfg = cfgWith({ plugins: { 'doubao-canvas': { params: { manager_url: 'http://127.0.0.1:' + srv.address().port, bridge_token: 'wrong-typed' } } } });
    const t = await core.testPlugin(cfg, 'doubao-canvas');
    assert.equal(t.ok, true, t.message);
    assert.match(t.message, /live/);
  } finally { srv.close(); }
});

test('豆包插件：「同步登录状态」逐个打开账号页、保存登录态、关掉', { timeout: 60_000 }, async () => {
  const accs = { A: { name: 'A', logged_in: true }, B: { name: 'B', logged_in: false } };
  const calls = [];
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const send = (j) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(j)); };
    if (u.pathname === '/index.html') { res.writeHead(200); return res.end('<head><script>window.__BRIDGE_TOKEN__="t1";</script></head>'); }
    if (u.pathname === '/api/health') return send({ status: 'ok', accounts: Object.values(accs) });
    if (req.headers['x-bridge-token'] !== 't1') { res.writeHead(401); return res.end('{}'); }
    calls.push(u.pathname + u.search);
    if (u.pathname === '/api/accounts') return send({ ok: true, data: Object.values(accs) });
    if (u.pathname === '/api/ui/accounts-open-state') return send({ ok: true, data: { open: [] } });
    if (u.pathname === '/api/ui/accounts-save-login') { accs[u.searchParams.get('id')].logged_in = true; return send({ ok: true }); }
    send({ ok: true });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const cfg = cfgWith({ plugins: { 'doubao-canvas': { params: { manager_url: 'http://127.0.0.1:' + srv.address().port } } } });
    const r = await core.runPluginAction(cfg, 'doubao-canvas', 'sync_logins');
    assert.equal(r.ok, true, r.message);
    assert.match(r.message, /同步了 1 个账号：现在在线 2 个/);
    assert.deepEqual(calls.filter((c) => /accounts-(open\?|save|close)/.test(c)), ['/api/ui/accounts-open?id=B&popout=0', '/api/ui/accounts-save-login?id=B', '/api/ui/accounts-close?id=B']);
  } finally { srv.close(); }
});

test('插件参数：出片时读磁盘上最新保存的设置（长任务中途改执行方式也生效）', async () => {
  const { CONFIG_PATH } = await import('../lib/core/config.js');
  const had = fs.existsSync(CONFIG_PATH) ? fs.readFileSync(CONFIG_PATH) : null;
  const bodies = [];
  const srv = http.createServer((req, res) => {
    const send = (j) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(j)); };
    if (req.url === '/api/generate') { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => { bodies.push(JSON.parse(b)); send({ task_id: 'lv' }); }); return; }
    if (req.url === '/api/tasks/lv') return send({ status: 'cancelled' });
    send({ status: 'ok', accounts: [] });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  process.env.IC_PLUGIN_POLL_MS = '30';
  try {
    const url = 'http://127.0.0.1:' + srv.address().port;
    const raw = had ? JSON.parse(had.toString('utf8')) : {};
    raw.catalog = { ...(raw.catalog || {}), plugins: { 'doubao-canvas': { enabled: true, params: { manager_url: url, exec_mode: 'chat' } } } };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(raw));
    const cfg = cfgWith({ plugins: { 'doubao-canvas': { params: { manager_url: url, exec_mode: 'api_popout' } } } });
    const spec = getCatalogSpec(cfg, 'plugin:doubao-canvas');
    await assert.rejects(core.runWorkflow(cfg, spec, { positive_prompt: 'x', seconds: 15, references: [] }), /取消/);
    assert.equal(bodies[0].exec_mode, 'chat');
  } finally {
    srv.close();
    delete process.env.IC_PLUGIN_POLL_MS;
    if (had) fs.writeFileSync(CONFIG_PATH, had); else fs.rmSync(CONFIG_PATH, { force: true });
  }
});

test('选豆包插件后：保留 AIFISHER 流程条目、人物颜值规则、下沉短剧快节奏', async () => {
  const { buildSkillAdapter } = await import('../lib/agent/adaptation-rules.js');
  const engine = { promptStyle: 'seedance', durations: [15], name: '豆包画布助手', maxImages: 9 };
  const t = buildSkillAdapter({ style: '3D都市写实', aspect: '9:16', mainSkill: 'seedance-drama-prompt', flowSkill: 'minimax-drama-prompt', route: 'studio3d', installed: ['studio-assets-3d'], engine });
  assert.match(t, /一键下沉剧」五步流程/);
  assert.match(t, /6c\. 人物颜值/);
  assert.match(t, /45–65 字且至少 3 句/);
  assert.ok(t.indexOf('6b.') < t.indexOf('6c.'));
  const skill = fs.readFileSync(path.join(process.cwd(), 'skills/seedance-drama-prompt/SKILL.md'), 'utf8');
  assert.match(skill, /下沉短剧要快/);
  assert.ok(!/补反应镜头（听的人的表情）/.test(skill));
});

test('豆包插件：参考图按原顺序传（人物在前，场景、道具在后），@图片编号对应', async () => {
  const mk = (n) => { const f = path.join(TMP, n + '.png'); fs.writeFileSync(f, 'p'); return f; };
  const a = mk('lindong'), b = mk('wife'), c = mk('room'), d = mk('phone');
  let body = null;
  const srv = http.createServer((req, res) => {
    const send = (j) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(j)); };
    if (req.url === '/api/generate') { let x = ''; req.on('data', (ch) => { x += ch; }); req.on('end', () => { body = JSON.parse(x); send({ task_id: 'od' }); }); return; }
    if (req.url === '/api/tasks/od') return send({ status: 'cancelled' });
    send({ status: 'ok', accounts: [] });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  process.env.IC_PLUGIN_POLL_MS = '30';
  try {
    const cfg = cfgWith({ plugins: { 'doubao-canvas': { params: { manager_url: 'http://127.0.0.1:' + srv.address().port } } } });
    const spec = getCatalogSpec(cfg, 'plugin:doubao-canvas');
    await assert.rejects(core.runWorkflow(cfg, spec, {
      positive_prompt: '镜头1：__MINIMAX_H3_REF_1__在__MINIMAX_H3_REF_3__里对__MINIMAX_H3_REF_2__说话，举起__MINIMAX_H3_REF_4__。',
      seconds: 15,
      references: [
        { type: 'image', name: '林冬', label: '林冬（人物形象）', filename: a },
        { type: 'image', name: '妻子', label: '妻子（人物形象）', filename: b },
        { type: 'image', name: '出租屋', label: '出租屋（场景背景）', filename: c },
        { type: 'image', name: '手机', label: '手机（道具）', filename: d },
      ],
    }), /取消/);
    assert.deepEqual(body.image_paths, [a, b, c, d]);
    assert.match(body.prompt, /^@图片1是林冬的角色形象图；@图片2是妻子的角色形象图；@图片3是出租屋的场景图；@图片4是手机的道具图。\n镜头1：@图片1在@图片3里对@图片2说话，举起@图片4。/);
  } finally {
    srv.close();
    delete process.env.IC_PLUGIN_POLL_MS;
  }
});

test('豆包额度：mini / fast 共用一份额度，按比例扣；0 点清零；用完记 0；校正提示', async () => {
  const qm = await import('../plugins/doubao-canvas/quota.mjs');
  const cap = { mini: 5, fast: 2 };
  assert.deepEqual(({ ...qm.remainingOf({ mini: 0, fast: 1 }, cap) }), { mini: 2, fast: 1, share: 0.5 });
  assert.equal(qm.remainingOf({ mini: 2, fast: 0 }, cap).fast, 1);
  assert.equal(qm.remainingOf({ mini: 3, fast: 0 }, cap).fast, 0);
  assert.equal(qm.remainingOf({ mini: 3, fast: 0 }, cap).mini, 2);
  assert.equal(qm.modelKind('seedance2.0mini'), 'mini');
  assert.equal(qm.modelKind('Seedance 2.5（豆包）'), 'fast');
  // 北京时间：UTC 16:30 已经是第二天
  assert.equal(qm.bjDay(Date.parse('2026-11-21T16:30:00Z')), '2026-11-22');

  const dir = fs.mkdtempSync(path.join(TMP, 'quota-'));
  const now = Date.parse('2026-11-21T06:00:00Z'); // 北京 14:00
  const sec = (iso) => Date.parse(iso) / 1000;
  const tasks = [
    { id: 't1', status: 'done', account: '1', model: 'seedance2.0fast', created: sec('2026-11-21T02:00:00Z') },
    { id: 't2', status: 'done', account: '2', model: 'seedance2.0mini', created: sec('2026-11-21T02:00:00Z') },
    { id: 't3', status: 'done', account: '2', model: 'seedance2.0mini', created: sec('2026-11-20T15:00:00Z') }, // 北京 23:00 前一天，不算
    { id: 't4', status: 'error', account: '1', model: 'seedance2.0fast', created: sec('2026-11-21T03:00:00Z'), error: '审核不通过' },
  ];
  const accounts = [
    { name: '1', logged_in: true, group: '' }, { name: '2', logged_in: true, group: '' },
    { name: '3', logged_in: true, forced_cooldown: true, last_error: '额度耗尽' },
    { name: '4', logged_in: true, forced_cooldown: true, last_error: '生成失败，请重试（业务码：3）' },
  ];
  qm.recordDone(dir, { account: '1', taskId: 't1', model: 'seedance2.0fast', ts: now }); // 和任务列表重复，按任务号去重
  const q = qm.buildQuota({ dataDir: dir, params: {}, tasks, accounts, now });
  const row = (n) => q.rows.find((r) => r.account === n);
  assert.deepEqual(row('1').used, { mini: 0, fast: 1 });
  assert.deepEqual([row('1').remaining.mini, row('1').remaining.fast], [2, 1]);
  assert.deepEqual([row('2').remaining.mini, row('2').remaining.fast], [4, 1]);
  assert.equal(row('3').state, '今日用完');
  assert.match(row('4').state, /冷却中/);
  assert.deepEqual(q.total, { mini: 6, fast: 2 });
  assert.equal(qm.pickAccount(q, 'seedance2.0fast'), '1');
  // 预留：1 号已派出一段 fast → 1 号剩 0，改派 2 号
  assert.equal(qm.pickAccount(q, 'seedance2.0fast', { reserved: new Map([['1', { mini: 0, fast: 1 }]]) }), '2');

  // 校正：两个号只用 fast 都在第 3 次后才用完 → 建议改成 3
  const dir2 = fs.mkdtempSync(path.join(TMP, 'quota-'));
  for (const acc of ['a', 'b']) {
    for (let i = 0; i < 3; i++) qm.recordDone(dir2, { account: acc, taskId: acc + i, model: 'fast', ts: now });
    qm.recordExhausted(dir2, { account: acc, ts: now });
  }
  assert.match(qm.buildQuota({ dataDir: dir2, now }).hint, /改成 3/);
});

test('豆包插件：按额度派号——指定有额度的号；号额度用完时撤单换号重提', async () => {
  process.env.IC_PLUGIN_POLL_MS = '30';
  const video = path.join(TMP, 'quota-ok.mp4');
  fs.writeFileSync(video, 'q');
  const bodies = [];
  const cancelled = [];
  const accounts = [{ name: 'A', logged_in: true }, { name: 'B', logged_in: true }];
  const srv = http.createServer((req, res) => {
    const send = (j) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(j)); };
    if (req.url === '/api/accounts') return send({ ok: true, data: accounts });
    if (req.url === '/api/tasks') return send({ ok: true, tasks: [] });
    if (req.method === 'POST') {
      let b = '';
      req.on('data', (c) => { b += c; });
      req.on('end', () => {
        const j = JSON.parse(b || '{}');
        if (req.url === '/api/tasks/cancel') { cancelled.push(j.task_id); return send({ ok: true }); }
        bodies.push(j); send({ task_id: 'q' + bodies.length });
      });
      return;
    }
    if (req.url === '/api/tasks/q1') return send({ status: 'quota_exhausted', account: bodies[0]?.account, detail: '额度用完' });
    if (req.url === '/api/tasks/q2') return send({ status: 'done', account: bodies[1]?.account, result_path: video });
    send({ status: 'ok', accounts });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const cfg = cfgWith({ plugins: { 'doubao-canvas': { params: { manager_url: 'http://127.0.0.1:' + srv.address().port, quota_dispatch: true } } } });
    const spec = getCatalogSpec(cfg, 'plugin:doubao-canvas');
    const r = await core.runWorkflow(cfg, spec, { positive_prompt: '镜头1：她回头。', seconds: 15, references: [] });
    assert.ok(['A', 'B'].includes(bodies[0].account));
    assert.ok(['A', 'B'].includes(bodies[1].account) && bodies[1].account !== bodies[0].account);
    assert.deepEqual(cancelled, ['q1']);
    assert.ok(core.pickOutput(r.outputs, 'videos')?.localPath);
    const st = await core.runPluginAction(cfg, 'doubao-canvas', 'quota_status');
    assert.equal(st.ok, true, st.message);
    const rows = Object.fromEntries(st.table.rows.map((x) => [x[0], x]));
    assert.equal(rows[bodies[0].account][6], '今日用完');
    assert.equal(rows[bodies[1].account][3], 1);
    assert.equal(st.value.current, 1);
  } finally {
    srv.close();
    delete process.env.IC_PLUGIN_POLL_MS;
  }
});

test('豆包插件：画布助手原片下载失败 → 本软件自己下载补回；重生成时先补回上次的成片', async () => {
  process.env.IC_PLUGIN_POLL_MS = '20';
  const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42'), Buffer.alloc(60_000, 1)]);
  let port = 0;
  let videoHits = 0;
  let gen = 0;
  const srv = http.createServer((req, res) => {
    const send = (j) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(j)); };
    if (req.url.startsWith('/x/video/')) {
      videoHits += 1;
      if (videoHits === 1) { req.socket.destroy(); return; } // 第一次掐断连接
      res.writeHead(200, { 'Content-Type': 'video/mp4' }); return res.end(mp4);
    }
    const errText = () => '原片下载失败：http://127.0.0.1:' + port + '/x/video/a.mp4?lr=unwatermarked （步骤日志）';
    if (req.url === '/api/generate') { req.resume(); req.on('end', () => { gen += 1; send({ task_id: 'n' + gen }); }); return; }
    if (req.url === '/api/tasks/n1' || req.url === '/api/tasks/old1') return send({ status: 'error', account: '9', error: errText() });
    send({ status: 'ok', accounts: [] });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  port = srv.address().port;
  try {
    const plug = await import('../plugins/doubao-canvas/main.mjs');
    assert.equal(plug.nwmUrlOf("x: HTTPSConnectionPool(host='v11-vdl.doubao.com', port=443): Max retries exceeded with url: /5a26/6b0ac56b/video/tos/a/?lr=unwatermarked&x=1 (Caused by SSLError"), 'https://v11-vdl.doubao.com/5a26/6b0ac56b/video/tos/a/?lr=unwatermarked&x=1');
    assert.equal(plug.nwmUrlExpired('https://v11-vdl.doubao.com/5a26cc299264de1bfeed42795bae1276/6b0ac56b/video/x', Date.parse('2026-11-21T12:00:00Z')), false);
    assert.equal(plug.nwmUrlExpired('https://v11-vdl.doubao.com/5a26cc299264de1bfeed42795bae1276/6b0ac56b/video/x', Date.parse('2026-12-30T00:00:00Z')), true);
    const cfg = cfgWith({ plugins: { 'doubao-canvas': { params: { manager_url: 'http://127.0.0.1:' + port } } } });
    const spec = getCatalogSpec(cfg, 'plugin:doubao-canvas');
    // 1) 生成时画布助手下载失败 → 插件补下载（第一次被掐断，重试成功）
    const r = await core.runWorkflow(cfg, spec, { positive_prompt: '镜头1：她回头。', seconds: 15, references: [] });
    const out = core.pickOutput(r.outputs, 'videos');
    assert.ok(out?.localPath && fs.readFileSync(out.localPath).slice(4, 8).toString() === 'ftyp');
    assert.equal(gen, 1);
    // 2) 重生成一段上次失败的：先补回旧任务的原片，不重新提交
    const r2 = await core.runWorkflow(cfg, spec, { positive_prompt: '镜头1：她回头。', seconds: 15, references: [], recover_task_id: 'old1' });
    assert.ok(core.pickOutput(r2.outputs, 'videos')?.localPath);
    assert.equal(gen, 1, '补回时不应重新提交');
  } finally {
    srv.close();
    delete process.env.IC_PLUGIN_POLL_MS;
  }
});
