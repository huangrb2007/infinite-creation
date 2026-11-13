// 静态校验：用云端 /object_info 检查转换出来的 API 工作流（只看真正会执行的节点——从保存节点倒推可达的部分）。
// 与 ComfyUI 提交时的校验同一套规则：必填输入齐全、下拉值在选项里、数字在范围内、节点类型存在。
// 不提交、不占显卡，刷新目录时对每个工作流跑一遍，有问题的标「需确认」。
const isLink = (v) => Array.isArray(v) && v.length === 2 && typeof v[0] === 'string';

export function reachable(prompt, outputClasses) {
  const roots = Object.keys(prompt).filter((id) => (outputClasses?.length
    ? outputClasses.includes(prompt[id].class_type)
    : /Save|VideoCombine/i.test(prompt[id].class_type)));
  const keep = new Set();
  const stack = [...roots];
  while (stack.length) {
    const id = stack.pop();
    if (keep.has(id) || !prompt[id]) continue;
    keep.add(id);
    for (const v of Object.values(prompt[id].inputs || {})) if (isLink(v)) stack.push(v[0]);
  }
  return keep;
}

function comboOptions(spec) {
  if (Array.isArray(spec?.[0])) return spec[0];
  if (spec?.[0] === 'COMBO') return spec[1]?.options || null;
  return null;
}

export function validateApiPrompt(prompt, objectInfo, { outputs } = {}) {
  const errors = [];
  if (!objectInfo) return errors;
  for (const id of reachable(prompt, outputs)) {
    const n = prompt[id];
    const def = objectInfo[n.class_type];
    const label = (n._meta?.title || n.class_type) + '#' + id;
    if (!def) { errors.push(label + '：云端没有这个节点'); continue; }
    const req = def.input?.required || {};
    for (const [name, spec] of Object.entries(req)) {
      const v = n.inputs?.[name];
      if (v === undefined) {
        // 动态下拉的子参数以「父.子」形式出现，父值存在即可
        if (!Object.keys(n.inputs || {}).some((k) => k.startsWith(name + '.'))) errors.push(label + '：缺少必填参数 ' + name);
        continue;
      }
      if (isLink(v)) continue;
      const opts = comboOptions(spec);
      // 文件类下拉（模型、图片）在提交前会被替换或由云端校验，这里只查非文件的枚举
      if (opts && opts.length && !opts.includes(v) && !/\.(safetensors|ckpt|pt|pth|bin|gguf|png|jpe?g|webp|wav|mp3|flac|mp4|json)$/i.test(String(v))) {
        errors.push(label + '：' + name + ' 的值「' + String(v).slice(0, 30) + '」不在可选项里');
      }
      const o = spec?.[1] || {};
      if (typeof v === 'number' && ((o.min !== undefined && v < o.min) || (o.max !== undefined && v > o.max))) {
        errors.push(label + '：' + name + '=' + v + ' 超出范围');
      }
    }
  }
  return errors;
}
