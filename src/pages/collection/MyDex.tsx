import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent, type SyntheticEvent } from 'react';
import { Link } from 'react-router-dom';
import { Card, Empty, PageHeader, PokeImg, Segmented, Select, Switch, Types, useToast } from '../../components/ui';
import { displayName, useData } from '../../lib/data';
import { fmt, pct } from '../../lib/format';
import { spriteUrls } from '../../lib/images';
import { TYPES } from '../../lib/pogo';
import { DEX_FLAGS, useCollection, usePrefs, useStored, type Collection, type DexEntry, type DexFlag } from '../../lib/storage';
import type { Pokemon } from '../../lib/types';
import './collection.css';

// ---------------------------------------------------------------- constants & helpers
const GEN_REGIONS = ['', 'Kanto', 'Johto', 'Hoenn', 'Sinnoh', 'Unova', 'Kalos', 'Alola', 'Galar', 'Paldea'];
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'];
const REGIONAL = /^(Alolan|Galarian|Hisuian|Paldean)/;
const FLAG = Object.fromEntries(DEX_FLAGS.map((f) => [f.key, f])) as Record<DexFlag, (typeof DEX_FLAGS)[number]>;

/** Whether a flag can apply to a Pokémon (based on game data), with a reason when it can't. */
function flagEligibility(p: Pokemon, flag: DexFlag): string | null {
  if (p.megaOf) return flag === 'caught' || flag === 'shiny' ? null : 'Not applicable to Mega/Primal forms';
  if (p.costumeOf) return flag === 'caught' || flag === 'shiny' || flag === 'lucky' || flag === 'hundo' ? null : 'Not tracked for costumes';
  switch (flag) {
    case 'shadow': case 'purified': return p.shadowReleased ? null : 'Shadow form not released';
    case 'lucky': return p.tradable ? null : 'Not tradable';
    case 'dynamax': return p.dmax ? null : 'No Dynamax data in game files';
    case 'gigantamax': return p.gmax ? null : 'No Gigantamax form';
    default: return null;
  }
}

interface DexView {
  mode: DexFlag;
  gen: number;                       // 0 = all
  type: string;                      // '' = all
  show: 'all' | 'missing' | 'have';
  megas: boolean;
  costumes: boolean;
  unreleased: boolean | null;        // null = follow preferences
  forms: 'species' | 'all';
  hideInel: boolean;
  groupGen: boolean;
}
const DEFAULT_VIEW: DexView = { mode: 'caught', gen: 0, type: '', show: 'all', megas: false, costumes: false, unreleased: null, forms: 'species', hideInel: true, groupGen: true };

function onImgError(e: SyntheticEvent<HTMLImageElement>) {
  const img = e.currentTarget;
  const rest = (img.dataset.fb || '').split('|').filter(Boolean);
  const next = rest.shift();
  img.dataset.fb = rest.join('|');
  if (next) img.src = next; else img.style.opacity = '0.2';
}

// ---------------------------------------------------------------- tile (pure markup; events are delegated to the grid)
const DexTile = memo(function DexTile({ p, entry, mode, inel }: { p: Pokemon; entry: DexEntry | undefined; mode: DexFlag; inel: string | null }) {
  const shiny = mode === 'shiny' || mode === 'shundo';
  const urls = spriteUrls(p, shiny);
  const set = !!entry?.[mode];
  const name = displayName(p);
  const flags = entry ? DEX_FLAGS.filter((f) => entry[f.key]) : [];
  return (
    <div
      className={`cx-tile ${set ? 'set' : 'off'} ${inel ? 'inel' : ''}`}
      style={{ '--mc': FLAG[mode].color } as CSSProperties}
      data-id={p.id}
      role="button"
      tabIndex={0}
      aria-pressed={set}
      title={`${name} #${p.dex}${inel ? ` — ${inel}` : ''}\nClick: toggle ${FLAG[mode].label} · Right-click / long-press: details`}
    >
      <span className="no">#{p.dex}</span>
      {set && <span className="check" aria-hidden>✓</span>}
      <button className="more" data-more="1" aria-label={`Details for ${name}`} tabIndex={-1}>⋯</button>
      <img src={urls[0]} data-fb={urls.slice(1).join('|')} onError={onImgError} loading="lazy" alt="" width={56} height={56} draggable={false} />
      <span className="nm">{name}</span>
      <span className="dots" aria-label={flags.map((f) => f.label).join(', ')}>
        {flags.map((f) => <i key={f.key} style={{ background: f.color }} title={f.label} />)}
      </span>
    </div>
  );
});

