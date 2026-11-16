import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { SKILLS_DIR, Skills, slugify, uid } from '../core/index.js';

// 解析 SKILL.md 的 YAML frontmatter（name / description 单行）
export function parseFrontmatter(text) {
  const m = /^---\s*\n([\s\S]*?)\n---\s*\n?/.exec(text || '');
  if (!m) return {};
  const meta = {};
  for (const line of m[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx > 0) {
      const k = line.slice(0, idx).trim();
      let v = line.slice(idx + 1).trim();
      v = v.replace(/^['"]|['"]$/g, '');
      meta[k] = v;
    }
  }
  return meta;
}

// 读取技能主体（frontmatter 之后的内容）
export function stripFrontmatter(text) {
  const m = /^---\s*\n[\s\S]*?\n---\s*\n?/.exec(text || '');
  return m ? text.slice(m[0].length) : (text || '');
}

// 技能名只允许是 skills/ 下的一个目录名：拒绝路径分隔符、上跳段、盘符/ADS 冒号，
// 否则 LLM 传入 name='../../x' 会让 path.join 逃出 SKILLS_DIR 去读别处的 SKILL.md（越界读）。
// 非法名返回 null，调用方按「技能不存在」处理。
export function skillDir(name) {
  const n = String(name == null ? '' : name);
  if (!n || n === '.' || n === '..' || n.includes('/') || n.includes('\\') || n.includes(':') || path.isAbsolute(n)) return null;
  return path.join(SKILLS_DIR, n);
}

export function readSkillFile(name) {
  const dir = skillDir(name);
  if (!dir) return null;
  const cn = path.join(dir, 'SKILL.cn.md');
  const en = path.join(dir, 'SKILL.md');
  let file = en;
  if (fs.existsSync(cn)) file = cn; // 中文优先
  else if (!fs.existsSync(en)) return null;
  return fs.readFileSync(file, 'utf8');
}

// 扫描 skills/ 目录，解析 frontmatter 并注册到 DB
export function scanSkills() {
  const result = [];
  const seen = new Set();
  for (const name of fs.existsSync(SKILLS_DIR) ? fs.readdirSync(SKILLS_DIR) : []) {
    const dir = skillDir(name);
    if (!dir || !fs.statSync(dir).isDirectory()) continue;
    const text = readSkillFile(name);
    if (!text) continue;
    const meta = parseFrontmatter(text);
    const skillName = meta.name || name;
    const metaYaml = path.join(dir, 'meta.yaml');
    const manifest = fs.existsSync(metaYaml) ? { metaYaml: true } : {};
    const s = Skills.upsert({
      name: skillName,
      description: meta.description || '',
      version: manifest.version || '',
      source: ['director-assistant', 'h3-prompt-writing', 'image-prompt-writing', 'tts-voice-design', 'asset-extraction', 'novel-adaptation'].includes(name) ? 'bundled' : 'installed',
      enabled: true,
      path: 'skills/' + name,
      manifest,
    });
    seen.add(s.id);
    result.push(s);
  }
  // 清掉「技能目录已被删除」的陈旧行：upsert 只按 name 匹配、从不删行，而界面上的技能列表
  // 读的就是这张表 —— 删掉 skills/xxx（或整个 skills/ 目录）后它仍列在那里，连带一个点了没用的
  // 启用开关；而按它加载（loadSkillWithResources）只会拿到 null。只清理 path 指向 skills/、
  // 且技能文件已读不到的行，不碰非扫描来源的行（如历史遗留的 generated）。
  for (const s of Skills.list()) {
    if (seen.has(s.id)) continue;
    const rel = String(s.path || '');
    if (!rel.startsWith('skills/')) continue;
    if (readSkillFile(rel.slice('skills/'.length))) continue;
    Skills.remove(s.id);
  }
  return result;
}

export function loadSkill(name) {
  const text = readSkillFile(name);
  if (!text) return null;
  const meta = parseFrontmatter(text);
  return { name: meta.name || name, description: meta.description || '', body: stripFrontmatter(text) };
}

// 递归收集 references 下的 .md/.txt：新套装把规范放在 references/style-bible/ 等子目录，
// 只读第一层会让 skill_reference 找不到它们。返回的 name 是相对 references/ 的路径（/ 分隔），
// 旧技能的顶层文件名保持不变（如 script-master 的 framework.md）。
export function collectSkillReferences(refDir) {
  const out = [];
  const walk = (dir) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const ent of entries) {
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) { walk(abs); continue; }
      if (!/\.(md|txt)$/i.test(ent.name)) continue;
      try {
        out.push({ name: path.relative(refDir, abs).split(path.sep).join('/'), content: fs.readFileSync(abs, 'utf8') });
      } catch { /* 单个文件读不到不影响其余参考文件 */ }
    }
  };
  walk(refDir);
  return out;
}

