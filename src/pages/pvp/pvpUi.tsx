// UI pieces shared by the PvP pages.
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Segmented, Select, typeColor } from '../../components/ui';
import { isElite, useData } from '../../lib/data';
import type { Pokemon } from '../../lib/types';
import { fastsPerCharged, formats, learnable, ratingClass, simMove } from './pvpUtils';
import './pvp.css';

/** League / cup picker: Great · Ultra · Master · Little as a segmented control, cups in a dropdown. */
export function FormatPicker({ value, onChange, compact }: { value: string; onChange: (key: string) => void; compact?: boolean }) {
  const { settings } = useData();
  const all = useMemo(() => formats(settings), [settings]);
  const main = all.filter((f) => f.main);
  const cups = all.filter((f) => !f.main);
  const label: Record<string, string> = { great: 'Great', ultra: 'Ultra', master: 'Master', little: 'Little' };
  const capLabel = (cp: number) => (cp >= 10000 ? 'no cap' : `${cp} CP`);
  return (
    <div className="row" style={{ gap: 8 }}>
      <Segmented size={compact ? 'sm' : undefined} options={main.map((f) => ({ id: f.key, label: <span title={`${f.title} · ${capLabel(f.cp)}`}>{label[f.key] || f.title}</span> }))}
        value={main.some((f) => f.key === value) ? value : ''} onChange={onChange} />
      {cups.length > 0 && (
        <Select className="sm" style={{ width: 'auto', maxWidth: 260 }} value={cups.some((c) => c.key === value) ? value : ''}
          options={[{ id: '', label: `Cups & formats (${cups.length})…` }, ...cups.map((c) => ({ id: c.key, label: `${c.title} · ${capLabel(c.cp)}` }))]}
          onChange={(v) => v && onChange(v)} />
      )}
    </div>
  );
}

/** Move name with type dot, linking to the move page. Handles typed Hidden Power etc. */
export function PvpMove({ id, p, link = true, style }: { id: string; p?: Pokemon; link?: boolean; style?: CSSProperties }) {
  const { moves } = useData();
  const m = simMove(moves, id);
  if (!m) return <span className="faint">—</span>;
  const elite = p ? isElite(p, id) || isElite(p, m.baseId) : false;
  const inner = (
    <span className="move" style={style}>
      <span className="type-dot" style={{ background: typeColor(m.type) }} />
      {m.name}{elite && <span className="elite" title="Elite / legacy move (Elite TM)">★</span>}
    </span>
  );
  return link ? <Link to={`/moves/${m.baseId}`} style={{ color: 'inherit' }}>{inner}</Link> : inner;
}

/** Moveset: fast move with turns, charged moves with energy cost and fast moves needed. */
export function Moveset({ moves: ids, p, stacked }: { moves: string[]; p?: Pokemon; stacked?: boolean }) {
  const { moves } = useData();
  const fast = simMove(moves, ids[0]);
  return (
    <div className={`moveset ${stacked ? 'stacked' : ''}`}>
      <span className="mv">
        <PvpMove id={ids[0]} p={p} />
        {fast && <span className="mv-meta" title={`${fast.turns} turn${fast.turns > 1 ? 's' : ''} (${fast.turns * 0.5}s) · ${fast.power} power · +${fast.energy} energy`}>{fast.turns}t</span>}
      </span>
      {ids.slice(1).filter((x) => x && x !== 'none').map((id) => {
        const c = simMove(moves, id);
        const n = fastsPerCharged(fast, c);
        return (
          <span className="mv" key={id}>
            <PvpMove id={id} p={p} />
            {c && <span className="mv-meta" title={`${c.energy} energy · ${c.power} power${n ? ` · ${n} ${fast?.name ?? 'fast move'}s from empty` : ''}`}>{c.energy}e{n ? ` · ${n}×` : ''}</span>}
          </span>
        );
      })}
    </div>
  );
}

/** Pick a fast/charged move from everything the Pokémon can learn (shows Trainer Battle stats). */
export function PvpMoveSelect({ p, shadow, kind, value, onChange, allowNone }: { p: Pokemon; shadow: boolean; kind: 'fast' | 'charged'; value: string; onChange: (id: string) => void; allowNone?: boolean }) {
  const { moves } = useData();
  const opts = useMemo(() => {
    const pool = learnable(p, shadow, moves)[kind];
    const ids = value && value !== 'none' && !pool.includes(value) && simMove(moves, value) ? [value, ...pool] : pool;
    const list = ids.map((id) => {
      const m = simMove(moves, id)!;
      const el = isElite(p, id) || isElite(p, m.baseId) ? ' ★' : '';
      const st = m.fast ? `${m.power}p ${m.energy}e ${m.turns}t` : `${m.power}p ${m.energy}e`;
      return { id, label: `${m.name}${el} · ${m.type} · ${st}` };
    });
    if (allowNone) list.unshift({ id: '', label: '— none —' });
    return list;
  }, [p, shadow, kind, moves, value, allowNone]);
  return <Select className="sm" value={value || ''} onChange={onChange} options={opts} />;
}

export function Rating({ r, title }: { r: number; title?: string }) {
  return <span className={`rating ${ratingClass(r)}`} title={title ?? 'Battle rating (500 = even, higher is better)'}>{r}</span>;
}

export function HpBar({ hp, max, color, label }: { hp: number; max: number; color?: string; label?: ReactNode }) {
  const pct = Math.max(0, Math.min(100, (hp / max) * 100));
  const c = color || (pct > 50 ? 'var(--good)' : pct > 20 ? 'var(--warn)' : 'var(--bad)');
  return (
    <div className="hp-wrap">
      {label !== undefined && <div className="row small" style={{ justifyContent: 'space-between' }}>{label}<span className="num muted">{hp} / {max} HP</span></div>}
      <div className="hpbar"><div style={{ width: `${pct}%`, background: c }} /></div>
    </div>
  );
}

/** Run an expensive computation after paint so a spinner can show. Re-runs when deps change. */
export function useDeferred<T>(compute: () => T, deps: unknown[], delay = 20): { value: T | null; busy: boolean } {
  const [state, setState] = useState<{ value: T | null; busy: boolean }>({ value: null, busy: true });
  useEffect(() => {
    let live = true;
    setState((s) => ({ value: s.value, busy: true }));
    const t = setTimeout(() => {
      try { const v = compute(); if (live) setState({ value: v, busy: false }); }
      catch (e) { console.error(e); if (live) setState({ value: null, busy: false }); }
    }, delay);
    return () => { live = false; clearTimeout(t); };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}

/** "PvPoke (2026-11-03 04:09:55)" → "Nov 3, 2026" */
export function useRankingsDate(): string | null {
  const { settings } = useData();
  const m = /\((\d{4}-\d{2}-\d{2})/.exec(settings.sources?.pvp || '');
  if (!m) return null;
  const d = new Date(m[1] + 'T00:00:00');
  return Number.isNaN(d.getTime()) ? m[1] : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function ShadowToggle({ p, value, onChange }: { p: Pokemon; value: boolean; onChange: (v: boolean) => void }) {
  return <label className="switch" title={p.shadowReleased ? 'Shadow: ×1.2 attack, ×0.833 defense' : 'Shadow form not released for this Pokémon'}>
    <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} /><span className="track" />Shadow{!p.shadowReleased && <span className="faint tiny">(unreleased)</span>}
  </label>;
}