// ---------------------------------------------------------------- progress bar
function Bar({ value, total, color }: { value: number; total: number; color: string }) {
  return <div className="cx-bar"><div style={{ width: `${total ? (value / total) * 100 : 0}%`, background: color }} /></div>;
}

// ---------------------------------------------------------------- detail drawer
function DexDrawer({ p, entry, onToggle, onClear, onClose }: { p: Pokemon; entry: DexEntry | undefined; onToggle: (f: DexFlag) => void; onClear: () => void; onClose: () => void }) {
  const { byId } = useData();
  useEffect(() => {
    const h = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  const base = p.megaOf ? byId[p.megaOf] : p.costumeOf ? byId[p.costumeOf] : null;
  return (
    <div className="overlay cx-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal cx-modal" role="dialog" aria-modal="true" aria-label={displayName(p)}>
        <div className="cx-modal-head">
          <PokeImg p={p} size={56} shiny={!!entry?.shiny} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2>{displayName(p)}</h2>
            <div className="row" style={{ gap: 8, marginTop: 4 }}>
              <span className="faint small num">#{p.dex} · Gen {ROMAN[p.gen]} ({GEN_REGIONS[p.gen]})</span>
              <Types types={p.types} small />
              {!p.released && <span className="badge warn">Unreleased</span>}
            </div>
          </div>
          <button className="btn ghost icon" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="cx-modal-body stack">
          <div>
            <div className="field-label" style={{ marginBottom: 8 }}>Collection flags</div>
            <div className="cx-flaglist">
              {DEX_FLAGS.map((f) => {
                const why = flagEligibility(p, f.key);
                const on = !!entry?.[f.key];
                return (
                  <button key={f.key} className={`cx-flagbtn ${on ? 'on' : ''}`} style={{ '--mc': f.color } as CSSProperties}
                    disabled={!!why && !on} title={why || undefined} onClick={() => onToggle(f.key)} aria-pressed={on}>
                    <span className="dot" />{f.label}
                    {why && <span className="why">n/a</span>}
                  </button>
                );
              })}
            </div>
            <p className="cx-hint" style={{ marginTop: 8 }}>Setting any flag also marks the Pokémon as caught.</p>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <Link className="btn sm" to={`/dex/${base ? base.id : p.id}`}>📖 Pokédex entry</Link>
            {!p.megaOf && <Link className="btn sm" to={`/tools/iv?id=${p.costumeOf || p.id}`}>🧮 IV Calculator</Link>}
            {!p.megaOf && <Link className="btn sm" to={`/pvp/ivs?id=${p.costumeOf || p.id}&league=great`}>📊 PvP IVs</Link>}
            <Link className="btn sm" to={`/counters?boss=${p.costumeOf || p.id}`}>🛡️ Counters</Link>
          </div>
        </div>
        <div className="cx-modal-foot">
          <button className="btn danger" onClick={onClear} disabled={!entry}>Clear all flags</button>
          <span className="spacer" />
          <button className="btn primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- page
export default function MyDex() {
  const data = useData();
  const [prefs] = usePrefs();
  const { collection, toggle, setAll } = useCollection();
  const [storedView, setView] = useStored<DexView>('dex.view', DEFAULT_VIEW);
  const view = { ...DEFAULT_VIEW, ...storedView };
  const showUnreleased = view.unreleased ?? prefs.showUnreleased;
  const patch = (v: Partial<DexView>) => setView((prev) => ({ ...DEFAULT_VIEW, ...prev, ...v }));
  const [q, setQ] = useState('');
  const [detail, setDetail] = useState<string | null>(null);
  const toast = useToast();
  const mode = view.mode;
  const modeFlag = FLAG[mode] ?? FLAG.caught;

  // Structural set: one tile per species + regional forms (or every form), optional Mega/Primal & unreleased
  const base = useMemo(() => {
    const pool = data.pokemon.filter((p) => showUnreleased || p.released);
    const chosen = new Map<string, Pokemon>();
    for (const p of pool) {
      if (p.megaOf || (p.formName && REGIONAL.test(p.formName))) continue;
      const cur = chosen.get(p.speciesId);
      if (!cur || (cur.form && !p.form)) chosen.set(p.speciesId, p);
    }
    const out = pool.filter((p) => {
      if (p.megaOf) return view.megas;
      if (view.forms === 'all') return true;
      if (p.formName && REGIONAL.test(p.formName)) return true;
      return chosen.get(p.speciesId) === p;
    });
    if (view.costumes) {
      const inPool = new Set(pool.map((p) => p.id));
      for (const c of data.costumes) {
        const b = data.byId[c.base];
        if (!b || !inPool.has(b.id)) continue;
        out.push({ ...b, id: c.id, img: c.img, shinyImg: c.shinyImg, form: 'COSTUME', formName: c.name, costumeOf: b.id, megas: undefined });
      }
    }
    const rank = (p: Pokemon) => (p.megaOf ? 1 : 0) + (p.costumeOf ? 2 : 0);
    return out.sort((a, b) => a.dex - b.dex || rank(a) - rank(b));
  }, [data.pokemon, data.costumes, data.byId, showUnreleased, view.megas, view.costumes, view.forms]);

  // Progress per flag (overall) and per generation (active flag)
  const progress = useMemo(() => {
    const overall = DEX_FLAGS.map((f) => {
      let have = 0, total = 0;
      for (const p of base) {
        if (flagEligibility(p, f.key)) continue;
        total++;
        if (collection[p.id]?.[f.key]) have++;
      }
      return { flag: f, have, total };
    });
    const gens = Array.from({ length: 9 }, (_, i) => ({ gen: i + 1, have: 0, total: 0, caught: 0, all: 0 }));
    for (const p of base) {
      const g = gens[p.gen - 1];
      if (!g) continue;
      g.all++;
      if (collection[p.id]?.caught) g.caught++;
      if (flagEligibility(p, mode)) continue;
      g.total++;
      if (collection[p.id]?.[mode]) g.have++;
    }
    return { overall, gens: gens.filter((g) => g.all > 0) };
  }, [base, collection, mode]);

  // Filtered list
  const visible = useMemo(() => {
    const s = q.trim().toLowerCase();
    const num = Number(s.replace('#', ''));
    return base.filter((p) => {
      if (view.gen && p.gen !== view.gen) return false;
      if (view.type && !p.types.includes(view.type as Pokemon['types'][number])) return false;
      const inel = flagEligibility(p, mode);
      if (inel && view.hideInel) return false;
      const has = !!collection[p.id]?.[mode];
      if (view.show === 'missing' && (has || inel)) return false;
      if (view.show === 'have' && !has) return false;
      if (s) {
        if (s && !Number.isNaN(num) && /^#?\d+$/.test(s)) return p.dex === num;
        return displayName(p).toLowerCase().includes(s) || p.name.toLowerCase().includes(s);
      }
      return true;
    });
  }, [base, view.gen, view.type, view.show, view.hideInel, q, collection, mode]);

  const groups = useMemo(() => {
    if (!view.groupGen || view.gen) return [{ gen: 0, list: visible }];
    const m = new Map<number, Pokemon[]>();
    for (const p of visible) { if (!m.has(p.gen)) m.set(p.gen, []); m.get(p.gen)!.push(p); }
    return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([gen, list]) => ({ gen, list }));
  }, [visible, view.groupGen, view.gen]);

  // Stable delegated handlers
  const live = useRef({ toggle, mode, byId: data.byId });
  live.current = { toggle, mode, byId: data.byId };
  const press = useRef<{ timer: number; id: string; x: number; y: number; fired: boolean } | null>(null);
  const tileFrom = (t: EventTarget | null) => (t instanceof Element ? (t.closest('[data-id]') as HTMLElement | null) : null);

  const tap = useCallback((id: string) => {
    const { toggle: tg, mode: m, byId } = live.current;
    const p = byId[id];
    if (!p) return;
    const why = flagEligibility(p, m);
    if (why) { toast.show(`${displayName(p)}: ${why}`); return; }
    tg(id, m);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onGridClick = (e: MouseEvent) => {
    const el = tileFrom(e.target);
    if (!el) return;
    const id = el.dataset.id!;
    if (press.current?.fired) { press.current = null; return; }
    if ((e.target as Element).closest('[data-more]')) { setDetail(id); return; }
    tap(id);
  };
  const onGridKey = (e: KeyboardEvent) => {
    const el = tileFrom(e.target);
    if (!el) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tap(el.dataset.id!); }
    else if (e.key === 'ContextMenu' || e.key.toLowerCase() === 'd') { e.preventDefault(); setDetail(el.dataset.id!); }
  };
  const onGridContext = (e: MouseEvent) => {
    const el = tileFrom(e.target);
    if (!el) return;
    e.preventDefault();
    setDetail(el.dataset.id!);
  };
  const cancelPress = () => { if (press.current && !press.current.fired) { clearTimeout(press.current.timer); press.current = null; } };
  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse') { press.current = null; return; } // mouse uses right-click
    const el = tileFrom(e.target);
    if (!el) return;
    const id = el.dataset.id!;
    const timer = window.setTimeout(() => { if (press.current) { press.current.fired = true; setDetail(id); } }, 480);
    press.current = { timer, id, x: e.clientX, y: e.clientY, fired: false };
  };
  const onPointerMove = (e: PointerEvent) => {
    const pr = press.current;
    if (pr && !pr.fired && (Math.abs(e.clientX - pr.x) > 10 || Math.abs(e.clientY - pr.y) > 10)) cancelPress();
  };

  // Bulk actions
  const bulk = (list: Pokemon[], on: boolean, label: string) => {
    const targets = list.filter((p) => !flagEligibility(p, mode) && !!collection[p.id]?.[mode] !== on);
    if (!targets.length) { toast.show(`Nothing to change — all ${on ? 'already marked' : 'already clear'}`); return; }
    const verb = on ? `Mark ${fmt(targets.length)} Pokémon in ${label} as ${modeFlag.label}` : `Remove ${modeFlag.label} from ${fmt(targets.length)} Pokémon in ${label}`;
    if (!window.confirm(`${verb}?${on && mode !== 'caught' ? ' They will also be marked as caught.' : ''}`)) return;
    setAll((prev: Collection) => {
      const next = { ...prev };
      for (const p of targets) {
        const e: DexEntry = { ...(next[p.id] || {}) };
        if (on) { e[mode] = 1; e.caught = 1; } else delete e[mode];
        if (Object.keys(e).length) next[p.id] = e; else delete next[p.id];
      }
      return next;
    });
    toast.show(`${on ? 'Marked' : 'Cleared'} ${fmt(targets.length)} Pokémon`);
  };

  const detailP = detail ? data.byId[detail] || base.find((p) => p.id === detail) || null : null;
  const caughtStat = progress.overall.find((o) => o.flag.key === 'caught')!;
  const modeStat = progress.overall.find((o) => o.flag.key === mode)!;
  const filtered = !!(q || view.gen || view.type || view.show !== 'all');
  const closeDetail = useCallback(() => setDetail(null), []);

  return (
    <div className="stack">
      <PageHeader
        title="My Dex"
        subtitle={<>Your personal Pokédex checklist. Pick a marking mode, then tap tiles to mark them. Right-click or long-press a tile to set several flags at once. Saved on this device. Back it up from <Link to="/settings">Settings</Link>.</>}
        actions={<Link className="btn" to="/collection/mons">🎒 My Pokémon</Link>}
      />

      {/* Summary */}
      <div className="grid grid-4">
        <div className="stat-tile"><div className="label">Caught</div><div className="value">{fmt(caughtStat.have)} <span className="faint small">/ {fmt(caughtStat.total)}</span></div><div className="sub">{pct(caughtStat.total ? (caughtStat.have / caughtStat.total) * 100 : 0)} complete</div></div>
        <div className="stat-tile"><div className="label">{modeFlag.label}</div><div className="value">{fmt(modeStat.have)} <span className="faint small">/ {fmt(modeStat.total)}</span></div><div className="sub">{pct(modeStat.total ? (modeStat.have / modeStat.total) * 100 : 0)} of eligible</div></div>
        <div className="stat-tile"><div className="label">Entries tracked</div><div className="value">{fmt(base.length)}</div><div className="sub">{view.forms === 'all' ? 'All forms' : 'Species + regional forms'}{view.megas ? ' + Megas' : ''}{view.costumes ? ' + costumes' : ''}</div></div>
        <div className="stat-tile"><div className="label">Missing ({modeFlag.label})</div><div className="value">{fmt(modeStat.total - modeStat.have)}</div><div className="sub">across {progress.gens.length} generations</div></div>
      </div>

      {/* Marking mode + filters */}
      <Card title="Marking mode" actions={<span className="faint small">Tap a tile to toggle <b style={{ color: modeFlag.color }}>{modeFlag.label}</b></span>}>
        <div className="stack-sm">
          <div className="cx-modes" role="radiogroup" aria-label="Marking mode">
            {progress.overall.map(({ flag: f, have }) => (
              <button key={f.key} role="radio" aria-checked={mode === f.key} className={`cx-mode ${mode === f.key ? 'on' : ''}`} style={{ '--mc': f.color } as CSSProperties} onClick={() => patch({ mode: f.key })}>
                <span className="dot" style={{ background: f.color }} />{f.label}<span className="cnt">{fmt(have)}</span>
              </button>
            ))}
          </div>
          <div className="divider" />
          <div className="cx-toolbar">
            <input className="input cx-search" placeholder="Search name or #dex…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
            <Select value={view.gen} onChange={(gen) => patch({ gen })} options={[{ id: 0, label: 'All generations' }, ...progress.gens.map((g) => ({ id: g.gen, label: `Gen ${ROMAN[g.gen]} · ${GEN_REGIONS[g.gen]}` }))]} />
            <Select value={view.type} onChange={(type) => patch({ type })} options={[{ id: '', label: 'All types' }, ...TYPES.map((t) => ({ id: t, label: t[0].toUpperCase() + t.slice(1) }))]} />
            <Segmented size="sm" value={view.show} onChange={(show) => patch({ show })} options={[{ id: 'all', label: 'All' }, { id: 'missing', label: 'Missing' }, { id: 'have', label: 'Have' }]} />
          </div>
          <div className="row" style={{ gap: 16 }}>
            <Switch checked={view.forms === 'all'} onChange={(v) => patch({ forms: v ? 'all' : 'species' })} label="All forms" title="Include every form (Rotom, Deoxys, Arceus …), not just species + regional variants" />
            <Switch checked={view.megas} onChange={(v) => patch({ megas: v })} label="Mega / Primal" />
            <Switch checked={view.costumes} onChange={(v) => patch({ costumes: v })} label="Costumes" title="Add costume / event Pokémon as separate checklist entries" />
            <Switch checked={showUnreleased} onChange={(v) => patch({ unreleased: v })} label="Unreleased" />
            <Switch checked={view.hideInel} onChange={(v) => patch({ hideInel: v })} label="Hide ineligible" title="Hide Pokémon that can't have the active flag (e.g. no Shadow form)" />
            <Switch checked={view.groupGen} onChange={(v) => patch({ groupGen: v })} label="Group by generation" />
          </div>
        </div>
      </Card>

      {/* Grid */}
      <Card
        title={<>{fmt(visible.length)} {visible.length === 1 ? 'Pokémon' : 'Pokémon'} {filtered && <span className="faint small">(filtered)</span>}</>}
        actions={visible.length > 0 && (
          <div className="row" style={{ gap: 6 }}>
            <button className="btn sm" onClick={() => bulk(visible, true, filtered ? 'the current view' : 'the dex')}>Mark all shown</button>
            <button className="btn sm ghost danger" onClick={() => bulk(visible, false, filtered ? 'the current view' : 'the dex')}>Clear shown</button>
          </div>
        )}
      >
        {visible.length === 0 ? (
          <Empty icon={view.show === 'missing' && !q ? '🎉' : '🔍'}>
            {view.show === 'missing' && !q && !view.type ? <>Nothing missing for <b>{modeFlag.label}</b> here. Nice work!</> : 'No Pokémon match these filters.'}
          </Empty>
        ) : (
          <div onClick={onGridClick} onKeyDown={onGridKey} onContextMenu={onGridContext} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={cancelPress} onPointerCancel={cancelPress} onPointerLeave={cancelPress}>
            {groups.map((g) => {
              const gp = g.gen ? progress.gens.find((x) => x.gen === g.gen) : null;
              return (
                <div key={g.gen}>
                  {gp && (
                    <div className="cx-gen-head">
                      <h3>Gen {ROMAN[g.gen]} · {GEN_REGIONS[g.gen]}</h3>
                      <span className="meta">{fmt(gp.have)} / {fmt(gp.total)} {modeFlag.label.toLowerCase()}</span>
                      <Bar value={gp.have} total={gp.total} color={modeFlag.color} />
                    </div>
                  )}
                  <div className="cx-grid">
                    {g.list.map((p) => <DexTile key={p.id} p={p} entry={collection[p.id]} mode={mode} inel={flagEligibility(p, mode)} />)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Progress */}
      <div className="grid grid-2">
        <Card title="Progress by flag" footer="Percentages count only Pokémon that can have each flag (e.g. Shadow needs a released Shadow form; Gigantamax needs a G-Max form). Shiny availability isn't in the game data, so Shiny counts every entry.">
          <div className="cx-prog">
            {progress.overall.map(({ flag: f, have, total }) => (
              <div key={f.key} className={`cx-prog-item ${mode === f.key ? 'on' : ''}`} onClick={() => patch({ mode: f.key })} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && patch({ mode: f.key })}>
                <div className="top">
                  <span className="l"><span className="type-dot" style={{ background: f.color }} />{f.label}</span>
                  <span className="r">{fmt(have)} / {fmt(total)} · {pct(total ? (have / total) * 100 : 0, 0)}</span>
                </div>
                <Bar value={have} total={total} color={f.color} />
              </div>
            ))}
          </div>
        </Card>
        <Card title={<>Progress by generation · <span style={{ color: modeFlag.color }}>{modeFlag.label}</span></>} flush>
          <div className="table-wrap">
            <table className="table compact cx-gen-table">
              <thead><tr><th>Gen</th><th className="num">Have</th><th>Progress</th><th className="num">%</th><th /></tr></thead>
              <tbody>
                {progress.gens.map((g) => {
                  const list = base.filter((p) => p.gen === g.gen);
                  const done = g.total > 0 && g.have === g.total;
                  return (
                    <tr key={g.gen}>
                      <td><b>{ROMAN[g.gen]}</b> <span className="muted small">{GEN_REGIONS[g.gen]}</span></td>
                      <td className="num">{fmt(g.have)} <span className="faint">/ {fmt(g.total)}</span></td>
                      <td className="barcell"><Bar value={g.have} total={g.total} color={modeFlag.color} /></td>
                      <td className="num">{pct(g.total ? (g.have / g.total) * 100 : 0, 0)}</td>
                      <td className="right">
                        {done
                          ? <button className="btn sm ghost" onClick={() => bulk(list, false, `Gen ${ROMAN[g.gen]}`)} title={`Clear ${modeFlag.label} for Gen ${ROMAN[g.gen]}`}>Clear</button>
                          : <button className="btn sm" onClick={() => bulk(list, true, `Gen ${ROMAN[g.gen]}`)} disabled={!g.total} title={`Mark every eligible Gen ${ROMAN[g.gen]} Pokémon as ${modeFlag.label}`}>Mark all</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {detailP && (
        <DexDrawer
          p={detailP}
          entry={collection[detailP.id]}
          onToggle={(f) => toggle(detailP.id, f)}
          onClear={() => { if (window.confirm(`Clear all flags for ${displayName(detailP)}?`)) setAll((prev: Collection) => { const n = { ...prev }; delete n[detailP.id]; return n; }); }}
          onClose={closeDetail}
        />
      )}
      {toast.node}
    </div>
  );
}
