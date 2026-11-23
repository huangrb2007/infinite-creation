// 画风预览图：用用户自己配置的文生图模型，给画风库里没有预览图的画风各出一张，存到数据目录。
// 内置预览在 studio/public/styles/<id>.jpg；生成的在 DATA_DIR/style-previews/<id>.<ext>，后者优先（用户重新生成过）。
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';
import { STYLE_LIBRARY, styleAnchor, styleNegative, ratioToSize } from '../shared/index.js';
import { runWorkflow, pickOutput, downloadToFile } from './workflow-runner.js';
import { getSpecForKind } from './workflow-specs.js';

export const STYLE_PREVIEW_DIR = path.join(DATA_DIR, 'style-previews');

// 每个题材一个固定画面，同题材的真人 / 3D 用同一个画面方便对比
const SCENE_BY_GENRE = {
  都市: '城市写字楼大堂，玻璃幕墙外是傍晚的城市',
  电影: '黄昏的城市街头，路灯刚亮',
  古装: '古代宫殿回廊，红柱和灯笼',
  宫斗古言: '金碧辉煌的宫殿大殿，烛光',
  年代: '老街巷口，砖墙和自行车',
  民国: '老上海街头，霓虹招牌和电车',
  末世: '大雪覆盖的城市废墟，寒风',
  仙侠: '云海之上的仙山石台',
  玄幻: '悬浮山峰和发光的古阵法',
  科幻: '雨夜霓虹都市街道',
  卡通: '阳光明媚的小镇街道',
  霸总甜宠: '高层总裁办公室，落地窗外是城市夜景',
  霸总: '高层总裁办公室，落地窗外是城市夜景',
  家庭伦理: '温馨的家庭客厅，暖色台灯',
  悬疑: '雨夜昏暗的小巷，路灯',
  校园: '阳光照进的教室',
  甜宠: '樱花盛开的街道',
  武侠: '雨后的竹林小径',
  都市异能: '夜晚城市天台，远处霓虹',
};

export function stylePreviewPrompt(style) {
  const scene = SCENE_BY_GENRE[style.genre] || '城市街头';
  const body = '短剧剧照：一位二十多岁、容貌漂亮的东亚女主角，穿着得体、符合题材的服装，半身入画，站在' + scene + '，看向镜头，神情自然；画面干净，无文字，无水印。';
  return styleAnchor(style.name) + '\n' + body;
}

export function generatedPreviewFile(id) {
  if (!/^[a-z0-9-]+$/i.test(String(id || ''))) return '';
  for (const ext of ['.jpg', '.png', '.webp', '.jpeg']) {
    const f = path.join(STYLE_PREVIEW_DIR, id + ext);
    if (fs.existsSync(f)) return f;
  }
  return '';
}

export function listGeneratedPreviews() {
  try { return fs.readdirSync(STYLE_PREVIEW_DIR).map((f) => f.replace(/\.[^.]+$/, '')); } catch { return []; }
}

/** 给一个画风出预览图，返回本地文件路径 */
export async function generateStylePreview(cfg, id, { isAborted } = {}) {
  const style = STYLE_LIBRARY.find((s) => s.id === id);
  if (!style) throw new Error('没有这个画风：' + id);
  const spec = getSpecForKind(cfg, 't2i');
  if (!spec) throw new Error('还没有配置文生图模型（设置 → 工作流 → 图片）');
  const [width, height] = ratioToSize('16:9');
  const { outputs } = await runWorkflow(cfg, spec, {
    positive_prompt: stylePreviewPrompt(style),
    negative_prompt: styleNegative(style.name) || 'blurry, low quality, watermark, text',
    width, height, seed: Math.floor(Math.random() * 2 ** 31), filename_prefix: 'style_preview_' + id,
  }, { timeoutMs: 10 * 60_000, isAborted, subject: '画风预览 ' + style.name });
  const img = pickOutput(outputs, 'images');
  if (!img) throw new Error('文生图没有返回图片');
  fs.mkdirSync(STYLE_PREVIEW_DIR, { recursive: true });
  const ext = (path.extname(img.filename || '') || '.png').toLowerCase();
  for (const old of ['.jpg', '.png', '.webp', '.jpeg']) { try { fs.rmSync(path.join(STYLE_PREVIEW_DIR, id + old), { force: true }); } catch {} }
  const dst = path.join(STYLE_PREVIEW_DIR, id + ext);
  await downloadToFile(cfg, img, dst);
  return dst;
}
