// Shared UI building blocks. Keep these generic — feature-specific widgets live with their pages.
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { displayName, moveName, useData } from '../lib/data';
import { duration } from '../lib/format';
import { spriteUrls, typeIcon } from '../lib/images';
import { multLabel } from '../lib/pogo';
import type { Move, PokeType, Pokemon } from '../lib/types';

// ---------------------------------------------------------------- layout
export function PageHeader({ title, subtitle, actions, children }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  useEffect(() => { if (typeof title === 'string') document.title = `${title} · PoGo Companion`; }, [title]);
  return (
    <div className="page-header">
      <div className="titles">
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
        {children}
      </div>
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, footer, flush, className = '', style, id }: { title?: ReactNode; actions?: ReactNode; children?: ReactNode; footer?: ReactNode; flush?: boolean; className?: string; style?: CSSProperties; id?: string }) {
  return (
    <section className={`card ${className}`} style={style} id={id}>
      {(title || actions) && <div className="card-head"><h2>{title}</h2>{actions}</div>}
      <div className={`card-body ${flush ? 'flush' : ''}`}>{children}</div>
      {footer && <div className="card-foot">{footer}</div>}
    </section>
  );
}

export function StatTile({ label, value, sub, style }: { label: ReactNode; value: ReactNode; sub?: ReactNode; style?: CSSProperties }) {
  return <div className="stat-tile" style={style}><div className="label">{label}</div><div className="value">{value}</div>{sub && <div className="sub">{sub}</div>}</div>;
}

export function Empty({ icon = '🔍', children }: { icon?: string; children: ReactNode }) {
  return <div className="empty"><div className="big">{icon}</div>{children}</div>;
}

export function Spinner({ label }: { label?: string }) {
  return <div className="row" style={{ justifyContent: 'center', padding: 24 }}><div className="spinner" />{label && <span className="muted">{label}</span>}</div>;
}

// ---------------------------------------------------------------- controls
export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: ReactNode }[]; value: T; onChange: (v: T) => void }) {
  return <div className="tabs" role="tablist">{tabs.map((t) => <button key={t.id} role="tab" aria-selected={t.id === value} className={t.id === value ? 'on' : ''} onClick={() => onChange(t.id)}>{t.label}</button>)}</div>;
}

export function Segmented<T extends string | number>({ options, value, onChange, size }: { options: { id: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; size?: 'sm' }) {
  return <div className="seg" style={size === 'sm' ? { fontSize: '0.85em' } : undefined}>{options.map((o) => <button key={String(o.id)} type="button" className={o.id === value ? 'on' : ''} onClick={() => onChange(o.id)}>{o.label}</button>)}</div>;
}

export function Switch({ checked, onChange, label, title }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; title?: string }) {
  return <label className="switch" title={title}><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /><span className="track" />{label}</label>;
}

export function Field({ label, hint, children, style }: { label: ReactNode; hint?: ReactNode; children: ReactNode; style?: CSSProperties }) {
  return <div className="field" style={style}><label>{label}</label>{children}{hint && <span className="hint">{hint}</span>}</div>;
}

export function NumberInput({ value, onChange, min, max, step = 1, placeholder, className = '', style }: { value: number | ''; onChange: (v: number | '') => void; min?: number; max?: number; step?: number; placeholder?: string; className?: string; style?: CSSProperties }) {
  return (
    <input className={`input num ${className}`} style={style} type="number" inputMode="decimal" value={value} min={min} max={max} step={step} placeholder={placeholder}
      onChange={(e) => { const v = e.target.value; if (v === '') return onChange(''); const n = Number(v); if (!Number.isNaN(n)) onChange(n); }} />
  );
}

export function Select<T extends string | number>({ value, onChange, options, className = '', style }: { value: T; onChange: (v: T) => void; options: { id: T; label: string }[]; className?: string; style?: CSSProperties }) {
  return (
    <select className={`select ${className}`} style={style} value={String(value)} onChange={(e) => { const o = options.find((x) => String(x.id) === e.target.value); if (o) onChange(o.id); }}>
      {options.map((o) => <option key={String(o.id)} value={String(o.id)}>{o.label}</option>)}
    </select>
  );
}

