import { useState } from 'react';
import clsx from 'clsx';
import { Check } from 'lucide-react';
import { STYLE_LIBRARY } from '@shared';
import { Input } from './ui.jsx';

// 画风选择：带预览图的卡片网格。预览图在 studio/public/styles/<id>.jpg，同一个画面用各画风各出一张，方便对比。
// value 是画风名（库里的名字或自定义文本）；'' = 不指定。
export default function StylePicker({ value, onChange, allowNone = true }) {
  const inLib = STYLE_LIBRARY.some((s) => s.name === value);
  const [custom, setCustom] = useState(!!value && !inLib);
  const base = import.meta.env.BASE_URL || '/';
  return (
    <div className="flex flex-col gap-2.5">
      <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(132px,1fr))]">
        {STYLE_LIBRARY.map((s) => {
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
                src={base + 'styles/' + s.id + '.jpg'}
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
                <span className="block truncate text-[10.5px] text-[var(--fg-4)]">{s.desc}</span>
              </span>
            </button>
          );
        })}
      </div>
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
