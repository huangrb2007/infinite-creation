// 选题 · 热门 IP：粘贴番茄小说榜单页面内容 → 整理书目 + 短剧改编潜力打分（drama-ip-scout 技能）。
// 只处理用户自己复制粘贴的公开页面内容，不访问网站、不抓取。
import { useState } from 'react';
import { Flame } from 'lucide-react';
import { api } from '../lib/api.js';
import { Badge, Button, Spinner, Textarea } from './ui.jsx';
import { Modal } from './overlays.jsx';
import { useToast } from './toast.jsx';

const SCORE_LABEL = { hook: '钩子', conflict: '冲突', payoff: '爽点', visual: '可拍', cost: '成本', episodes: '集数' };

export default function IpScoutModal({ open, onClose }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [openKey, setOpenKey] = useState('');

  async function run() {
    setBusy(true);
    try {
      const r = await api.post('/api/ip-scout', { text });
      if (r.error) throw new Error(r.error);
      setResult(r);
    } catch (e) {
      toast.error('初筛失败：' + (e?.message || String(e)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="选题 · 热门 IP"
      description="打开番茄小说的榜单页，全选复制页面内容粘贴到下面。只整理页面上看得到的书目，并按简介和标签给短剧改编潜力打分；改编前须取得版权方授权。"
      size="lg"
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <span className="text-[11px] text-[var(--fg-4)]">{result ? (result.listName || '榜单') + ' · ' + result.books.length + ' 本，按总分排序' : ''}</span>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>关闭</Button>
            <Button onClick={run} disabled={busy || !text.trim()}>{busy ? <Spinner size={13} /> : <Flame size={14} />} {busy ? '整理中…' : '整理并打分'}</Button>
          </div>
        </div>
      }
    >
      {!result ? (
        <Textarea rows={12} value={text} onChange={(e) => setText(e.target.value)} placeholder="把番茄小说榜单页面的内容粘贴到这里（书名、作者、简介、标签、字数等）" />
      ) : (
        <div className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto pr-1">
          {result.books.map((b) => (
            <div key={b.key} className="rounded-xl border border-[var(--line)] bg-[var(--panel-2)] p-3">
              <button type="button" className="flex w-full cursor-pointer items-start gap-3 border-0 bg-transparent p-0 text-left" onClick={() => setOpenKey(openKey === b.key ? '' : b.key)}>
                <span className="mt-0.5 w-10 shrink-0 text-center text-[18px] font-semibold text-[var(--accent)]">{b.total}</span>
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="text-[13px] font-medium text-[var(--fg-1)]">{b.title} <span className="text-[11.5px] font-normal text-[var(--fg-4)]">{b.author}{b.words ? ' · ' + b.words : ''}{b.status ? ' · ' + b.status : ''}</span></span>
                  {b.logline ? <span className="text-[12px] text-[var(--fg-3)]">{b.logline}</span> : null}
                  <span className="flex flex-wrap gap-1">
                    {Object.entries(b.scores).map(([k, v]) => <Badge key={k} tone={v.score >= 4 ? 'success' : v.score <= 2 ? 'neutral' : 'accent'}>{SCORE_LABEL[k]} {v.score ?? '-'}</Badge>)}
                    {(b.adaptTags || []).map((t) => <Badge key={t} tone="info">{t}</Badge>)}
                  </span>
                </span>
              </button>
              {openKey === b.key ? (
                <div className="mt-2 flex flex-col gap-1 border-t border-[var(--line)] pt-2 text-[11.5px] leading-relaxed text-[var(--fg-3)]">
                  {b.blurb ? <p className="m-0">简介：{b.blurb}</p> : null}
                  {Object.entries(b.scores).map(([k, v]) => <p key={k} className="m-0">{SCORE_LABEL[k]} {v.score ?? '-'}：{v.reason}</p>)}
                  <p className="m-0">人物约 {b.castEstimate ?? '?'} 个 · 场景约 {b.sceneEstimate ?? '?'} 个 · 集数 {Array.isArray(b.episodeRange) ? b.episodeRange.join('–') : '?'}</p>
                  <p className="m-0 text-[var(--danger)]">风险：{b.risks.join('；')}</p>
                </div>
              ) : null}
            </div>
          ))}
          <div><Button size="sm" variant="secondary" onClick={() => setResult(null)}>重新粘贴</Button></div>
        </div>
      )}
    </Modal>
  );
}