/** IV selector: 0–15 slider + number for atk/def/sta */
export function IvInputs({ value, onChange, min = 0 }: { value: [number, number, number]; onChange: (v: [number, number, number]) => void; min?: number }) {
  const labels = ['Attack', 'Defense', 'HP'];
  return (
    <div className="col" style={{ gap: 6 }}>
      {labels.map((l, i) => (
        <div key={l} className="row nowrap" style={{ gap: 10 }}>
          <span className="small muted" style={{ width: 56 }}>{l}</span>
          <input type="range" min={min} max={15} value={value[i]} onChange={(e) => { const v = [...value] as [number, number, number]; v[i] = Number(e.target.value); onChange(v); }} />
          <span className="num bold" style={{ width: 22, textAlign: 'right' }}>{value[i]}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- Pokémon display
export const typeColor = (t: string) => `var(--t-${t})`;

export function TypeBadge({ type, small, noIcon }: { type: PokeType | string; small?: boolean; noIcon?: boolean }) {
  return (
    <span className={`type ${small ? 'sm' : ''} ${noIcon ? 'noicon' : ''}`} style={{ background: typeColor(type) }}>
      {!noIcon && <img src={typeIcon(type)} alt="" loading="lazy" />}
      {type}
    </span>
  );
}
export function Types({ types, small }: { types: (PokeType | string)[]; small?: boolean }) {
  return <span className="types">{types.map((t) => <TypeBadge key={t} type={t} small={small} />)}</span>;
}

export function MultChip({ m }: { m: number }) {
  const l = multLabel(m);
  const cls = { '×2.56': 'x256', '×1.6': 'x16', '×1': 'x1', '×0.625': 'x0625', '×0.39': 'x039', '×0.244': 'x0244' }[l];
  return <span className={`mult ${cls}`}>{l}</span>;
}

/** Pokémon sprite with automatic fallbacks */
export function PokeImg({ p, shiny = false, size = 40, style }: { p: Pick<Pokemon, 'img' | 'dex' | 'shinyImg'>; shiny?: boolean; size?: number; style?: CSSProperties }) {
  const urls = useMemo(() => spriteUrls(p, shiny), [p.img, p.dex, shiny]); // eslint-disable-line react-hooks/exhaustive-deps
  const [i, setI] = useState(0);
  useEffect(() => setI(0), [urls]);
  return (
    <img className={`poke-img ${i >= urls.length ? 'missing' : ''}`} src={urls[Math.min(i, urls.length - 1)]} width={size} height={size} loading="lazy" alt=""
      style={style} onError={() => setI((x) => x + 1)} />
  );
}

/** Icon + name, optionally linking to the Pokédex entry */
export function Mon({ p, shadow, shiny, size = 32, link = true, sub, showTypes }: { p: Pokemon; shadow?: boolean; shiny?: boolean; size?: number; link?: boolean; sub?: ReactNode; showTypes?: boolean }) {
  const inner = (
    <>
      <span style={{ position: 'relative', display: 'inline-flex' }}>
        <PokeImg p={p} size={size} shiny={shiny} />
        {shadow && <span title="Shadow" style={{ position: 'absolute', right: -3, bottom: -2, fontSize: size > 30 ? 13 : 10, filter: 'drop-shadow(0 0 2px #000)' }}>🟣</span>}
      </span>
      <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <span className="mon-name">{displayName(p, shadow)}</span>
        {(sub || showTypes) && <span className="mon-sub">{showTypes ? <Types types={p.types} small /> : sub}</span>}
      </span>
    </>
  );
  return link ? <Link className="mon" to={`/dex/${p.id}`}>{inner}</Link> : <span className="mon">{inner}</span>;
}

export function MoveTag({ id, elite, showType = true, link = true }: { id: string; elite?: boolean; showType?: boolean; link?: boolean }) {
  const { moves } = useData();
  const m = moves[id];
  const content = (
    <span className="move">
      {showType && m && <span className="type-dot" style={{ background: typeColor(m.type) }} />}
      {moveName(moves, id)}{elite && <span className="elite" title="Elite / legacy move">★</span>}
    </span>
  );
  return link ? <Link to={`/moves/${id}`} style={{ color: 'inherit' }}>{content}</Link> : content;
}

export function StatBar({ label, value, max, color }: { label: string; value: number; max: number; color?: string }) {
  return (
    <div className="statbar">
      <span className="muted small">{label}</span>
      <span className="num bold">{value}</span>
      <div className="bar"><div style={{ width: `${Math.min(100, (value / max) * 100)}%`, background: color || 'var(--accent)' }} /></div>
    </div>
  );
}

export function IvBars({ ivs }: { ivs: [number, number, number] }) {
  return (
    <div className="ivbar" style={{ minWidth: 70 }}>
      {ivs.map((v, i) => <div key={i} className={`seg15 ${v === 15 ? 'full' : ''}`}>{[0, 1, 2].map((s) => <div key={s}><div style={{ width: `${Math.max(0, Math.min(1, (v - s * 5) / 5)) * 100}%` }} /></div>)}</div>)}
    </div>
  );
}

export function Rank({ n }: { n: number }) {
  return <span className={`rank ${n <= 3 ? `r${n}` : ''}`}>{n}</span>;
}

// ---------------------------------------------------------------- Pokémon picker (autocomplete)
export function searchPokemon(list: Pokemon[], q: string, limit = 30): Pokemon[] {
  const s = q.trim().toLowerCase();
  if (!s) return list.slice(0, limit);
  const num = Number(s.replace('#', ''));
  const scored: [number, Pokemon][] = [];
  for (const p of list) {
    const n = displayName(p).toLowerCase();
    let score = -1;
    if (!Number.isNaN(num) && p.dex === num) score = 100 - (p.form ? 1 : 0);
    else if (p.name.toLowerCase() === s) score = 95 - (p.form ? 2 : 0) - (p.megaOf ? 1 : 0);
    else if (n === s) score = 94;
    else if (p.name.toLowerCase().startsWith(s)) score = 80 - (p.form ? 2 : 0) - (p.megaOf ? 1 : 0);
    else if (n.startsWith(s)) score = 70;
    else if (n.includes(s)) score = 50;
    else if (s.split(' ').every((w) => n.includes(w))) score = 40;
    if (score >= 0) scored.push([score, p]);
  }
  return scored.sort((a, b) => b[0] - a[0] || a[1].dex - b[1].dex).slice(0, limit).map((x) => x[1]);
}

export function PokemonPicker({ value, onChange, filter, placeholder = 'Search Pokémon…', autoFocus, allowClear }: {
  value: Pokemon | null; onChange: (p: Pokemon | null) => void; filter?: (p: Pokemon) => boolean; placeholder?: string; autoFocus?: boolean; allowClear?: boolean;
}) {
  const data = useData();
  const [open, setOpen] = useState(!value && !!autoFocus);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pool = useMemo(() => data.pokemon.filter((p) => (filter ? filter(p) : p.released)), [data.pokemon, filter]);
  const results = useMemo(() => searchPokemon(pool, q, 40), [pool, q]);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);
  const pick = (p: Pokemon) => { onChange(p); setOpen(false); setQ(''); };
  return (
    <div className="picker" ref={ref}>
      {!open && value ? (
        <div className="picker-selected" onClick={() => setOpen(true)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setOpen(true)}>
          <PokeImg p={value} size={32} />
          <span className="bold" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayName(value)}</span>
          <Types types={value.types} small />
          {allowClear && <button className="btn ghost sm" onClick={(e) => { e.stopPropagation(); onChange(null); }} aria-label="Clear">✕</button>}
        </div>
      ) : (
        <input ref={inputRef} className="input" placeholder={placeholder} value={q} autoFocus={autoFocus}
          onFocus={() => setOpen(true)}
          onChange={(e) => { setQ(e.target.value); setHi(0); setOpen(true); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(results.length - 1, h + 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
            else if (e.key === 'Enter' && results[hi]) pick(results[hi]);
            else if (e.key === 'Escape') { setOpen(false); }
          }} />
      )}
      {open && (
        <div className="picker-menu">
          {results.length === 0 && <div className="picker-item muted">No matches</div>}
          {results.map((p, i) => (
            <div key={p.id} className={`picker-item ${i === hi ? 'on' : ''}`} onMouseDown={(e) => { e.preventDefault(); pick(p); }} onMouseEnter={() => setHi(i)}>
              <PokeImg p={p} size={30} />
              <span style={{ flex: 1 }}>{displayName(p)} <span className="faint small">#{p.dex}</span></span>
              <Types types={p.types} small />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Pick a move from a Pokémon's move pool */
export function MoveSelect({ pokemon, kind, value, onChange, allowNone, includeElite = true, shadow, purified }: { pokemon: Pokemon; kind: 'fast' | 'charged'; value: string; onChange: (id: string) => void; allowNone?: boolean; includeElite?: boolean; shadow?: boolean; purified?: boolean }) {
  const { moves } = useData();
  const base = kind === 'fast' ? pokemon.fast : pokemon.charged;
  const elite = kind === 'fast' ? pokemon.eliteFast : pokemon.eliteCharged;
  const ids = [...base, ...(includeElite ? elite : [])];
  if (shadow && kind === 'charged' && !ids.includes('FRUSTRATION')) ids.push('FRUSTRATION');
  if (kind === 'charged' && purified && !ids.includes('RETURN')) ids.push('RETURN');
  if (value && !ids.includes(value)) ids.push(value); // keep a saved move visible
  const opts = ids.map((id) => ({ id, label: `${moveName(moves, id)}${elite.includes(id) ? ' ★' : ''} · ${moves[id]?.type ?? ''}` }));
  if (allowNone) opts.unshift({ id: '', label: '— none —' });
  return <Select value={value} onChange={onChange} options={opts} />;
}

// ---------------------------------------------------------------- time
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), intervalMs); return () => clearInterval(t); }, [intervalMs]);
  return now;
}

export function Countdown({ to, prefix }: { to: Date | number | string; prefix?: string }) {
  const now = useNow(1000);
  const t = new Date(to).getTime();
  const d = t - now;
  return <span className="num">{prefix}{d > 0 ? duration(d) : 'now'}</span>;
}

// ---------------------------------------------------------------- sorting
export function useSort<T>(rows: T[], initial: { key: string; dir: 1 | -1 }, getters: Record<string, (r: T) => number | string>) {
  const [sort, setSort] = useState(initial);
  const sorted = useMemo(() => {
    const g = getters[sort.key];
    if (!g) return rows;
    return [...rows].sort((a, b) => {
      const x = g(a), y = g(b);
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
    });
  }, [rows, sort]); // eslint-disable-line react-hooks/exhaustive-deps
  const th = (key: string, label: ReactNode, opts: { num?: boolean; title?: string } = {}) => (
    <th className={`sortable ${sort.key === key ? 'sorted' : ''} ${opts.num ? 'num' : ''}`} title={opts.title}
      onClick={() => setSort((s) => ({ key, dir: s.key === key ? (-s.dir as 1 | -1) : (typeof g0(key) === 'string' ? 1 : -1) }))}>
      {label}{sort.key === key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
    </th>
  );
  const g0 = (key: string) => (rows[0] ? getters[key]?.(rows[0]) : 0);
  return { sorted, th, sort, setSort };
}

/** Show `pageSize` rows with a "show more" button */
export function useShowMore<T>(rows: T[], pageSize = 50) {
  const [n, setN] = useState(pageSize);
  useEffect(() => setN(pageSize), [rows, pageSize]);
  const more = rows.length > n ? <div className="center" style={{ padding: 12 }}><button className="btn" onClick={() => setN((x) => x + pageSize * 2)}>Show more ({rows.length - n} remaining)</button></div> : null;
  return { visible: rows.slice(0, n), more };
}

export function MoveStatsInline({ m, mode }: { m: Move; mode: 'pve' | 'pvp' }) {
  if (mode === 'pve' && m.pve) return <span className="small muted num">{m.pve.power} pw · {m.pve.energy}{m.fast ? '+' : '−'} e · {(m.pve.duration / 1000).toFixed(1)}s</span>;
  if (mode === 'pvp' && m.pvp) return <span className="small muted num">{m.pvp.power} pw · {m.pvp.energy}{m.fast ? '+' : '−'} e{m.fast ? ` · ${m.pvp.turns}t` : ''}</span>;
  return null;
}

/** Tiny toast notification hook */
export function useToast() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(null), 2200); return () => clearTimeout(t); }, [msg]);
  return { show: setMsg, node: msg ? <div className="toast" role="status">{msg}</div> : null };
}

export async function copyText(s: string) {
  try { await navigator.clipboard.writeText(s); return true; } catch { return false; }
}
