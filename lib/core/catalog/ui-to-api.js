// ComfyUI 界面格式（保存的工作流：nodes + links）→ API 格式（/prompt 可提交）。
//
// ComfyUI 前端提交时做的就是这件事（graphToPrompt），这里在服务端复现常用部分：
//   · 子图（definitions.subgraphs）展开，内部节点 id 记为「实例id:内部id」（与前端一致，可多层）
//   · 跳过 mode=2（静音）节点；mode=4（绕过）节点按类型把输入直通到输出
//   · 虚拟节点：Reroute、PrimitiveNode、Note、KJNodes 的 SetNode/GetNode
//   · widgets_values 按 /object_info 的 input_order 对齐，处理 control_after_generate、上传按钮、动态下拉
// 无法确定的地方记进 issues，不静默猜。
const VIRTUAL = new Set(['Note', 'MarkdownNote', 'Reroute', 'PrimitiveNode', 'SetNode', 'GetNode', 'Fast Groups Bypasser (rgthree)', 'Fast Groups Muter (rgthree)', 'Bookmark (rgthree)', 'Label (rgthree)', 'Image Comparer (rgthree)']);
const CONTROL_TOKENS = new Set(['fixed', 'increment', 'decrement', 'randomize', 'increment-wrap']);
const UPLOAD_TOKENS = new Set(['image', 'audio', 'video', 'Upload']);
const PRIMS = new Set(['INT', 'FLOAT', 'STRING', 'BOOLEAN', 'COMBO']);

function linkObj(l) {
  if (Array.isArray(l)) return { id: l[0], origin_id: l[1], origin_slot: l[2], target_id: l[3], target_slot: l[4], type: l[5] };
  return l;
}

function isWidgetSpec(spec) {
  if (!Array.isArray(spec)) return false;
  if (spec[1]?.forceInput) return false; // 只能连线的输入，不占 widget 位
  const t = spec[0];
  if (Array.isArray(t)) return true; // 旧式 COMBO：直接给选项数组
  if (typeof t !== 'string') return false;
  if (spec[1]?.widgetType) return true; // 「FLOAT,INT」这类多类型输入，按 widgetType 出控件
  return PRIMS.has(t) || /DYNAMICCOMBO/i.test(t);
}

function widgetDefs(def) {
  if (!def?.input) return [];
  const order = def.input_order || {};
  const out = [];
  for (const sect of ['required', 'optional']) {
    const specs = def.input[sect] || {};
    const names = order[sect] || Object.keys(specs);
    for (const name of names) {
      const spec = specs[name];
      if (isWidgetSpec(spec)) out.push({ name, spec });
    }
  }
  return out;
}

function hasControl(name, spec) {
  const t = spec[0];
  const opt = spec[1] || {};
  if (opt.control_after_generate) return true;
  return (t === 'INT' || opt.widgetType === 'INT') && /^(seed|noise_seed)$/.test(name);
}
function hasUpload(spec) {
  const opt = spec[1] || {};
  return !!(opt.image_upload || opt.audio_upload || opt.video_upload || opt.upload);
}
function comboOptions(spec) {
  if (Array.isArray(spec[0])) return spec[0];
  if (spec[0] === 'COMBO') return spec[1]?.options || null;
  return null;
}

function defaultOf(spec) {
  const opt = spec[1] || {};
  if (opt.default !== undefined) return opt.default;
  const opts = comboOptions(spec);
  if (opts?.length) return opts[0];
  if (typeof spec[0] === 'string' && /DYNAMICCOMBO/i.test(spec[0])) return opt.options?.[0]?.key;
  return undefined;
}

// 把 widgets_values 对齐到 widget 名，返回 { name: value }
// 动态下拉（COMFY_DYNAMICCOMBO_V3）可以多层嵌套：选中项自带子 widget，API 键名逐层拼成「format.codec.encoding.crf」。
// widgets_values 比定义短时（工作流保存于节点新增参数之前），缺的按 object_info 默认值补齐——与前端加载时的行为一致。
// LoRA 列表控件（rgthree Power Lora Loader、各家 H3 加载器）：前端把每一行展开成 lora_1、lora_2 … 提交
const isLoraRow = (v) => v && typeof v === 'object' && !Array.isArray(v) && 'lora' in v;
function loraRow(v) {
  const o = {};
  for (const [k, x] of Object.entries(v)) if (x !== null && x !== undefined) o[k] = x;
  return o;
}

