// 短剧制作 Studio · Windows 启动器
//
// 安装目录结构：
//   <安装目录>\node\node.exe      便携 Node
//   <安装目录>\bin\ffmpeg.exe     ffmpeg / ffprobe
//   <安装目录>\app\               程序（已构建好的后端与前端）
//   <安装目录>\app\packaging\launcher.mjs   本文件
// 用户数据放在 %LOCALAPPDATA%\DuanjuStudio（重装、升级都不会丢）。
//
// node launcher.mjs          启动（已在运行则直接打开浏览器）
// node launcher.mjs --stop   停止
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INSTALL = path.resolve(APP, '..');
const NODE = process.execPath;
const BACKEND_PORT = Number(process.env.DJ_BACKEND_PORT || 4610);
const WEB_PORT = Number(process.env.DJ_WEB_PORT || 4710);
const CONTROL_PORT = Number(process.env.DJ_CONTROL_PORT || 4719);
const URL_WEB = 'http://127.0.0.1:' + WEB_PORT;

const DATA = process.env.DJ_DATA_DIR
  || path.join(process.env.LOCALAPPDATA || path.join(process.env.HOME || INSTALL, '.local', 'share'), 'DuanjuStudio');
const LOGS = path.join(DATA, 'logs');
fs.mkdirSync(LOGS, { recursive: true });
const log = (...a) => fs.appendFileSync(path.join(LOGS, 'launcher.log'), new Date().toISOString() + ' ' + a.join(' ') + '\n');

function portOpen(port) {
  return new Promise((resolve) => {
    const s = net.connect({ host: '127.0.0.1', port });
    const done = (v) => { s.destroy(); resolve(v); };
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
    s.setTimeout(800, () => done(false));
  });
}

async function waitPort(port, ms) {
  const t = Date.now();
  while (Date.now() - t < ms) {
    if (await portOpen(port)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function openBrowser(url) {
  if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '""', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  else spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
}

function requestStop() {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: CONTROL_PORT, path: '/stop', timeout: 3000 }, (res) => { res.resume(); res.on('end', () => resolve(true)); });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

if (process.argv.includes('--stop')) {
  const ok = await requestStop();
  log('stop requested', ok ? 'ok' : 'not running');
  process.exit(0);
}

// 已在运行：只打开浏览器
if (await portOpen(WEB_PORT)) {
  openBrowser(URL_WEB);
  process.exit(0);
}

// 配置文件放在用户数据目录；首次运行不存在时由程序按默认值处理，在「设置」里保存后生成
const CONFIG = path.join(DATA, 'config.json');

const env = {
  ...process.env,
  IC_ROOT: APP,
  NODE_ENV: 'production',
  IC_DATA_DIR: path.join(DATA, 'data'),
  IC_CONFIG: CONFIG,
  HOST: '127.0.0.1',
  // 便携 ffmpeg / Node 放到 PATH 最前面（字幕识别、合成成片都靠它）
  PATH: [path.join(INSTALL, 'bin'), path.dirname(NODE), process.env.PATH || process.env.Path || ''].join(path.delimiter),
  NODE_OPTIONS: (process.env.NODE_OPTIONS || '') + ' --max-old-space-size=8192',
};
delete env.Path;

const children = [];
function start(name, args, extraEnv) {
  const out = fs.openSync(path.join(LOGS, name + '.log'), 'a');
  const child = spawn(NODE, args, { cwd: APP, env: { ...env, ...extraEnv }, stdio: ['ignore', out, out], windowsHide: true });
  child.on('exit', (code) => { log(name, 'exited', code); shutdown(code || 0); });
  children.push(child);
  log(name, 'started pid', child.pid);
  return child;
}

let stopping = false;
function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const c of children) { try { c.kill(); } catch {} }
  setTimeout(() => process.exit(code), 1500);
}

http.createServer((req, res) => {
  if (req.url === '/stop') { res.end('ok'); shutdown(0); return; }
  res.statusCode = 404; res.end();
}).listen(CONTROL_PORT, '127.0.0.1').on('error', (e) => log('control port error', e.message));

start('backend', ['server.js'], { PORT: String(BACKEND_PORT) });
if (!(await waitPort(BACKEND_PORT, 180_000))) {
  log('backend did not start in time');
  shutdown(1);
} else {
  start('web', ['scripts/serve-web.mjs'], { PORT: String(WEB_PORT), STUDIO_BACKEND: 'http://127.0.0.1:' + BACKEND_PORT, WEB_MODE: 'studio' });
  if (await waitPort(WEB_PORT, 30_000)) {
    openBrowser(URL_WEB);
    startTray();
  }
}

// Windows 托盘图标：双击打开界面，右键「退出」停止全部服务
function startTray() {
  if (process.platform !== 'win32') return;
  const script = path.join(APP, 'packaging', 'tray.ps1');
  if (!fs.existsSync(script)) return;
  const tray = spawn('powershell.exe', [
    '-NoProfile', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-STA', '-File', script,
    '-Url', URL_WEB, '-ControlPort', String(CONTROL_PORT), '-Icon', path.join(APP, 'packaging', 'icon.ico'), '-LogDir', LOGS,
  ], { stdio: 'ignore', windowsHide: true });
  tray.on('error', (e) => log('tray failed', e.message));
  children.push(tray);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
