import { useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { api } from '../lib/api.js';
import { Badge, Button, Field, Input, Select, Spinner } from './ui.jsx';

// 设置 → LLM：获取接口下的全部模型，按用途分配（主模型 / 视觉 / 改写）。
// 没获取列表时仍可手填主模型，与原来的用法一致。
const KIND_LABEL = { text: '文本', vision: '可看图', image: '图片生成', video: '视频生成', audio: '音频', other: '其它' };
const KIND_ORDER = { vision: 0, text: 1, image: 2, video: 3, audio: 4, other: 5 };

export default function LlmModelRoles({ cfg, setCfg }) {
  const llm = cfg.llm || {};
  const roles = llm.roles || {};
  const [models, setModels] = useState(() => llm.models || []);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [filter, setFilter] = useState('');

  const setLlm = (patch) => setCfg({ ...cfg, llm: { ...llm, ...patch } });
  const setRole = (k, v) => setLlm({ roles: { ...roles, [k]: v } });

  async function fetchModels() {
    setLoading(true);
    setErr('');
    try {
      const r = await api.post('/api/llm/models', { baseUrl: llm.baseUrl, apiKey: llm.apiKey });
      if (!r.ok) throw new Error(r.error);
      setModels(r.models);
      // 列表随配置保存，下次打开设置页不用再拉
      setLlm({ models: r.models });
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  const sorted = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return [...models]
      .filter((m) => !q || m.id.toLowerCase().includes(q))
      .sort((a, b) => (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9) || a.id.localeCompare(b.id));
  }, [models, filter]);
  const chatModels = sorted.filter((m) => m.kind === 'text' || m.kind === 'vision' || m.kind === 'other');
  const toItems = (list, empty) => {
    const items = list.map((m) => ({ value: m.id, label: m.id + ' · ' + (KIND_LABEL[m.kind] || m.kind) }));
    return empty ? [{ value: '', label: empty }, ...items] : items;
  };
  const withCurrent = (items, cur) => (cur && !items.some((i) => i.value === cur) ? [{ value: cur, label: cur + ' · 手填' }, ...items] : items);
  const counts = models.reduce((o, m) => ((o[m.kind] = (o[m.kind] || 0) + 1), o), {});

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={fetchModels} disabled={loading || !llm.baseUrl}>
          {loading ? <Spinner size={13} /> : <RefreshCw size={13} />} 获取模型列表
        </Button>
        {models.length ? (
          <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--fg-4)]">
            共 {models.length} 个
            {Object.entries(counts).sort((a, b) => (KIND_ORDER[a[0]] ?? 9) - (KIND_ORDER[b[0]] ?? 9)).map(([k, n]) => (
              <Badge key={k} tone={k === 'vision' ? 'accent' : 'neutral'}>{KIND_LABEL[k] || k} {n}</Badge>
            ))}
          </span>
        ) : (
          <span className="text-[11px] text-[var(--fg-4)]">按当前填的 Base URL 和 Key 拉取接口下的全部模型，再按用途分配</span>
        )}
      </div>
      {err ? <p className="m-0 text-[11.5px] text-[var(--danger)]">{err}</p> : null}

      {models.length > 12 ? (
        <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="筛选模型名…" className="h-9 max-w-[280px]" />
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="主模型" hint="Agent 写剧本、拆分镜、写视频提示词">
          {models.length ? (
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
      {counts.image || counts.video ? (
        <p className="m-0 text-[11px] leading-relaxed text-[var(--fg-4)]">
          这个接口还提供 {counts.image ? counts.image + ' 个图片生成' : ''}{counts.image && counts.video ? '、' : ''}{counts.video ? counts.video + ' 个视频生成' : ''}模型，可以在「工作流」页按类别选作出图 / 出片来源。
        </p>
      ) : null}
    </div>
  );
}
