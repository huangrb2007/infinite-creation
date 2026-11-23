import { useCallback, useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { Check, ImagePlus } from 'lucide-react';
import { STYLE_LIBRARY } from '@shared';
import { Input, Spinner } from './ui.jsx';
import { api } from '../lib/api.js';

// 风格选择（版式参照白昼短剧）：左边预览图、右边「名称-真人/3D」和适配说明。
// 风格 = 风格预设（视频前置词 + 角色 / 场景渲染词，由软件统一加）；白昼技能包装了的话，它的 9 套画风排在最前面。
// value 是风格名；'' = 不指定（由 AI 按题材选）。
const BUILTIN_PREVIEWS = new Set(['real', 'costume-real', 'hk-film', 'wasteland', 'urban-drama', 'nextgen-3d', 'urban-3d', 'yhkt', 'guoman-3d', 'pixar', 'cyberpunk', 'guoman-2d', 'anime-jp', 'anime', 'cartoon', 'chibi', 'ink', 'comic', 'painterly']);

const staticList = () => STYLE_LIBRARY.map((s) => ({ id: s.id, name: s.name, kind: s.none ? '' : s.kind || (s.family === 'realistic' ? '真人' : '3D'), family: s.family, fit: s.fit || s.desc || '', hidden: !!s.hidden, none: !!s.none, source: s.video ? 'builtin' : 'legacy', group: '', preset: !!s.video, generatedPreview: false }));

export default function StylePicker({ value, onChange, allowNone = true }) {
  const [styles, setStyles] = useState(staticList);
  const [ver, setVer] = useState(0);
  const [gen, setGen] = useState({ busy: false, done: 0, total: 0, err: '' });
  const load = useCallback(() => api.get('/api/styles').then((r) => { if (Array.isArray(r.styles)) setStyles(r.styles); }).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);
  const base = import.meta.env.BASE_URL || '/';
  const inLib = styles.some((s) => s.name === value);
  const [custom, setCustom] = useState(!!value && !STYLE_LIBRARY.some((s) => s.name === value));
  // 技能包画风是从后端读的：读到之后，选中的是库里的风格就不算自定义
  useEffect(() => { if (value && styles.some((s) => s.name === value)) setCustom(false); }, [styles, value]);

  const groups = useMemo(() => {
    const vis = styles.filter((s) => !s.hidden || s.name === value);
    const g = [
      { id: 'none', label: '', list: vis.filter((s) => s.none) },
      { id: 'skill', label: '白昼风格（技能包）', list: vis.filter((s) => s.source === 'skill') },
      { id: 'real', label: '真人', list: vis.filter((s) => s.source !== 'skill' && !s.none && s.family === 'realistic') },
      { id: '3d', label: '3D / 2.5D', list: vis.filter((s) => s.source !== 'skill' && !s.none && s.family !== 'realistic') },
    ];
    return g.filter((x) => x.list.length);
  }, [styles, value]);

  const visible = styles.filter((s) => !s.hidden && !s.none);
  const missing = visible.filter((s) => !BUILTIN_PREVIEWS.has(s.id) && !s.generatedPreview);
  const srcOf = (s) => (s.generatedPreview ? '/api/styles/preview/' + s.id + '?v=' + ver : base + 'styles/' + s.id + '.jpg');
  const label = (s) => (s.kind && !s.name.includes(s.kind) ? s.name + '-' + s.kind : s.name);

  async function generateMissing(list) {
    setGen({ busy: true, done: 0, total: list.length, err: '' });
    let err = '';
    for (let k = 0; k < list.length; k++) {
      try { await api.post('/api/styles/preview', { id: list[k].id }); } catch (e) { err = list[k].name + '：' + e.message; }
      setGen({ busy: true, done: k + 1, total: list.length, err });
      await load();
      setVer((v) => v + 1);
    }
    setGen({ busy: false, done: list.length, total: list.length, err });
  }

  return (
    <div className="flex flex-col gap-3">
      {groups.map((g) => (
        <div key={g.id} className="flex flex-col gap-1.5">
          {g.label ? <span className="text-[11px] font-medium text-[var(--fg-3)]">{g.label}</span> : null}
          <div className="grid gap-2 sm:grid-cols-2">
            {g.list.map((s) => {
              const active = !custom && value === s.name;
              return (
                <button
                  key={s.id}
                  type="button"
                  title={s.fit}
                  onClick={() => { setCustom(false); onChange(s.name); }}
                  className={clsx(
                    'group relative flex h-[76px] items-stretch overflow-hidden rounded-xl border text-left transition-all duration-150',
                    active
                      ? 'border-[color-mix(in_srgb,var(--accent)_60%,transparent)] bg-[color-mix(in_srgb,var(--accent)_8%,transparent)] ring-1 ring-[color-mix(in_srgb,var(--accent)_40%,transparent)]'
                      : 'border-[var(--line)] bg-white/[0.02] hover:border-[var(--line-strong)]',
                  )}
                >
                  <span className="relative w-[96px] shrink-0 bg-[var(--panel-2)]">
                    {s.none ? (
                      <span className="flex h-full w-full flex-col items-center justify-center gap-1 text-[10px] text-[var(--fg-4)]">
                        <span className="h-5 w-5 rounded-full border border-dashed border-[var(--fg-4)]" />沿用原图
                      </span>
                    ) : (
                      <img src={srcOf(s)} alt={s.name} loading="lazy" className="h-full w-full object-cover" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
                    )}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 px-3">
                    <span className={clsx('truncate text-[13px] font-medium', active ? 'text-[var(--accent)]' : 'text-[var(--fg-2)]')}>{label(s)}</span>
                    <span className="line-clamp-2 text-[11px] leading-snug text-[var(--fg-4)]">{s.fit || (s.preset ? '角色、场景、道具与视频共用此风格预设' : '旧画风')}</span>
                  </span>
                  {active ? (
                    <span className="absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full bg-[var(--accent)]">
                      <Check size={12} strokeWidth={3} className="text-[var(--accent-ink)]" />
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {missing.length || gen.busy ? (
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--fg-4)]">
          <button type="button" disabled={gen.busy} onClick={() => generateMissing(missing)} className="inline-flex items-center gap-1 rounded-full border border-[var(--line)] px-2.5 py-1 text-[var(--fg-3)] hover:border-[var(--line-strong)] disabled:opacity-60">
            {gen.busy ? <Spinner size={11} /> : <ImagePlus size={12} />} {gen.busy ? '生成预览图 ' + gen.done + '/' + gen.total : '给 ' + missing.length + ' 个没有预览图的风格生成预览'}
          </button>
          <span>用你设置里的文生图模型出，每张算一次出图。</span>
          {gen.err ? <span className="text-[var(--danger)]">{gen.err}</span> : null}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-1.5">
        {allowNone ? (
          <Chip active={!custom && !value} onClick={() => { setCustom(false); onChange(''); }}>不指定（由 AI 按题材选）</Chip>
        ) : null}
        <Chip active={custom} onClick={() => { setCustom(true); if (inLib) onChange(''); }}>自定义风格</Chip>
      </div>
      {custom ? (
        <Input value={inLib ? '' : value || ''} onChange={(e) => onChange(e.target.value)} placeholder="描述自定义风格，例如：低饱和胶片颗粒、黏土定格动画" />
      ) : null}
    </div>
  );
}

function Chip({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'rounded-full border px-3 py-1.5 text-[12px] transition-all duration-150',
        active
          ? 'border-[color-mix(in_srgb,var(--accent)_45%,transparent)] bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-[var(--accent)]'
          : 'border-[var(--line)] bg-white/[0.02] text-[var(--fg-3)] hover:border-[var(--line-strong)] hover:text-[var(--fg-2)]',
      )}
    >
      {children}
    </button>
  );
}
