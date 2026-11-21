import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, FolderOpen, Puzzle, ScanSearch, Upload } from 'lucide-react';
import { api, uploadBinary } from '../lib/api.js';
import { Badge, Button, Field, Input, Select, Spinner, Switch } from './ui.jsx';
import { useToast } from './toast.jsx';

// 设置 → 工作流 → 生成插件（参考字字动画的插件模式）。
// 插件是一个出片来源：启用后出现在「按类别选用」里（如视频类出现「豆包画布助手」），选中才会用到，不影响其它功能。
// 设置写在 cfg.catalog.plugins[id] = { enabled, params }，随「保存配置」写入。

export default function PluginPanel({ catalog, setCatalog, Section, onChanged }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState('');
  const [testing, setTesting] = useState('');
  const [result, setResult] = useState({});
  const fileRef = useRef(null);
  const conf = catalog.plugins || {};

  const load = useCallback(async () => {
    try { setData(await api.get('/api/plugins')); setErr(''); } catch (e) { setErr(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const setPlugin = (id, patch) => setCatalog({ plugins: { ...conf, [id]: { ...(conf[id] || {}), ...patch } } });
  const valuesOf = (p) => ({ ...(p.values || {}), ...(conf[p.id]?.params || {}) });
  const setParam = (p, key, v) => setPlugin(p.id, { params: { ...(conf[p.id]?.params || {}), [key]: v } });
  const enabledOf = (p) => (conf[p.id]?.enabled !== undefined ? conf[p.id].enabled !== false : p.enabled);

  async function test(p) {
    setTesting(p.id);
    try {
      const r = await api.post('/api/plugins/test', { id: p.id, params: valuesOf(p) });
      setResult((m) => ({ ...m, [p.id]: r }));
    } catch (e) {
      setResult((m) => ({ ...m, [p.id]: { ok: false, message: e.message } }));
    } finally {
      setTesting('');
    }
  }

  async function importZip(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const r = await uploadBinary('/api/plugins/upload', file, 'application/zip');
      toast.success('已导入插件 ' + r.id);
      await load();
      onChanged?.();
    } catch (er) {
      toast.error('导入失败：' + er.message);
    }
  }

  return (
    <Section icon={Puzzle} title="生成插件" description="把外部出片工具接进来（如本机的豆包画布助手）。启用并保存配置后，插件会出现在下面对应类别里，选中才会用来出片。">
      {!data ? (
        err ? <p className="m-0 text-[11.5px] text-[var(--danger)]">{err}</p> : <Spinner size={16} />
      ) : (
        <div className="flex flex-col gap-2.5">
          {data.plugins.length ? data.plugins.map((p) => {
            const on = enabledOf(p);
            const vals = valuesOf(p);
            const r = result[p.id];
            const expanded = open === p.id;
            return (
              <div key={p.id} className="flex flex-col gap-3 rounded-xl border border-[var(--line)] bg-black/20 p-3.5">
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" className="flex min-w-0 flex-1 items-center gap-2 border-0 bg-transparent p-0 text-left" onClick={() => setOpen(expanded ? '' : p.id)}>
                    {expanded ? <ChevronDown size={14} className="shrink-0 text-[var(--fg-3)]" /> : <ChevronRight size={14} className="shrink-0 text-[var(--fg-3)]" />}
                    <span className="flex min-w-0 flex-col">
                      <span className="flex flex-wrap items-center gap-1.5 text-[13px] font-medium text-[var(--fg)]">
                        {p.name}
                        {p.version ? <span className="text-[11px] font-normal text-[var(--fg-4)]">{p.version}</span> : null}
                        <Badge tone="info">{p.type === 'video' ? '视频' : '图片'} · {p.familyName}</Badge>
                        {p.builtin ? <Badge tone="neutral">内置</Badge> : <Badge tone="accent">已导入</Badge>}
                        {p.error ? <Badge tone="danger" dot>不可用</Badge> : null}
                      </span>
                      <span className="truncate text-[11px] text-[var(--fg-4)]" title={p.description}>{p.description}</span>
                    </span>
                  </button>
                  <Button variant="secondary" size="sm" onClick={() => test(p)} disabled={!!p.error || testing === p.id}>
                    {testing === p.id ? <Spinner size={12} /> : null} 测试连接
                  </Button>
                  <Switch checked={on} onChange={(v) => setPlugin(p.id, { enabled: v })} label="" disabled={!!p.error} />
                </div>
                {p.error ? <p className="m-0 text-[11.5px] text-[var(--danger)]">{p.error}</p> : null}
                {r ? <p className={'m-0 text-[11.5px] ' + (r.ok ? 'text-[var(--success)]' : 'text-[var(--danger)]')}>{r.message}</p> : null}
                {expanded ? (
                  <>
                    {p.help ? <p className="m-0 whitespace-pre-line text-[11.5px] leading-relaxed text-[var(--fg-3)]">{p.help}</p> : null}
                    {p.promptStyle === 'seedance' ? (
                      <p className="m-0 text-[11.5px] leading-relaxed text-[var(--fg-3)]">选它出片时：技能模式的分段与提示词自动改用 seedance-drama-prompt（中文时间轴写法），每段 {(p.capabilities?.durations || [5, 10, 15]).join(' / ')} 秒；精简模式的提示词也按 Seedance 写法拼。</p>
                    ) : null}
                    {(p.actions || []).length ? <PluginActions plugin={p} params={vals} /> : null}
                    <div className="grid gap-3 sm:grid-cols-2">
                      {p.params.map((f) => (
                        <ParamField key={f.key} f={f} plugin={p} params={vals} value={vals[f.key]} onChange={(v) => setParam(p, f.key, v)} />
                      ))}
                    </div>
                  </>
                ) : null}
              </div>
            );
          }) : <p className="m-0 text-[11.5px] text-[var(--fg-4)]">还没有插件。</p>}
          <div className="flex flex-wrap items-center gap-2">
            <input ref={fileRef} type="file" accept=".zip,application/zip" className="hidden" onChange={importZip} />
            <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()}><Upload size={13} /> 导入插件（.zip）</Button>
            <span className="text-[11px] text-[var(--fg-4)]">插件代码会在本机运行，只导入信得过的插件。改了开关和参数后记得「保存配置」。</span>
          </div>
        </div>
      )}
    </Section>
  );
}

function ParamField({ f, value, onChange, plugin, params }) {
  const label = f.label || f.key;
  if (f.type === 'file') return <FileField f={f} value={value} onChange={onChange} plugin={plugin} params={params} />;
  if (f.type === 'select') {
    return (
      <Field label={label} hint={f.hint}>
        <Select value={value ?? ''} onChange={onChange} items={(f.options || []).map((o) => (typeof o === 'object' ? o : { value: o, label: String(o) }))} size="sm" />
      </Field>
    );
  }
  if (f.type === 'switch' || f.type === 'boolean') {
    return <Switch checked={!!value} onChange={onChange} label={label} hint={f.hint} />;
  }
  if (f.type === 'number') {
    return (
      <Field label={label} hint={f.hint}>
        <Input type="number" min={f.min} max={f.max} value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} className="h-9" />
      </Field>
    );
  }
  return (
    <Field label={label} hint={f.hint}>
      <Input type={f.type === 'password' ? 'password' : 'text'} value={value ?? ''} onChange={(e) => onChange(e.target.value)} placeholder={f.placeholder || ''} className="h-9" />
    </Field>
  );
}

// 本机文件路径：「浏览」由本机后端弹出选择框（浏览器拿不到完整路径），「自动检测」调用插件动作
function FileField({ f, value, onChange, plugin, params }) {
  const toast = useToast();
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState(null);
  async function browse() {
    setBusy('browse');
    try {
      const r = await api.post('/api/plugins/browse', { filter: f.filter || '', title: f.label || '选择文件' });
      if (r.ok && r.value) { onChange(r.value); setMsg({ ok: true, text: '已选择，记得「保存配置」' }); }
      else if (r.message && r.message !== '没有选择文件') setMsg({ ok: false, text: r.message });
    } catch (e) { toast.error(e.message); } finally { setBusy(''); }
  }
  async function detect() {
    setBusy('detect');
    try {
      const r = await api.post('/api/plugins/action', { id: plugin.id, action: f.detectAction, params });
      if (r.ok && r.value) onChange(r.value);
      setMsg({ ok: !!r.ok, text: r.message || (r.ok ? '已找到' : '没找到') });
    } catch (e) { toast.error(e.message); } finally { setBusy(''); }
  }
  return (
    <Field label={f.label || f.key} hint={f.hint}>
      <div className="flex gap-2">
        <Input value={value ?? ''} onChange={(e) => onChange(e.target.value)} placeholder={f.placeholder || 'C:\\…\\豆包画布助手.exe'} className="h-9 min-w-0 flex-1" />
        <Button variant="secondary" size="sm" onClick={browse} disabled={!!busy}>{busy === 'browse' ? <Spinner size={12} /> : <FolderOpen size={13} />} 浏览</Button>
        {f.detectAction ? <Button variant="secondary" size="sm" onClick={detect} disabled={!!busy}>{busy === 'detect' ? <Spinner size={12} /> : <ScanSearch size={13} />} 自动检测</Button> : null}
      </div>
      {busy === 'browse' ? <p className="m-0 text-[11.5px] text-[var(--fg-3)]">文件选择框已打开，如果没看到，可能在其它窗口后面（看任务栏的「选择文件」）；也可以点「自动检测」。</p> : null}
      {msg ? <p className={'m-0 text-[11.5px] ' + (msg.ok ? 'text-[var(--success)]' : 'text-[var(--danger)]')}>{msg.text}</p> : null}
    </Field>
  );
}

// 插件清单里声明的操作按钮（如豆包画布助手的「同步登录状态」）
function PluginActions({ plugin, params }) {
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState(null);
  async function run(a) {
    setBusy(a.id);
    setMsg(null);
    try {
      const r = await api.post('/api/plugins/action', { id: plugin.id, action: a.id, params });
      setMsg({ ok: !!r.ok, text: r.message || (r.ok ? '完成' : '失败'), table: r.table || null });
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy('');
    }
  }
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-[var(--line)] bg-black/15 p-2.5">
      {plugin.actions.map((a) => (
        <div key={a.id} className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => run(a)} disabled={!!busy}>{busy === a.id ? <Spinner size={12} /> : null} {a.label}</Button>
          {a.hint ? <span className="min-w-0 flex-1 text-[11px] leading-relaxed text-[var(--fg-4)]">{a.hint}</span> : null}
        </div>
      ))}
      {msg ? <p className={'m-0 whitespace-pre-line text-[11.5px] ' + (msg.ok ? 'text-[var(--success)]' : 'text-[var(--danger)]')}>{msg.text}</p> : null}
      {msg?.table?.rows?.length ? <ActionTable table={msg.table} /> : null}
    </div>
  );
}

// 插件动作返回的表格（如「今日额度」）
function ActionTable({ table }) {
  return (
    <div className="max-h-[320px] overflow-auto rounded-md border border-[var(--line)]">
      <table className="w-full border-collapse text-[11.5px]">
        <thead className="sticky top-0 bg-[var(--bg-2,#1b1b1f)]">
          <tr>{table.columns.map((c) => <th key={c} className="whitespace-nowrap px-2 py-1.5 text-left font-medium text-[var(--fg-3)]">{c}</th>)}</tr>
        </thead>
        <tbody>
          {table.rows.map((row, i) => (
            <tr key={i} className="border-t border-[var(--line)]">
              {row.map((v, j) => <td key={j} className="whitespace-nowrap px-2 py-1 text-[var(--fg-2,var(--fg))]">{String(v ?? '')}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