// 加载技能的 references 目录（可选，供需要时注入）
export function loadSkillReferences(name) {
  const base = skillDir(name);
  if (!base) return [];
  const dir = path.join(base, 'references');
  if (!fs.existsSync(dir)) return [];
  return collectSkillReferences(dir);
}

// 技能目录（仅摘要：name/description/whenToUse，供模型发现技能）
export function listSkills() {
  if (!fs.existsSync(SKILLS_DIR)) return [];
  const result = [];
  for (const name of fs.readdirSync(SKILLS_DIR)) {
    const dir = skillDir(name);
    if (!dir || !fs.statSync(dir).isDirectory()) continue;
    const text = readSkillFile(name);
    if (!text) continue;
    const meta = parseFrontmatter(text);
    result.push({ name: meta.name || name, description: meta.description || '', whenToUse: meta.whenToUse || '' });
  }
  return result.sort((a, b) => (a.name < b.name ? -1 : 1));
}

// 把技能正文渲染为模型可读的 <skill_content> 块（对齐 DSH renderSkillContent）
export function renderSkillContent(skill) {
  const name = skill?.name || '';
  const body = skill?.body || skill?.content || '';
  const base = skill?.resourceBase || '';
  const resourceLines = base
    ? ['<skill_resources>', 'Base directory for this skill: ' + base, 'Resolve relative paths against this base directory before using them. Load referenced resources only as needed.', '</skill_resources>', '']
    : [];
  return ['<skill_content name="' + name + '">', ...resourceLines, '<skill_instructions>', body, '</skill_instructions>', '</skill_content>'].join('\n');
}

// 一次返回技能正文 + references（供按需加载工具使用）
export function loadSkillWithResources(name) {
  const skill = loadSkill(name);
  if (!skill) return null;
  return { ...skill, references: loadSkillReferences(name), resourceBase: skillDir(name) };
}

// 递归收集技能目录下的全部文件（供流水线配置包导出打包）。目录不存在/不可读返回 []。
export function collectSkillDirFiles(name) {
  const base = skillDir(name);
  if (!base || !fs.existsSync(base)) return [];
  const out = [];
  const walk = (dir) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const ent of entries) {
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) { walk(abs); continue; }
      out.push({ abs, rel: path.relative(base, abs).split(path.sep).join('/') });
    }
  };
  walk(base);
  return out;
}

// 技能路由：短剧流水线只用导演助理一套技能（2026-11 起旧的几十个技能已删除）
export function routeSkill() {
  return 'director-assistant';
}

// —— zip 技能包安装 ——

const SKILL_MD_FILES = new Set(['SKILL.md', 'SKILL.cn.md']);

// 校验并归一化 zip 条目路径：反斜杠→正斜杠、去前导斜杠、按 / 切分；拒绝盘符绝对路径与越界段。
// 返回段数组；非法返回 null。
// 越界判定不能只看「精确等于 ..」：Win32 会剥掉每个路径分量结尾的点与空格，
// 「... 」「.. 」「...」这类分量会被文件系统当成 .. 解析，拼出的路径就跳出了目标目录。
// 因此凡是「全由点组成」或「以点/空格结尾」的分量一律拒绝。
function safeZipParts(entryName) {
  const s = String(entryName || '').replace(/\\/g, '/');
  if (/^[a-zA-Z]:/.test(s)) return null;
  const parts = s.split('/').filter((seg) => seg.length > 0);
  if (parts.some((seg) => /^\.+$/.test(seg) || /[ .]$/.test(seg))) return null;
  return parts;
}

