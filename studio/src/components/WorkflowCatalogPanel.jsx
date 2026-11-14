import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Cloud, Layers, RefreshCw } from 'lucide-react';
import { api } from '../lib/api.js';
import { Badge, Button, Field, Input, Select, Spinner, Switch } from './ui.jsx';
import { useToast } from './toast.jsx';

// 设置 → 工作流：云端 ComfyUI 与号池的工作流按类别列出，每个类别选一个给生产流水线用。
// 选择写在 cfg.catalog.selected（随「保存配置」一起写入）；刷新目录走后台任务，这里轮询进度。

const SOURCE_LABEL = { cloud: '云端', pool: '号池', api: 'LLM 接口' };
const SERIES_HINT = 'U=H3 视频 · B=Qwen 编辑 · N=声音 · J=数字人 · P=动作迁移';

function ago(ts) {
  if (!ts) return '从未刷新';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return '刚刚刷新';
  if (s < 3600) return Math.round(s / 60) + ' 分钟前刷新';
  if (s < 86400) return Math.round(s / 3600) + ' 小时前刷新';
  return new Date(ts).toLocaleString();
}

export default function WorkflowCatalogPanel({ cfg, setCfg, Section }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState('');
  const [detail, setDetail] = useState(null);
  const [poolTest, setPoolTest] = useState('');
  const timer = useRef(null);

  const catalog = cfg.catalog || {};
  const pool = catalog.pool || {};
  const setCatalog = (patch) => setCfg({ ...cfg, catalog: { ...catalog, ...patch } });

  const load = useCallback(async () => {
    try {
      const d = await api.get('/api/catalog');
      setData(d);
      setErr('');
      clearTimeout(timer.current);
      if (d.refreshing) timer.current = setTimeout(load, 1500);
    } catch (e) {
      setErr(e.message);
    }
  }, []);

  useEffect(() => {
    load();
    return () => clearTimeout(timer.current);
  }, [load]);

  async function refresh(which) {
    try {
      const d = await api.post('/api/catalog/refresh', { which, catalog, comfyuiBaseUrl: cfg.comfyui?.baseUrl });
      setData(d);
      timer.current = setTimeout(load, 1200);
      toast.success('开始刷新工作流目录');
    } catch (e) {
      toast.error('刷新失败：' + e.message);
    }
  }

  async function testPool() {
    setPoolTest('测试中…');
    try {
      const r = await api.post('/api/catalog/pool-test', { baseUrl: pool.baseUrl, key: pool.key });
      setPoolTest(r.ok ? '连接成功 · 可用工作流 ' + r.workflows + ' 个 · 并发上限 ' + (r.limits?.concurrency ?? '—') : '连接失败：' + r.error);
    } catch (e) {
      setPoolTest('连接失败：' + e.message);
    }
  }

  async function toggleDetail(key) {
    if (open === key) { setOpen(''); setDetail(null); return; }
    setOpen(key);
    setDetail(null);
    try { setDetail(await api.get('/api/catalog/detail?key=' + encodeURIComponent(key))); } catch (e) { setDetail({ error: e.message }); }
  }

  const selected = catalog.selected || {};
  const choose = (cat, v) => setCatalog({ selected: { ...selected, [cat]: v } });

  const refreshing = data?.refreshing;

  return (
    <>
      <Section icon={Cloud} title="工作流来源" description="从「ComfyUI 服务」里填的云端地址自动读取已保存的工作流；号池为可选的第二个来源。">
        <Switch
          checked={catalog.cloud?.enabled !== false}
          onChange={(v) => setCatalog({ cloud: { ...(catalog.cloud || {}), enabled: v } })}
          label="读取云端 ComfyUI 工作流"
          hint="使用「ComfyUI 服务」里填的地址。只用号池出片时关掉。"
        />
        {catalog.cloud?.enabled !== false ? (
        <Field label="读取哪些系列" hint={'按文件夹名开头的字母筛选，逗号分隔，留空读取全部（' + SERIES_HINT + '）'}>
          <Input
            value={(catalog.series || []).join(',')}
            onChange={(e) => setCatalog({ series: e.target.value.toUpperCase().split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean) })}
            placeholder="U,B,N,J,P"
            className="max-w-[260px]"
          />
        </Field>
        ) : null}

        <div className="flex flex-col gap-3 rounded-xl border border-[var(--line)] bg-black/20 p-3.5">
          <Switch
            checked={!!pool.enabled}
            onChange={(v) => setCatalog({ pool: { ...pool, enabled: v } })}
            label="启用 RH 号池"
            hint="号池里的工作流会和云端工作流一起出现在下方各类别里；视频等耗时任务可以按号池并发同时出片。"
          />
          {pool.enabled ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="号池地址">
                  <Input value={pool.baseUrl || ''} onChange={(e) => setCatalog({ pool: { ...pool, baseUrl: e.target.value.trim() } })} placeholder="https://duanju.jisu.chat" />
                </Field>
                <Field label="连接校验码" hint="号池后台 → 客户端 → 生成密钥">
                  <Input type="password" value={pool.key || ''} onChange={(e) => setCatalog({ pool: { ...pool, key: e.target.value.trim() } })} placeholder="只在本机保存" />
                </Field>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Select
                  value={pool.instanceType || 'default'}
                  onChange={(v) => setCatalog({ pool: { ...pool, instanceType: v } })}
                  items={[{ value: 'default', label: 'Standard' }, { value: 'plus', label: 'Plus' }]}
                  className="w-36"
                  size="sm"
                />
                <span className="flex items-center gap-2 text-[12px] text-[var(--fg-3)]">
                    同时出片
                    <Input
                      type="number"
                      min={1}
                      max={32}
                      value={String(catalog.poolConcurrency ?? 4)}
                      onChange={(e) => setCatalog({ poolConcurrency: Math.max(1, Math.min(32, Math.round(Number(e.target.value) || 1))) })}
                      className="h-9 w-20"
                    />
                    条
                </span>
                <Button variant="secondary" size="sm" onClick={testPool}>测试连接</Button>
              </div>
              {poolTest ? <p className={'m-0 text-[11.5px] ' + (poolTest.includes('成功') ? 'text-[var(--success)]' : poolTest.includes('失败') ? 'text-[var(--danger)]' : 'text-[var(--fg-3)]')}>{poolTest}</p> : null}
            </>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="md" onClick={() => refresh('all')} disabled={!!refreshing}>
            {refreshing ? <Spinner size={13} /> : <RefreshCw size={13} />} 刷新工作流目录
          </Button>
          {refreshing ? (
            <span className="text-[11.5px] text-[var(--fg-3)]">正在读取 {refreshing.done}/{refreshing.total || '…'}</span>
          ) : (
            <span className="text-[11.5px] text-[var(--fg-4)]">
              {catalog.cloud?.enabled !== false ? '云端 ' + (data?.cloud?.count ?? 0) + ' 个 · ' : ''}
              {pool.enabled ? '号池 ' + (data?.pool?.count ?? 0) + ' 个 · ' : ''}
              {ago(Math.max(data?.cloud?.refreshedAt || 0, data?.pool?.refreshedAt || 0))}
            </span>
          )}
        </div>
        <p className="m-0 text-[11px] text-[var(--fg-4)]">刷新按当前填写的内容读取；选好工作流后记得「保存配置」，生成时才会用上。</p>
        {catalog.cloud?.enabled !== false && data?.cloud?.error ? <p className="m-0 text-[11.5px] text-[var(--danger)]">云端读取失败：{data.cloud.error}</p> : null}
        {pool.enabled && data?.pool?.error ? <p className="m-0 text-[11.5px] text-[var(--danger)]">号池读取失败：{data.pool.error}</p> : null}
        {err ? <p className="m-0 text-[11.5px] text-[var(--danger)]">{err}</p> : null}
      </Section>

      <Section icon={Layers} title="按类别选用" description="每个类别选一个工作流；不选则使用内置默认（项目自带的 H3 / Qwen-Image / Qwen3-TTS / Music3 工作流）。">
        {!data ? (
          <Spinner size={16} />
        ) : (
          <div className="flex flex-col divide-y divide-[var(--line)]">
            {data.groups.map((g) => (
              <CategoryRow
                key={g.id}
                group={g}
                value={selected[g.id] || ''}
                onChange={(v) => choose(g.id, v)}
                noBuiltin={catalog.cloud?.enabled === false}
                open={open}
                detail={detail}
                onToggle={toggleDetail}
              />
            ))}
          </div>
        )}
        {data?.unclassified?.length ? (
          <p className="m-0 text-[11px] text-[var(--fg-4)]">另有 {data.unclassified.length} 个工作流没能判断类别（多为工具类/提示词类），未列出。</p>
        ) : null}
      </Section>
    </>
  );
}

