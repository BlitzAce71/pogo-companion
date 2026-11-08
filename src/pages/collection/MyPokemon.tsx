import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Card, Empty, Field, IvBars, Mon, MoveSelect, MoveTag, NumberInput, PageHeader, PokemonPicker, Segmented, Select, Switch, useShowMore, useSort, useToast } from '../../components/ui';
import { displayName, moveName, movePool, useData } from '../../lib/data';
import { fmt } from '../../lib/format';
import { appraisalStars, cp, ivPercent, LEAGUES, LEVELS } from '../../lib/pogo';
import { useMyPokemon, useStored, type SavedMon } from '../../lib/storage';
import type { Pokemon } from '../../lib/types';
import { csvCell, download, levelsForCp, parseMonsJson, pvpRank, raidRating, type PvpRank, type RaidRating } from './monStats';
import './collection.css';

type Ivs = [number, number, number];
const PVP_LEAGUES = [
  { key: 'great', short: 'GL', name: 'Great League', cap: LEAGUES.find((l) => l.key === 'great')!.cap },
  { key: 'ultra', short: 'UL', name: 'Ultra League', cap: LEAGUES.find((l) => l.key === 'ultra')!.cap },
  { key: 'little', short: 'LL', name: 'Little League', cap: LEAGUES.find((l) => l.key === 'little')!.cap },
] as const;
type LeagueKey = (typeof PVP_LEAGUES)[number]['key'];

const MON_FLAGS = [
  { key: 'shadow', label: 'Shadow', short: 'S', color: '#8e4ec6' },
  { key: 'purified', label: 'Purified', short: 'P', color: '#6f9be0' },
  { key: 'lucky', label: 'Lucky', short: 'L', color: '#c9a227' },
  { key: 'shiny', label: 'Shiny', short: '✦', color: '#e0a21a' },
] as const;
type MonFlag = (typeof MON_FLAGS)[number]['key'];

const notMega = (p: Pokemon) => !p.megaOf && p.released;

interface Row {
  m: SavedMon;
  p: Pokemon;
  name: string;
  level: number | null;
  levelInferred: boolean;
  ivp: number | null;
  pvp: Record<LeagueKey, PvpRank | null>;
  raid: RaidRating | null;
}

interface ListView { maxLevel: 50 | 51; group: boolean; viable: '' | LeagueKey | 'any'; flags: string[] }
const DEFAULT_LIST: ListView = { maxLevel: 50, group: false, viable: '', flags: [] };