function mapWidgets(node, def, issues) {
  const wv = node.widgets_values;
  if (wv != null && !Array.isArray(wv)) {
    // VHS 等节点把 widgets_values 存成 { 名字: 值 }；去掉只给界面用的预览/上传按钮
    const o = {};
    for (const [k, v] of Object.entries(wv)) {
      if (/preview$|^choose |upload$/i.test(k) || (v && typeof v === 'object' && !Array.isArray(v))) continue;
      o[k] = v;
    }
    return o;
  }
  // 核心节点后来新增的可选参数，旧工作流里没存 → 按默认值补；第三方节点的可选参数常是前端动态增减的，不补
  const core = /^(comfy|nodes)/.test(String(def?.python_module || 'nodes'));
  const vals = Array.isArray(wv) ? [...wv] : [];
  const out = {};
  let i = 0;
  const consume = (defs, prefix) => {
    for (const { name, spec } of defs) {
      const key = prefix + name;
      const opts = comboOptions(spec);
      let v;
      if (i < vals.length) {
        v = vals[i++];
        // 值对不上选项、但下一个值对得上 → 前面多了一个前端专用值（错位修正）
        if (opts && !opts.includes(v) && i < vals.length && opts.includes(vals[i])) v = vals[i++];
        // 前端显示「Ref2VA — 参考生音视频」这类带说明的标签，提交时用的是选项本身
        else if (opts && typeof v === 'string' && !opts.includes(v)) {
          const hit = opts.filter((o) => typeof o === 'string' && o && v.startsWith(o)).sort((a, b) => b.length - a.length)[0];
          if (hit) v = hit;
        }
      } else {
        if (optionalNames.has(name) && !core && !prefix) continue;
        v = defaultOf(spec);
        if (v === undefined) continue;
      }
      // 第三方节点的可选空槽（如「参考图 3～9」留空）前端不提交
      if (!core && !prefix && optionalNames.has(name) && (v === '' || v === null)) continue;
      // 以 JSON 字符串保存的 LoRA 列表 → 展开成 lora_N
      if (typeof v === 'string' && v.startsWith('[') && /"lora"/.test(v)) {
        try {
          const rows = JSON.parse(v);
          if (Array.isArray(rows) && rows.every(isLoraRow)) { rows.forEach((r, k) => { out['lora_' + (k + 1)] = loraRow(r); }); continue; }
        } catch {}
      }
      out[key] = v;
      if (typeof spec[0] === 'string' && /DYNAMICCOMBO/i.test(spec[0])) {
        const choice = (spec[1]?.options || []).find((o) => o.key === v);
        if (choice) consume(widgetDefs({ input: choice.inputs || {} }), key + '.');
      }
      if ((spec[0] === 'INT' || spec[0] === 'FLOAT') && hasControl(name, spec) && CONTROL_TOKENS.has(vals[i])) i++;
      if (opts && hasUpload(spec) && UPLOAD_TOKENS.has(vals[i])) i++;
    }
  };
  const optionalNames = new Set(Object.keys(def?.input?.optional || {}));
  consume(widgetDefs(def), '');
  // 剩下的值里若是 LoRA 行（rgthree 风格：表头 + 若干行 + 「➕ Add Lora」按钮），按前端的命名补上
  if (i < vals.length && vals.slice(i).some(isLoraRow)) {
    let k = 0;
    for (; i < vals.length; i++) {
      const v = vals[i];
      if (isLoraRow(v)) out['lora_' + (++k)] = loraRow(v);
      else if (v && typeof v === 'object' && v.type === 'PowerLoraLoaderHeaderWidget') out.PowerLoraLoaderHeaderWidget = { type: 'PowerLoraLoaderHeaderWidget' };
      else if (v === '') out['➕ Add Lora'] = '';
    }
  }
  if (i < vals.length) {
    const rest = vals.slice(i).filter((x) => !(CONTROL_TOKENS.has(x) || UPLOAD_TOKENS.has(x) || x === null || x === ''));
    if (rest.length) issues.push('节点 ' + node.id + '（' + node.type + '）有 ' + rest.length + ' 个参数没对上');
  }
  return out;
}