/**
 * 从 zip 缓冲区安装技能到 targetDir（默认 SKILLS_DIR）。
 * 每个「含 SKILL.md / SKILL.cn.md 的目录」视为一个技能；根位于 zip 顶层时整包视为单技能。
 * 纯文件操作、不触库；返回 [{ name, dir, files }]。
 */
export function installSkillsFromZip(buffer, { sourceName = '', targetDir = SKILLS_DIR, overwrite = false } = {}) {
  let zip;
  try { zip = new AdmZip(buffer); } catch (e) { throw new Error('无法解析 zip 文件：' + e.message); }
  const entries = zip.getEntries();
  if (!entries || !entries.length) throw new Error('zip 文件为空');

  const files = []; // { parts, entry }
  for (const entry of entries) {
    const parts = safeZipParts(entry.entryName);
    if (!parts) throw new Error('zip 含不安全路径：' + entry.entryName);
    if (entry.isDirectory || parts.length === 0) continue;
    files.push({ parts, entry });
  }

  const roots = files.filter((f) => SKILL_MD_FILES.has(f.parts[f.parts.length - 1]));
  if (!roots.length) throw new Error('未在 zip 中找到 SKILL.md 或 SKILL.cn.md');

  // 按父目录深度降序处理：嵌套技能的文件优先归属更深技能根，避免误并入父技能。
  const rootList = roots
    .map((f) => ({ file: f, parent: f.parts.slice(0, -1) }))
    .sort((a, b) => b.parent.length - a.parent.length);

  // 每个文件归属「最深匹配」的技能根。
  const assigned = new Map();
  for (let i = 0; i < rootList.length; i++) {
    const prefix = rootList[i].parent;
    for (let j = 0; j < files.length; j++) {
      if (assigned.has(j)) continue;
      const p = files[j].parts;
      if (prefix.length === 0) {
        assigned.set(j, i); // 根在 zip 顶层：吸收所有未归属文件（更深根已优先处理）
      } else if (p.length > prefix.length && p.slice(0, prefix.length).join('/') === prefix.join('/')) {
        assigned.set(j, i);
      }
    }
  }

  const used = new Set();
  const installed = [];
  for (let i = 0; i < rootList.length; i++) {
    const { file: rootFile, parent } = rootList[i];
    let dirName;
    if (parent.length === 0) {
      const md = rootFile.entry.getData().toString('utf8');
      const metaName = parseFrontmatter(md).name;
      dirName = slugify(metaName || String(sourceName).replace(/\.zip$/i, '') || 'skill');
    } else {
      dirName = slugify(parent[parent.length - 1]);
    }
    if (!dirName) dirName = 'skill_' + uid().slice(0, 6);
    let finalName = dirName;
    if (overwrite) {
      // 覆盖语义（流水线配置包导入）：同名目录直接复用名字，不生成 _2 后缀，先清空再写。
      used.add(finalName);
    } else {
      let k = 2;
      while (used.has(finalName)) finalName = dirName + '_' + (k++);
      used.add(finalName);
    }

    // 覆盖模式：写出前先删除同名技能目录，避免残留旧文件（引用已删的文件）。
    if (overwrite) {
      try { fs.rmSync(path.join(targetDir, finalName), { recursive: true, force: true }); } catch { /* 忽略 */ }
    }

    let wrote = 0;
    for (let j = 0; j < files.length; j++) {
      if (assigned.get(j) !== i) continue;
      const parts = files[j].parts;
      const relParts = parent.length === 0 ? parts : parts.slice(parent.length);
      const abs = path.join(targetDir, finalName, ...relParts);
      // 兜底：条目路径经上面的规范化后仍必须落在 targetDir 内（Win32 的点/空格归一化是
      // 文件系统层面的行为，正则拦不住所有形态）。越界宁可整包安装失败，也不能写出目录外。
      const inside = path.relative(targetDir, abs);
      if (!inside || inside.startsWith('..') || path.isAbsolute(inside)) throw new Error('zip 含不安全路径：' + files[j].parts.join('/'));
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, files[j].entry.getData());
      wrote++;
    }
    installed.push({ name: finalName, dir: finalName, files: wrote });
  }
  return installed;
}
