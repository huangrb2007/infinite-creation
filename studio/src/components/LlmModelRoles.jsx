import { useMemo, useState } from 'react';
import { Plus, RefreshCw, X } from 'lucide-react';
import { api } from '../lib/api.js';
import { classifyModel } from '../lib/shared.js';
import { Badge, Button, Field, Input, Select, Spinner } from './ui.jsx';

// 设置 → LLM：这个接口下要用的模型（获取 + 手动添加），再按用途分配（主模型 / 视觉 / 改写）。
// 图片生成模型会出现在「工作流」页的文生图 / 图生图里。
const KIND_LABEL = { text: '文本', vision: '可看图', image: '图片生成', video: '视频生成', audio: '音频', other: '其它' };
const KIND_ORDER = { vision: 0, text: 1, image: 2, video: 3, audio: 4, other: 5 };
const KIND_CYCLE = ['text', 'vision', 'image', 'video', 'audio', 'other'];
const KIND_TONE = { vision: 'accent', image: 'success', video: 'info' };

export default function LlmModelRoles({ cfg, setCfg }) {
  const llm = cfg.llm || {};
  const roles = llm.roles || {};
  const models = llm.models || [];
  const [site, setSite] = useState([]);
  const [keyCount, setKeyCount] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [adding, setAdding] = useState('');

  const setLlm = (patch) => setCfg({ ...cfg, llm: { ...llm, ...patch } });
  const setRole = (k, v) => setLlm({ roles: { ...roles, [k]: v } });
  const setModels = (list) => setLlm({ models: list });

  async function fetchModels() {
    setLoading(true);
    setErr('');
    try {
      const r = await api.post('/api/llm/models', { baseUrl: llm.baseUrl, apiKey: llm.apiKey });
      if (!r.ok) throw new Error(r.error);
      setSite(r.site || []);
      setKeyCount(r.models.length);
      // 合并：接口返回的更新类型，之前手动添加的保留
      const map = new Map(models.map((m) => [m.id, m]));
      for (const m of r.models) map.set(m.id, { ...map.get(m.id), ...m });
      const siteMap = new Map((r.site || []).map((m) => [m.id, m]));
      setModels([...map.values()].map((m) => (m.manualKind || !siteMap.get(m.id) ? m : { ...m, kind: siteMap.get(m.id).kind })));
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  function addModel(raw) {
    const ids = String(raw || '').split(/[\s,，]+/).map((s) => s.trim()).filter(Boolean);
    if (!ids.length) return;
    const siteMap = new Map(site.map((m) => [m.id, m]));
    const have = new Set(models.map((m) => m.id));
    const next = [...models];
    for (const id of ids) {
      if (have.has(id)) continue;
      const sm = siteMap.get(id);
      next.push({ id, kind: sm?.kind || classifyModel(id), ...(sm?.label ? { label: sm.label } : {}), manual: true });
      have.add(id);
    }
    setModels(next);
    setAdding('');
  }
  const removeModel = (id) => setModels(models.filter((m) => m.id !== id));
  const cycleKind = (id) =>
    setModels(models.map((m) => (m.id === id ? { ...m, kind: KIND_CYCLE[(KIND_CYCLE.indexOf(m.kind) + 1) % KIND_CYCLE.length], manualKind: true } : m)));

  const sorted = useMemo(
    () => [...models].sort((a, b) => (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9) || a.id.localeCompare(b.id)),
    [models],
  );
  const chatModels = sorted.filter((m) => m.kind === 'text' || m.kind === 'vision' || m.kind === 'other');
  const toItems = (list, empty) => {
    const items = list.map((m) => ({ value: m.id, label: m.id + ' · ' + (KIND_LABEL[m.kind] || m.kind) }));
    return empty ? [{ value: '', label: empty }, ...items] : items;
  };
  const withCurrent = (items, cur) => (cur && !items.some((i) => i.value === cur) ? [{ value: cur, label: cur + ' · 手填' }, ...items] : items);
  const counts = models.reduce((o, m) => ((o[m.kind] = (o[m.kind] || 0) + 1), o), {});
  const suggestions = useMemo(() => {
    const have = new Set(models.map((m) => m.id));
    return site.filter((m) => !have.has(m.id));
  }, [site, models]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={fetchModels} disabled={loading || !llm.baseUrl}>
          {loading ? <Spinner size={13} /> : <RefreshCw size={13} />} 获取模型列表
        </Button>
        {models.length ? (
          <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--fg-4)]">
            已添加 {models.length} 个
            {Object.entries(counts).sort((a, b) => (KIND_ORDER[a[0]] ?? 9) - (KIND_ORDER[b[0]] ?? 9)).map(([k, n]) => (
              <Badge key={k} tone={KIND_TONE[k] || 'neutral'}>{KIND_LABEL[k] || k} {n}</Badge>
            ))}
          </span>
        ) : (
          <span className="text-[11px] text-[var(--fg-4)]">按当前填的 Base URL 和 Key 拉取可用模型；拉不全的可以在下面手动添加</span>
        )}
      </div>
      {err ? <p className="m-0 text-[11.5px] text-[var(--danger)]">{err}</p> : null}
      {keyCount !== null && site.length > keyCount ? (
        <p className="m-0 text-[11px] leading-relaxed text-[var(--fg-4)]">
          这个 Key 目前只开放了 {keyCount} 个模型（站点共 {site.length} 个）。要用其它模型，先到站点后台给这个 Key 的「模型限制」加上并保存，再点一次获取，或直接在下面添加。
        </p>
      ) : null}

      {sorted.length ? (
        <div className="flex flex-wrap gap-1.5">
          {sorted.map((m) => (
            <span
              key={m.id}
              className="inline-flex h-7 items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--panel-2)] pl-2.5 pr-1 text-[12px] text-[var(--fg-2)]"
              title={m.label ? m.label + '（' + m.id + '）' : m.id}
            >
              <span className="max-w-[260px] truncate">{m.id}</span>
              <button
                type="button"
                onClick={() => cycleKind(m.id)}
                title="点击切换类型（自动识别不准时用）"
                className="cursor-pointer border-0 bg-transparent p-0"
              >
                <Badge tone={KIND_TONE[m.kind] || 'neutral'}>{KIND_LABEL[m.kind] || m.kind}</Badge>
              </button>
              <button
                type="button"
                onClick={() => removeModel(m.id)}
                title="移除"
                className="grid h-5 w-5 cursor-pointer place-items-center rounded-full border-0 bg-transparent text-[var(--fg-4)] hover:bg-[var(--panel-3)] hover:text-[var(--fg-2)]"
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <div className="flex max-w-[520px] items-center gap-2">
        <Input
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addModel(adding); } }}
          placeholder={site.length ? '输入或选择模型名，回车添加（可一次粘贴多个）' : '手动添加模型名，回车添加（可一次粘贴多个）'}
          list="llm-site-models"
          className="h-9"
        />
        <datalist id="llm-site-models">
          {suggestions.map((m) => (
            <option key={m.id} value={m.id}>{(m.label ? m.label + ' · ' : '') + (KIND_LABEL[m.kind] || m.kind)}</option>
          ))}
        </datalist>
        <Button variant="secondary" size="sm" onClick={() => addModel(adding)} disabled={!adding.trim()}>
          <Plus size={13} /> 添加
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="主模型" hint="Agent 写剧本、拆分镜、写视频提示词">
          {chatModels.length ? (
            <Select value={llm.model || ''} onChange={(v) => setLlm({ model: v })} items={withCurrent(toItems(chatModels), llm.model)} size="sm" />
          ) : (
            <Input value={llm.model || ''} onChange={(e) => setLlm({ model: e.target.value })} placeholder="模型名" />
          )}
        </Field>
        <Field label="视觉模型" hint="看参考图：图生图前看图、导入素材自动命名、带图改写">
          <Select
            value={roles.vision || ''}
            onChange={(v) => setRole('vision', v)}
            items={withCurrent(toItems(chatModels.filter((m) => m.kind === 'vision').concat(chatModels.filter((m) => m.kind !== 'vision')), llm.vision ? '同主模型' : '不使用（主模型不看图）'), roles.vision)}
            size="sm"
          />
        </Field>
        <Field label="改写模型" hint="单镜提示词改写、音乐描述改写等短任务，可选更快更便宜的">
          <Select value={roles.rewrite || ''} onChange={(v) => setRole('rewrite', v)} items={withCurrent(toItems(chatModels, '同主模型'), roles.rewrite)} size="sm" />
        </Field>
      </div>
      {counts.image || counts.video || counts.audio ? (
        <p className="m-0 text-[11px] leading-relaxed text-[var(--fg-4)]">
          {counts.image ? '图片生成模型（' + counts.image + ' 个）会出现在「工作流」页的文生图 / 图生图里，保存后到那里选用。' : ''}
          {models.some((m) => m.kind === 'audio' && /qwen3-tts|qwen-tts/i.test(m.id)) ? 'Qwen3-TTS 语音模型会出现在「音色设计」里。' : ''}
          {counts.video ? '视频生成模型暂不能作出片来源。' : ''}
        </p>
      ) : null}
    </div>
  );
}