// 前端提交时把文件名前缀里的 %date:yyyyMMdd% 换成当天日期（ComfyUI 后端不做这一步）
function replaceDate(str, now = new Date()) {
  const p2 = (n) => String(n).padStart(2, '0');
  return str.replace(/%date:([^%]+)%/g, (_, fmt) => fmt
    .replace(/yyyy/g, now.getFullYear()).replace(/yy/g, String(now.getFullYear()).slice(2))
    .replace(/MM/g, p2(now.getMonth() + 1)).replace(/dd/g, p2(now.getDate()))
    .replace(/hh/g, p2(now.getHours())).replace(/mm/g, p2(now.getMinutes())).replace(/ss/g, p2(now.getSeconds())));
}

/**
 * @param {object} ui         界面格式工作流
 * @param {object} objectInfo 云端 /object_info
 * @returns {{ prompt: object, issues: string[] }}
 */
export function uiToApi(ui, objectInfo = {}) {
  const issues = [];
  const subgraphs = new Map((ui?.definitions?.subgraphs || []).map((s) => [s.id, s]));
  // scope：一层图（根图或某个子图实例），nodes/links 按原 id 索引
  const mkScope = (graph, prefix, instance, parent) => ({
    prefix,
    instance,
    parent,
    def: graph,
    nodes: new Map((graph.nodes || []).map((n) => [n.id, n])),
    links: new Map((graph.links || []).map((l) => { const o = linkObj(l); return [o.id, o]; })),
  });
  const root = mkScope(ui || {}, '', null, null);
  const setters = new Map(); // SetNode 名 → { scope, node }
  const prompt = {};
  const instanceScopes = new Map();

  function childScope(scope, node) {
    const key = scope.prefix + node.id;
    if (!instanceScopes.has(key)) instanceScopes.set(key, mkScope(subgraphs.get(node.type), key + ':', node, scope));
    return instanceScopes.get(key);
  }

  // 解析某个 scope 内一条连线的「真实来源」：返回 ['节点id', slot] 或 { value }，找不到返回 null
  function resolveLink(scope, linkId, depth = 0) {
    if (linkId == null || depth > 64) return null;
    const l = scope.links.get(linkId);
    if (!l) return null;
    return resolveOutput(scope, l.origin_id, l.origin_slot, depth + 1);
  }

  function resolveOutput(scope, nodeId, slot, depth) {
    if (nodeId === -10) {
      // 子图输入：按名字回到父图里实例节点的同名输入（实例的 inputs 顺序与子图定义不一定一致）
      const inst = scope.instance;
      if (!inst) return null;
      const defs = scope.def.inputs || [];
      const name = defs[slot]?.name;
      const input = (inst.inputs || []).find((x) => x.name === name);
      if (input?.link != null) return resolveLink(scope.parent, input.link, depth);
      // 没连线：值在实例的 widgets_values 里。顺序 = 子图输入中「属于 widget」的那些（实例上带 widget 标记，
      // 或被提升为控件而根本不出现在实例 inputs 里）
      const widgetNames = defs.map((d) => d.name).filter((n) => {
        const ii = (inst.inputs || []).find((x) => x.name === n);
        return !ii || ii.widget;
      });
      const wi = widgetNames.indexOf(name);
      if (wi >= 0 && Array.isArray(inst.widgets_values) && inst.widgets_values[wi] !== undefined) return { value: inst.widgets_values[wi] };
      return null;
    }
    const node = scope.nodes.get(nodeId);
    if (!node) return null;
    if (node.mode === 2) return null;
    if (subgraphs.has(node.type)) {
      const child = childScope(scope, node);
      const out = child.def.outputs?.[slot];
      const lid = out?.linkIds?.[0];
      return lid != null ? resolveLink(child, lid, depth) : null;
    }
    if (node.type === 'Reroute') return resolveLink(scope, node.inputs?.[0]?.link, depth);
    if (node.type === 'PrimitiveNode') return { value: Array.isArray(node.widgets_values) ? node.widgets_values[0] : undefined };
    if (node.type === 'GetNode') {
      const name = Array.isArray(node.widgets_values) ? node.widgets_values[0] : '';
      const s = setters.get(name);
      return s ? resolveLink(s.scope, s.node.inputs?.[0]?.link, depth) : null;
    }
    if (node.mode === 4) {
      // 绕过：找类型相同的输入直通
      const outType = node.outputs?.[slot]?.type;
      const inp = (node.inputs || []).find((x) => x.link != null && (x.type === outType || outType === '*')) || (node.inputs || []).find((x) => x.link != null);
      return inp ? resolveLink(scope, inp.link, depth) : null;
    }
    return [scope.prefix + node.id, slot];
  }

  // 先登记所有 SetNode（GetNode 可能出现在 SetNode 之前）
  (function collect(scope) {
    for (const n of scope.nodes.values()) {
      if (n.type === 'SetNode') setters.set(Array.isArray(n.widgets_values) ? n.widgets_values[0] : '', { scope, node: n });
      if (subgraphs.has(n.type) && n.mode !== 2) collect(childScope(scope, n));
    }
  })(root);

  (function emit(scope) {
    for (const n of scope.nodes.values()) {
      if (n.mode === 2 || n.mode === 4) continue;
      if (subgraphs.has(n.type)) { emit(childScope(scope, n)); continue; }
      if (VIRTUAL.has(n.type)) continue;
      const def = objectInfo[n.type];
      if (!def && /Note|Label|Bookmark|Comparer|Everywhere|Muter|Bypasser|rgthree/i.test(n.type)) continue;
      if (/Everywhere/i.test(n.type)) issues.push('使用了 Anything Everywhere 广播连线，无法自动转换');
      const inputs = def ? mapWidgets(n, def, issues) : {};
      for (const [k, v] of Object.entries(inputs)) if (typeof v === 'string' && v.includes('%date:')) inputs[k] = replaceDate(v);
      if (!def) issues.push('云端没有节点类型 ' + n.type);
      for (const inp of n.inputs || []) {
        if (inp.link == null) continue;
        const src = resolveLink(scope, inp.link);
        const key = inp.widget?.name || inp.name;
        // 来源找不到（静音/断开）：widget 输入保留节点自己的值，纯连线输入去掉
        if (src == null) { if (!inp.widget) delete inputs[key]; continue; }
        inputs[key] = Array.isArray(src) ? src : src.value;
      }
      // MiniMax H3 Easy：参考素材不走普通连线，而是前端扩展存在 properties 里的「虚拟连线」，
      // 提交时由它的前端脚本展开成 media_1/media_type_1 …（顺序即数组顺序）
      const vlinks = n.properties?.minimax_h3_virtual_media_links;
      if (Array.isArray(vlinks)) {
        let k = 0;
        for (const v of vlinks) {
          const src = resolveOutput(scope, v.source_id, v.source_slot ?? 0, 1);
          if (!Array.isArray(src)) continue;
          k += 1;
          inputs['media_' + k] = src;
          inputs['media_type_' + k] = v.media_type || String(v.source_type || 'image').toLowerCase();
        }
        delete inputs.media;
      }
      prompt[scope.prefix + n.id] = { class_type: n.type, inputs, _meta: { title: n.title || def?.display_name || n.type } };
    }
  })(root);

  // 连到已被删除节点（静音/虚拟）的输入去掉，避免提交时报缺节点
  for (const node of Object.values(prompt)) {
    for (const [k, v] of Object.entries(node.inputs)) {
      if (Array.isArray(v) && typeof v[0] === 'string' && !prompt[v[0]]) delete node.inputs[k];
    }
  }
  return { prompt, issues: [...new Set(issues)] };
}