// ---------------------------------------------------------------- add / edit form
function MonForm({ initial, onSave, onClose }: { initial: SavedMon | null; onSave: (m: Omit<SavedMon, 'uid' | 'added'>) => void; onClose: () => void }) {
  const data = useData();
  const { settings } = data;
  const [p, setP] = useState<Pokemon | null>(initial ? data.byId[initial.id] ?? null : null);
  const [nickname, setNickname] = useState(initial?.nickname ?? '');
  const [cpVal, setCp] = useState<number | ''>(initial?.cp ?? '');
  const [level, setLevel] = useState<number>(initial?.level ?? 0);
  const [ivKnown, setIvKnown] = useState(initial ? !!initial.ivs : true);
  const [ivs, setIvs] = useState<Ivs>(initial?.ivs ?? [15, 15, 15]);
  const [flags, setFlags] = useState<Record<MonFlag, boolean>>({ shadow: !!initial?.shadow, purified: !!initial?.purified, lucky: !!initial?.lucky, shiny: !!initial?.shiny });
  const [fast, setFast] = useState(initial?.fast ?? '');
  const [c1, setC1] = useState(initial?.charged?.[0] ?? '');
  const [c2, setC2] = useState(initial?.charged?.[1] ?? '');
  const [tags, setTags] = useState((initial?.tags ?? []).join(', '));
  const [notes, setNotes] = useState(initial?.notes ?? '');

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const pickPokemon = (np: Pokemon | null) => {
    setP(np);
    if (!np) return;
    const pool = movePool(np, true);
    const extra = ['RETURN', 'FRUSTRATION'];
    if (fast && !pool.fast.includes(fast)) setFast('');
    if (c1 && !pool.charged.includes(c1) && !extra.includes(c1)) setC1('');
    if (c2 && !pool.charged.includes(c2) && !extra.includes(c2)) setC2('');
    if (!np.shadowReleased) setFlags((f) => ({ ...f, shadow: false, purified: false }));
  };
  const setFlag = (k: MonFlag, v: boolean) => setFlags((f) => {
    const n = { ...f, [k]: v };
    if (k === 'shadow' && v) n.purified = false;
    if (k === 'purified' && v) n.shadow = false;
    return n;
  });

  const calc = p && level && ivKnown ? cp(p, settings, level, ivs) : null;
  const inferred = p && !level && cpVal !== '' && ivKnown ? levelsForCp(p, settings, cpVal, ivs) : [];
  const mismatch = calc !== null && cpVal !== '' && calc !== cpVal;

  let cpHint: ReactNode = null;
  if (calc !== null && cpVal === '') cpHint = <span className="cx-hint ok">CP {fmt(calc)} will be saved (from level + IVs). <button className="btn ghost sm" onClick={() => setCp(calc)}>Fill in</button></span>;
  else if (mismatch) cpHint = <span className="cx-hint warn">At level {level} these IVs give CP {fmt(calc!)}. <button className="btn ghost sm" onClick={() => setCp(calc!)}>Use {fmt(calc!)}</button></span>;
  else if (calc !== null && cpVal === calc) cpHint = <span className="cx-hint ok">✓ CP matches level {level} with these IVs.</span>;

  let levelHint: ReactNode = null;
  if (!level && cpVal !== '' && ivKnown && p) {
    levelHint = inferred.length
      ? <span className="cx-hint ok">Level inferred from CP + IVs: <span className="cx-levels" style={{ display: 'inline-flex' }}>{inferred.map((L) => <button key={L} className="chip" onClick={() => setLevel(L)}>Lv {L}</button>)}</span>{inferred.length > 1 && ' (several match — pick one, or the lowest is saved)'}</span>
      : <span className="cx-hint warn">No level gives CP {fmt(cpVal)} with these IVs — double-check CP and IVs.</span>;
  }

  const save = () => {
    if (!p) return;
    const charged = [c1, c2].filter(Boolean);
    onSave({
      id: p.id,
      nickname: nickname.trim() || undefined,
      cp: cpVal === '' ? calc ?? undefined : cpVal,
      level: level || (inferred.length ? inferred[0] : undefined),
      ivs: ivKnown ? ivs : undefined,
      shadow: flags.shadow || undefined,
      purified: flags.purified || undefined,
      lucky: flags.lucky || undefined,
      shiny: flags.shiny || undefined,
      fast: fast || undefined,
      charged: charged.length ? charged : undefined,
      tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      notes: notes.trim() || undefined,
    });
  };

  return (
    <div className="overlay cx-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal cx-modal" role="dialog" aria-modal="true" aria-label={initial ? 'Edit Pokémon' : 'Add Pokémon'}>
        <div className="cx-modal-head">
          <h2>{initial ? 'Edit Pokémon' : 'Add a Pokémon'}</h2>
          <button className="btn ghost icon" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="cx-modal-body">
          <div className="cx-form-grid">
            <Field label="Pokémon" style={{ gridColumn: '1 / -1' }}>
              <PokemonPicker value={p} onChange={pickPokemon} filter={notMega} autoFocus={!initial} />
            </Field>
            <Field label="Nickname"><input className="input" value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="Optional" maxLength={40} /></Field>
            <Field label="CP"><NumberInput value={cpVal} onChange={setCp} min={10} max={10000} placeholder={calc !== null ? String(calc) : 'e.g. 1498'} /></Field>
            <Field label="Level" hint={level ? undefined : 'Leave blank to infer from CP + IVs'}>
              <Select value={level} onChange={setLevel} options={[{ id: 0, label: '— unknown —' }, ...LEVELS.map((L) => ({ id: L, label: `Level ${L}${L === 51 ? ' (Best Buddy)' : ''}` }))]} />
            </Field>
            <div className="full col" style={{ gap: 4 }}>{cpHint}{levelHint}</div>
            <div className="full">
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
                <span className="field-label">IVs {ivKnown && <span className="faint">· {ivPercent(ivs)}% · {'★'.repeat(appraisalStars(ivs)) || '0★'}</span>}</span>
                <Switch checked={ivKnown} onChange={setIvKnown} label="IVs known" />
              </div>
              {ivKnown ? (
                <>
                  <div className="row" style={{ gap: 6, marginBottom: 8 }}>
                    <button className="chip" onClick={() => setIvs([15, 15, 15])}>15/15/15</button>
                    <button className="chip" onClick={() => setIvs([0, 15, 15])}>0/15/15</button>
                    <Link className="chip" to={p ? `/tools/iv?id=${p.id}` : '/tools/iv'} onClick={onClose}>Find IVs with the IV Calculator →</Link>
                  </div>
                  <IvBlock ivs={ivs} onChange={setIvs} />
                </>
              ) : <p className="cx-hint">Without IVs, PvP ranks and CP/level calculations aren't available.</p>}
            </div>
            <div className="full row" style={{ gap: 16 }}>
              {MON_FLAGS.map((f) => (
                <Switch key={f.key} checked={flags[f.key]} onChange={(v) => setFlag(f.key, v)} label={f.label}
                  title={(f.key === 'shadow' || f.key === 'purified') && p && !p.shadowReleased ? 'Shadow form not released for this Pokémon' : undefined} />
              ))}
            </div>
            {p && (
              <>
                <Field label="Fast move"><MoveSelect pokemon={p} kind="fast" value={fast} onChange={setFast} allowNone /></Field>
                <Field label="Charged move"><MoveSelect pokemon={p} kind="charged" value={c1} onChange={setC1} allowNone shadow={flags.shadow} purified={flags.purified} /></Field>
                <Field label="Second charged move" style={{ gridColumn: '1 / -1' }}><MoveSelect pokemon={p} kind="charged" value={c2} onChange={setC2} allowNone shadow={flags.shadow} purified={flags.purified} /></Field>
              </>
            )}
            <Field label="Tags" hint="Comma separated, e.g. pvp, trade, keep" style={{ gridColumn: '1 / -1' }}><input className="input" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="pvp, great league" /></Field>
            <Field label="Notes" style={{ gridColumn: '1 / -1' }}><textarea className="input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Where you caught it, plans…" /></Field>
          </div>
        </div>
        <div className="cx-modal-foot">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={save} disabled={!p}>{initial ? 'Save changes' : 'Add Pokémon'}</button>
        </div>
      </div>
    </div>
  );
}

function IvBlock({ ivs, onChange }: { ivs: Ivs; onChange: (v: Ivs) => void }) {
  const labels = ['Attack', 'Defense', 'HP'];
  return (
    <div className="col" style={{ gap: 6 }}>
      {labels.map((l, i) => (
        <div key={l} className="row nowrap" style={{ gap: 10 }}>
          <span className="small muted" style={{ width: 56 }}>{l}</span>
          <input type="range" min={0} max={15} value={ivs[i]} aria-label={`${l} IV`} onChange={(e) => { const v = [...ivs] as Ivs; v[i] = Number(e.target.value); onChange(v); }} />
          <NumberInput value={ivs[i]} min={0} max={15} style={{ width: 58 }} onChange={(n) => { if (n === '') return; const v = [...ivs] as Ivs; v[i] = Math.max(0, Math.min(15, Math.round(n))); onChange(v); }} />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- table cells
function PvpCell({ r, league }: { r: PvpRank | null; league: string }) {
  if (!r) return <span className="faint" title={`Can't fit under the ${league} cap`}>—</span>;
  return (
    <span className={`pvp ${r.rank <= 100 ? 'top' : ''}`} title={`${league}: rank ${r.rank} of 4,096 · ${r.pct.toFixed(2)}% stat product · best at level ${r.level}, CP ${r.cp}`}>
      <span className="r num">#{fmt(r.rank)}</span>
      <span className="pct num">{r.pct.toFixed(1)}%</span>
    </span>
  );
}

function Flags({ m }: { m: SavedMon }) {
  const on = MON_FLAGS.filter((f) => m[f.key]);
  if (!on.length) return <span className="faint">—</span>;
  return <span className="cx-flags">{on.map((f) => <span key={f.key} className="cx-flag" style={{ background: f.color }} title={f.label}>{f.short}</span>)}</span>;
}

// ---------------------------------------------------------------- page
export default function MyPokemon() {
  const data = useData();
  const { settings, byId, moves } = data;
  const { mons, add, update, remove, setAll } = useMyPokemon();
  const [storedView, setView] = useStored<ListView>('mons.view', DEFAULT_LIST);
  const view = { ...DEFAULT_LIST, ...storedView };
  const patch = (v: Partial<ListView>) => setView((prev) => ({ ...DEFAULT_LIST, ...prev, ...v }));
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<SavedMon | 'new' | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  const rows = useMemo<Row[]>(() => mons.filter((m) => byId[m.id]).map((m) => {
    const p = byId[m.id];
    let level = m.level ?? null, levelInferred = false;
    if (level === null && m.cp && m.ivs) {
      const L = levelsForCp(p, settings, m.cp, m.ivs);
      if (L.length) { level = L[0]; levelInferred = true; }
    }
    const pvp = {} as Record<LeagueKey, PvpRank | null>;
    for (const lg of PVP_LEAGUES) pvp[lg.key] = m.ivs ? pvpRank(p, settings, m.ivs, lg.cap, view.maxLevel) : null;
    return {
      m, p, name: m.nickname || displayName(p, m.shadow), level, levelInferred,
      ivp: m.ivs ? ivPercent(m.ivs) : null, pvp,
      raid: level !== null ? raidRating(data, p, m, level) : null,
    };
  }), [mons, byId, settings, view.maxLevel, data]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((r) => {
      for (const f of view.flags) {
        if (f === 'hundo') { if (r.ivp !== 100) return false; }
        else if (f === 'noivs') { if (r.m.ivs) return false; }
        else if (!r.m[f as MonFlag]) return false;
      }
      if (view.viable) {
        const keys = view.viable === 'any' ? PVP_LEAGUES.map((l) => l.key) : [view.viable];
        if (!keys.some((k) => (r.pvp[k]?.rank ?? Infinity) <= 100)) return false;
      }
      if (s) {
        const hay = `${displayName(r.p)} ${r.m.nickname ?? ''} ${(r.m.tags ?? []).join(' ')} ${r.m.notes ?? ''} ${r.p.types.join(' ')} #${r.p.dex}`.toLowerCase();
        if (!s.split(/\s+/).every((w) => hay.includes(w))) return false;
      }
      return true;
    });
  }, [rows, q, view.flags, view.viable]);

  const big = 1e9;
  const { sorted, th } = useSort(filtered, { key: 'added', dir: -1 }, {
    name: (r) => r.name.toLowerCase(),
    dex: (r) => r.p.dex,
    cp: (r) => r.m.cp ?? -1,
    iv: (r) => r.ivp ?? -1,
    level: (r) => r.level ?? -1,
    great: (r) => r.pvp.great?.rank ?? big,
    ultra: (r) => r.pvp.ultra?.rank ?? big,
    little: (r) => r.pvp.little?.rank ?? big,
    raid: (r) => r.raid?.dps ?? -1,
    added: (r) => r.m.added,
  });
  const { visible, more } = useShowMore(sorted, 50);

  const grouped = useMemo(() => {
    if (!view.group) return null;
    const m = new Map<string, Row[]>();
    for (const r of visible) { const k = r.p.speciesId; if (!m.has(k)) m.set(k, []); m.get(k)!.push(r); }
    return [...m.values()];
  }, [visible, view.group]);

  // ----- summary
  const summary = useMemo(() => {
    const withIv = rows.filter((r) => r.ivp !== null);
    return {
      total: rows.length,
      species: new Set(rows.map((r) => r.p.speciesId)).size,
      hundos: withIv.filter((r) => r.ivp === 100).length,
      avgIv: withIv.length ? withIv.reduce((s, r) => s + r.ivp!, 0) / withIv.length : null,
      viable: rows.filter((r) => PVP_LEAGUES.some((l) => (r.pvp[l.key]?.rank ?? Infinity) <= 100)).length,
    };
  }, [rows]);

  // ----- import / export
  const stamp = new Date().toISOString().slice(0, 10);
  const exportJson = () => {
    download(`pogo-my-pokemon-${stamp}.json`, JSON.stringify({ app: 'pogo-companion', kind: 'mons', version: 1, exported: new Date().toISOString(), mons }, null, 2), 'application/json');
    toast.show(`Exported ${mons.length} Pokémon`);
  };
  const exportCsv = () => {
    const head = ['Pokemon', 'Id', 'Dex', 'Nickname', 'CP', 'Level', 'Atk IV', 'Def IV', 'HP IV', 'IV %', 'Shadow', 'Purified', 'Lucky', 'Shiny', 'Fast move', 'Charged move 1', 'Charged move 2',
      `GL rank (L${view.maxLevel})`, 'GL %', `UL rank (L${view.maxLevel})`, 'UL %', `LL rank (L${view.maxLevel})`, 'LL %', 'Raid DPS', 'Raid TDO', 'Tags', 'Notes', 'Added'];
    const lines = [head.map(csvCell).join(',')];
    for (const r of rows) {
      const m = r.m;
      lines.push([
        displayName(r.p, m.shadow), m.id, r.p.dex, m.nickname, m.cp, r.level, m.ivs?.[0], m.ivs?.[1], m.ivs?.[2], r.ivp,
        m.shadow ? 'yes' : '', m.purified ? 'yes' : '', m.lucky ? 'yes' : '', m.shiny ? 'yes' : '',
        m.fast ? moveName(moves, m.fast) : '', m.charged?.[0] ? moveName(moves, m.charged[0]) : '', m.charged?.[1] ? moveName(moves, m.charged[1]) : '',
        r.pvp.great?.rank, r.pvp.great?.pct.toFixed(2), r.pvp.ultra?.rank, r.pvp.ultra?.pct.toFixed(2), r.pvp.little?.rank, r.pvp.little?.pct.toFixed(2),
        r.raid?.dps.toFixed(2), r.raid?.tdo.toFixed(1), (m.tags ?? []).join('; '), m.notes, new Date(m.added).toISOString(),
      ].map(csvCell).join(','));
    }
    download(`pogo-my-pokemon-${stamp}.csv`, '﻿' + lines.join('\r\n'), 'text/csv;charset=utf-8');
    toast.show(`Exported ${rows.length} rows as CSV`);
  };
  const importJson = async (file: File) => {
    try {
      const { mons: incoming, skipped } = parseMonsJson(await file.text(), byId);
      if (!incoming.length) { toast.show(skipped ? `No valid Pokémon found (${skipped} skipped)` : 'No Pokémon found in that file'); return; }
      const have = new Set(mons.map((m) => m.uid));
      const fresh = incoming.filter((m) => !have.has(m.uid));
      const dupes = incoming.length - fresh.length;
      if (!fresh.length) { toast.show('Everything in that file is already saved'); return; }
      if (!window.confirm(`Import ${fresh.length} Pokémon${dupes ? ` (${dupes} already saved will be skipped)` : ''}${skipped ? ` — ${skipped} unrecognised entries ignored` : ''}? They'll be added to your ${mons.length} saved Pokémon.`)) return;
      setAll((prev) => [...prev, ...fresh]);
      toast.show(`Imported ${fresh.length} Pokémon`);
    } catch (e) {
      toast.show(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const del = (r: Row) => { if (window.confirm(`Delete ${r.name}${r.m.cp ? ` (CP ${r.m.cp})` : ''}?`)) { remove(r.m.uid); toast.show('Deleted'); } };
  const toggleFlagFilter = (k: string) => patch({ flags: view.flags.includes(k) ? view.flags.filter((x) => x !== k) : [...view.flags, k] });

  const renderRow = (r: Row) => {
    const m = r.m;
    const sub = [m.nickname ? displayName(r.p, m.shadow) : null, ...(m.tags ?? []).map((t) => `#${t}`)].filter(Boolean).join(' · ');
    return (
      <tr key={m.uid}>
        <td style={{ minWidth: 170 }}>
          <Mon p={r.p} shadow={m.shadow} shiny={m.shiny} size={36} sub={sub ? <span className="nick">{sub}</span> : undefined} />
          {m.nickname && <span className="sr-only">{m.nickname}</span>}
        </td>
        <td className="num bold">{m.cp ? fmt(m.cp) : <span className="faint">—</span>}</td>
        <td>
          {m.ivs ? (
            <div className="ivcell" title={`${m.ivs.join(' / ')} · ${'★'.repeat(appraisalStars(m.ivs)) || '0★'}`}>
              <span className={`ivpct ${r.ivp === 100 ? 'hundo' : (r.ivp ?? 0) >= 82.2 ? 'hi' : ''}`}>{r.ivp}%</span>
              <IvBars ivs={m.ivs} />
              <span className="faint small num hide-mobile">{m.ivs.join('/')}</span>
            </div>
          ) : <span className="faint">unknown</span>}
        </td>
        <td className="num">{r.level !== null ? <span title={r.levelInferred ? 'Inferred from CP + IVs' : undefined}>{r.level}{r.levelInferred && <span className="faint">*</span>}</span> : <span className="faint">—</span>}</td>
        <td className="hide-mobile"><Flags m={m} /></td>
        <td className="hide-mobile">
          {m.fast || m.charged?.length ? (
            <div className="col" style={{ gap: 2, fontSize: '0.82rem' }}>
              {m.fast && <MoveTag id={m.fast} />}
              {m.charged?.length ? <span className="row nowrap" style={{ gap: 8 }}>{m.charged.map((c) => <MoveTag key={c} id={c} />)}</span> : null}
            </div>
          ) : <span className="faint">—</span>}
        </td>
        {PVP_LEAGUES.map((l) => <td key={l.key} className="num"><PvpCell r={r.pvp[l.key]} league={l.name} /></td>)}
        <td className="num">
          {r.raid ? (
            <span className="pvp" title={`${moveName(moves, r.raid.fast)} / ${moveName(moves, r.raid.charged)} · TDO ${r.raid.tdo.toFixed(0)}${r.raid.usesOwnMoves ? '' : ' (best moveset — set moves to rate yours)'}`}>
              <span className="r num">{r.raid.dps.toFixed(1)}</span>
              <span className="pct">{r.raid.usesOwnMoves ? 'own moves' : 'best set'}</span>
            </span>
          ) : <span className="faint">—</span>}
        </td>
        <td>
          <div className="acts">
            <Link className="btn ghost sm" to={`/pvp/ivs?id=${m.id}&league=great`} title="PvP IV rankings">📊</Link>
            <button className="btn ghost sm" onClick={() => setEditing(m)} title="Edit" aria-label="Edit">✏️</button>
            <button className="btn ghost sm" onClick={() => del(r)} title="Delete" aria-label="Delete">🗑️</button>
          </div>
        </td>
      </tr>
    );
  };

  const fileInput = <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) importJson(f); e.target.value = ''; }} />;

  return (
    <div className="stack">
      <PageHeader
        title="My Pokémon"
        subtitle="Your saved individual Pokémon with IVs, PvP rank in each league and a raid DPS rating. Stored on this device."
        actions={
          <>
            <button className="btn" onClick={() => fileRef.current?.click()}>⬆ Import</button>
            <button className="btn" onClick={exportCsv} disabled={!mons.length}>CSV</button>
            <button className="btn" onClick={exportJson} disabled={!mons.length}>JSON</button>
            <button className="btn primary" onClick={() => setEditing('new')}>＋ Add Pokémon</button>
          </>
        }
      />
      {fileInput}

      {mons.length === 0 ? (
        <Card>
          <Empty icon="🎒">
            <h3 style={{ color: 'var(--text)', marginBottom: 6 }}>No saved Pokémon yet</h3>
            <p style={{ maxWidth: 520, margin: '0 auto 14px' }}>
              Use the <Link to="/tools/iv">IV Calculator</Link> to work out a Pokémon's IVs and save it here, or add one manually.
              Each one gets its PvP rank in Great, Ultra and Little League plus a raid DPS rating.
            </p>
            <div className="row" style={{ justifyContent: 'center' }}>
              <Link className="btn" to="/tools/iv">🧮 Open IV Calculator</Link>
              <button className="btn primary" onClick={() => setEditing('new')}>＋ Add manually</button>
              <button className="btn ghost" onClick={() => fileRef.current?.click()}>Import JSON</button>
            </div>
          </Empty>
        </Card>
      ) : (
        <>
          <div className="grid grid-4">
            <div className="stat-tile"><div className="label">Saved</div><div className="value">{fmt(summary.total)}</div><div className="sub">{fmt(summary.species)} species</div></div>
            <div className="stat-tile"><div className="label">Hundos</div><div className="value">{fmt(summary.hundos)}</div><div className="sub">15/15/15</div></div>
            <div className="stat-tile"><div className="label">Average IV</div><div className="value">{summary.avgIv === null ? '—' : `${summary.avgIv.toFixed(1)}%`}</div><div className="sub">of Pokémon with IVs</div></div>
            <div className="stat-tile"><div className="label">League-viable</div><div className="value">{fmt(summary.viable)}</div><div className="sub">rank ≤ 100 in GL, UL or LL</div></div>
          </div>

          <Card>
            <div className="stack-sm">
              <div className="cx-toolbar">
                <input className="input cx-search" placeholder="Search name, nickname, tag, type…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
                <Select value={view.viable} onChange={(viable) => patch({ viable })} options={[
                  { id: '', label: 'Any PvP rank' },
                  { id: 'any', label: 'Rank ≤ 100 in any league' },
                  { id: 'great', label: 'Great League rank ≤ 100' },
                  { id: 'ultra', label: 'Ultra League rank ≤ 100' },
                  { id: 'little', label: 'Little League rank ≤ 100' },
                ]} />
                <span className="row nowrap" style={{ gap: 6 }} title="Maximum level used for PvP IV ranks (51 = Best Buddy boost)">
                  <span className="small muted">Max level</span>
                  <Segmented size="sm" value={view.maxLevel} onChange={(maxLevel) => patch({ maxLevel })} options={[{ id: 50, label: '50' }, { id: 51, label: '51' }]} />
                </span>
              </div>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div className="chips">
                  {[...MON_FLAGS.map((f) => ({ key: f.key, label: f.label })), { key: 'hundo', label: '100% IV' }, { key: 'noivs', label: 'No IVs' }].map((f) => (
                    <button key={f.key} className={`chip ${view.flags.includes(f.key) ? 'on' : ''}`} onClick={() => toggleFlagFilter(f.key)}>{f.label}</button>
                  ))}
                </div>
                <Switch checked={view.group} onChange={(group) => patch({ group })} label="Group by species" />
              </div>
            </div>
          </Card>

          <Card flush title={<>{fmt(filtered.length)} of {fmt(rows.length)} Pokémon</>} footer={<>PvP rank is the stat-product rank among all 4,096 IV combinations (no IV floor), at the best level up to {view.maxLevel} under each cap. Raid DPS rates the Pokémon at its level against a neutral boss and assumes 15/15/15 IVs; it uses your moves when set, otherwise its best moveset. * = level inferred from CP + IVs.</>}>
            {filtered.length === 0 ? <Empty>No saved Pokémon match these filters.</Empty> : (
              <div className="table-wrap">
                <table className="table cx-mons">
                  <thead>
                    <tr>
                      {th('name', 'Pokémon')}
                      {th('cp', 'CP', { num: true })}
                      {th('iv', 'IV')}
                      {th('level', 'Lvl', { num: true })}
                      <th className="hide-mobile">Flags</th>
                      <th className="hide-mobile">Moves</th>
                      {PVP_LEAGUES.map((l) => <Fragment key={l.key}>{th(l.key, l.short, { num: true, title: `${l.name} IV rank (click twice for best first)` })}</Fragment>)}
                      {th('raid', 'Raid DPS', { num: true, title: 'Neutral-boss DPS at this level' })}
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {grouped
                      ? grouped.map((g) => [
                          <tr key={`g-${g[0].p.speciesId}`} className="group"><td colSpan={11}>{g[0].p.name} <span className="faint">· {g.length}</span></td></tr>,
                          ...g.map(renderRow),
                        ])
                      : visible.map(renderRow)}
                  </tbody>
                </table>
              </div>
            )}
            {more}
          </Card>

          {rows.length < mons.length && <div className="callout warn">{mons.length - rows.length} saved entries refer to Pokémon that aren't in the current game data and are hidden.</div>}
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn ghost danger sm" onClick={() => { if (window.confirm(`Delete all ${mons.length} saved Pokémon? This cannot be undone — export first if you want a backup.`)) { setAll([]); toast.show('All saved Pokémon deleted'); } }}>Delete all</button>
          </div>
        </>
      )}

      {editing && (
        <MonForm
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSave={(m) => {
            if (editing === 'new') { add(m); toast.show(`Added ${displayName(byId[m.id], m.shadow)}`); }
            else { update(editing.uid, m); toast.show('Saved'); }
            setEditing(null);
          }}
        />
      )}
      {toast.node}
    </div>
  );
}
