import { useCallback, useEffect, useState } from 'react';
import clsx from 'clsx';
import { Check, ImagePlus } from 'lucide-react';
import { STYLE_LIBRARY } from '@shared';
import { Input, Spinner } from './ui.jsx';
import { api } from '../lib/api.js';

// 画风选择：带预览图的卡片网格。预览图在 studio/public/styles/<id>.jpg，同一个画面用各画风各出一张，方便对比。
// value 是画风名（库里的名字或自定义文本）；'' = 不指定。
const GROUPS = [
  { id: 'realistic', label: '真人' },
  { id: '3d', label: '3D 漫剧（写实比例 3D / 国漫 / 卡通）' },
];
// 内置预览图（studio/public/styles/<id>.jpg）的画风；其余的用「生成预览图」用自己的出图模型出
const BUILTIN_PREVIEWS = new Set(['real', 'costume-real', 'hk-film', 'wasteland', 'urban-drama', 'nextgen-3d', 'urban-3d', 'yhkt', 'guoman-3d', 'pixar', 'cyberpunk', 'guoman-2d', 'anime-jp', 'anime', 'cartoon', 'chibi', 'ink', 'comic', 'painterly']);

export default function StylePicker({ value, onChange, allowNone = true }) {
  const inLib = STYLE_LIBRARY.some((s) => s.name === value);
  const [custom, setCustom] = useState(!!value && !inLib);
  const base = import.meta.env.BASE_URL || '/';
  const [generated, setGenerated] = useState(() => new Set());
  const [ver, setVer] = useState(0);
  const [gen, setGen] = useState({ busy: false, done: 0, total: 0, err: '' });
  const loadGenerated = useCallback(() => api.get('/api/styles/preview').then((r) => setGenerated(new Set(r.ids || []))).catch(() => {}), []);
  useEffect(() => { loadGenerated(); }, [loadGenerated]);
  const visible = STYLE_LIBRARY.filter((s) => !s.hidden);
  const missing = visible.filter((s) => !BUILTIN_PREVIEWS.has(s.id) && !generated.has(s.id));
  const srcOf = (s) => (generated.has(s.id) ? '/api/styles/preview/' + s.id + '?v=' + ver : base + 'styles/' + s.id + '.jpg');
  async function generateMissing(list) {
    setGen({ busy: true, done: 0, total: list.length, err: '' });
    let err = '';
    for (let k = 0; k < list.length; k++) {
      try { await api.post('/api/styles/preview', { id: list[k].id }); } catch (e) { err = list[k].name + '：' + e.message; }
      setGen({ busy: true, done: k + 1, total: list.length, err });
      await loadGenerated();
      setVer((v) => v + 1);
    }
    setGen({ busy: false, done: list.length, total: list.length, err });
  }
  return (
    <div className="flex flex-col gap-2.5">
      {GROUPS.map((g) => {
        // 二维画风已隐藏；老项目正在用的那个仍然显示，方便看到当前选择
        const list = STYLE_LIBRARY.filter((s) => (g.id === 'realistic' ? s.family === 'realistic' : s.family !== 'realistic') && (!s.hidden || s.name === value))
          .map((s, k) => [s, k]).sort((a, b) => String(a[0].genre || '').localeCompare(String(b[0].genre || ''), 'zh') || a[1] - b[1]).map((x) => x[0]);
        if (!list.length) return null;
        return (
      <div key={g.id} className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium text-[var(--fg-3)]">{g.label}</span>
      <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(132px,1fr))]">
        {list.map((s) => {
          const active = !custom && value === s.name;
          return (
            <button
              key={s.id}
              type="button"
              title={s.desc}
              onClick={() => { setCustom(false); onChange(s.name); }}
              className={clsx(
                'group relative overflow-hidden rounded-xl border text-left transition-all duration-150',
                active
                  ? 'border-[color-mix(in_srgb,var(--accent)_60%,transparent)] ring-1 ring-[color-mix(in_srgb,var(--accent)_40%,transparent)]'
                  : 'border-[var(--line)] hover:border-[var(--line-strong)]',
              )}
            >
              <img
                src={srcOf(s)}
                alt={s.name}
                loading="lazy"
                className="aspect-video w-full bg-[var(--panel-2)] object-cover"
                onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
              />
              {active ? (
                <span className="absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full bg-[var(--accent)]">
                  <Check size={12} strokeWidth={3} className="text-[var(--accent-ink)]" />
                </span>
              ) : null}
              <span className="block px-2 py-1.5">
                <span className={clsx('block truncate text-[12px] font-medium', active ? 'text-[var(--accent)]' : 'text-[var(--fg-2)]')}>{s.name}</span>
                <span className="block truncate text-[10.5px] text-[var(--fg-4)]">{s.genre ? s.genre + ' · ' : ''}{s.desc}</span>
              </span>
            </button>
          );
        })}
      </div>
      </div>
        );
      })}
      {missing.length || gen.busy ? (
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--fg-4)]">
          <button type="button" disabled={gen.busy} onClick={() => generateMissing(missing)} className="inline-flex items-center gap-1 rounded-full border border-[var(--line)] px-2.5 py-1 text-[var(--fg-3)] hover:border-[var(--line-strong)] disabled:opacity-60">
            {gen.busy ? <Spinner size={11} /> : <ImagePlus size={12} />} {gen.busy ? '生成预览图 ' + gen.done + '/' + gen.total : '给 ' + missing.length + ' 个没有预览图的画风生成预览'}
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