function CategoryRow({ group, value, onChange, open, detail, onToggle, noBuiltin }) {
  const items = useMemo(() => {
    const BUILTIN = { digital_human: '内置（H3 视频工作流的数字人模式）', motion: '不使用' };
    // 不读云端 ComfyUI（只用号池）时，内置工作流没有地方运行，空选项显示为「未选择」
    const base = [{ value: '', label: noBuiltin ? '未选择' : BUILTIN[group.id] || '内置默认' }];
    // 音色 / 背景音乐可以明确不要：音色阶段跳过（视频模型自己配音）、成片不垫背景音乐
    const NONE = { tts: '不生成音色（视频模型自己配音）', music: '不加背景音乐' };
    if (NONE[group.id]) base.push({ value: 'none', label: NONE[group.id] });
    for (const it of group.items) {
      base.push({
        value: it.key,
        label: (it.ready ? '' : '⚠ ') + it.name + ' · ' + SOURCE_LABEL[it.source] + (it.folder ? '/' + it.folder.replace(/^([A-Z])[^-]*-?.*/, '$1') : ''),
      });
    }
    return base;
  }, [group.items, group.id, noBuiltin]);
  const cur = group.items.find((it) => it.key === value);
  const readyCount = group.items.filter((it) => it.ready).length;
  return (
    <div className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
      <div className="grid items-center gap-3 sm:grid-cols-[150px_minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <p className="m-0 text-[13px] font-medium text-[var(--fg)]">{group.label}</p>
          <p className="m-0 truncate text-[10.5px] text-[var(--fg-4)]" title={group.desc}>{group.desc}</p>
        </div>
        <Select value={value} onChange={onChange} items={items} size="sm" />
        <span className="flex items-center gap-1.5">
          {cur ? (
            cur.ready ? <Badge tone="success" dot>可用</Badge> : <Badge tone="danger" dot>需确认</Badge>
          ) : (
            <span className="text-[10.5px] text-[var(--fg-4)]">{group.items.length ? readyCount + '/' + group.items.length + ' 可用' : '暂无'}</span>
          )}
          {cur ? (
            <button type="button" className="rounded p-1 text-[var(--fg-4)] hover:text-[var(--fg)]" onClick={() => onToggle(cur.key)} aria-label="识别详情">
              {open === cur.key ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
          ) : null}
        </span>
      </div>
      {cur && open === cur.key ? <DetailBox detail={detail} /> : null}
    </div>
  );
}

const ROLE_LABEL = {
  positive_prompt: '提示词', negative_prompt: '负面词', seed: '种子', width: '宽', height: '高', seconds: '时长', frames: '帧数',
  aspect_ratio: '画幅', resolution: '分辨率', mode: '模式', image: '参考图', text: '台词', voice_description: '音色描述',
  ref_audio: '参考音', caption: '音乐描述', lyrics: '歌词', max_duration: '音乐时长', filename_prefix: '输出', scale: '超分倍数',
  avatar: '头像', speech: '语音', character: '人物图', driving_video: '动作视频',
};

function DetailBox({ detail }) {
  if (!detail) return <Spinner size={14} />;
  if (detail.error) return <p className="m-0 text-[11.5px] text-[var(--danger)]">{detail.error}</p>;
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-[var(--line)] bg-black/25 p-3 text-[11.5px]">
      {detail.family ? <p className="m-0 text-[var(--fg-3)]">识别为：{detail.family}</p> : null}
      {detail.issues?.length ? (
        <div className="flex flex-col gap-1">
          {detail.issues.map((s, i) => (
            <span key={i} className="flex items-start gap-1.5 text-[var(--danger)]"><AlertTriangle size={12} className="mt-[2px] shrink-0" />{s}</span>
          ))}
        </div>
      ) : (
        <span className="flex items-center gap-1.5 text-[var(--success)]"><CheckCircle2 size={12} />参数已全部识别</span>
      )}
      <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
        {Object.entries(detail.roles || {}).map(([k, r]) => (
          <span key={k} className="flex min-w-0 items-center gap-2">
            <span className="w-16 shrink-0 text-[var(--fg-4)]">{ROLE_LABEL[k] || k}</span>
            <span className="truncate font-mono text-[10.5px] text-[var(--fg-2)]" title={r.title + ' #' + r.node + ' · ' + r.field}>{r.title} · {r.field}</span>
          </span>
        ))}
        {Object.entries(detail.slots || {}).map(([k, list]) => (
          <span key={'slot-' + k} className="flex min-w-0 items-center gap-2">
            <span className="w-16 shrink-0 text-[var(--fg-4)]">{k === 'image' ? '图片槽' : k === 'audio' ? '音频槽' : '视频槽'}</span>
            <span className="text-[var(--fg-2)]">{list.length} 个</span>
          </span>
        ))}
      </div>
      <p className="m-0 text-[10.5px] text-[var(--fg-4)]">识别不准时：在 ComfyUI 里把对应节点标题加上标签（如「正向提示词 #prompt」「参考图 #image1」），保存后刷新目录即可。</p>
    </div>
  );
}
