import { Fragment, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Card, Empty, IvBars, Mon, PageHeader, Rank, Spinner, Switch, Tabs, Types, useShowMore } from '../../components/ui';
import { displayName, useData, useRankings } from '../../lib/data';
import { typeIcon } from '../../lib/images';
import { TYPES } from '../../lib/pogo';
import { useStored } from '../../lib/storage';
import type { GameData, PokeType, RankingRow } from '../../lib/types';
import { FormatPicker, Moveset, Rating, useRankingsDate } from './pvpUi';
import { formatByKey, isUncapped, mainKeyForCap, rank1, shortLeague } from './pvpUtils';

type RoleId = 'overall' | 'lead' | 'closer' | 'switch' | 'charger' | 'attacker' | 'consistency';
const ROLES: { id: RoleId; label: string; idx: number; desc: string }[] = [
  { id: 'overall', label: 'Overall', idx: -1, desc: 'PvPoke’s overall score — a blend of every role below.' },
  { id: 'lead', label: 'Leads', idx: 0, desc: 'Even start, one shield each — how well it opens a battle.' },
  { id: 'closer', label: 'Closers', idx: 1, desc: 'No shields on either side — how well it finishes a game.' },
  { id: 'switch', label: 'Switches', idx: 2, desc: 'One shield each with a small energy head start — a safe switch-in.' },
  { id: 'charger', label: 'Chargers', idx: 3, desc: 'One shield each, starting with banked energy — how well it uses an energy lead.' },
  { id: 'attacker', label: 'Attackers', idx: 4, desc: 'No shields vs one opposing shield — winning from behind.' },
  { id: 'consistency', label: 'Consistency', idx: 5, desc: 'How little it relies on baiting shields — high means reliable results.' },
];

interface Ranked { row: RankingRow; rank: number; score: number; name: string }

function pvName(data: GameData, pv: string) {
  const r = data.fromPvpoke(pv);
  return r ? displayName(r.pokemon, r.shadow) : pv.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function Rankings() {
  const data = useData();
  const [params, setParams] = useSearchParams();
  const [savedLeague, setSavedLeague] = useStored('pvp.league', 'great');
  const league = formatByKey(data.settings, params.get('league'))?.key || formatByKey(data.settings, savedLeague)?.key || 'great';
  const fmt = formatByKey(data.settings, league);
  const role = (ROLES.find((r) => r.id === params.get('role'))?.id || 'overall') as RoleId;
  const roleDef = ROLES.find((r) => r.id === role)!;
  const [q, setQ] = useState('');
  const [types, setTypes] = useState<PokeType[]>([]);
  const [shadows, setShadows] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const { rows, loading, error } = useRankings(league);
  const date = useRankingsDate();

  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    next.set(k, v);
    setParams(next, { replace: true });
  };

  const ranked: Ranked[] = useMemo(() => {
    if (!rows) return [];
    const list = rows.filter((r) => data.byId[r.id]).map((row) => ({ row, rank: 0, score: roleDef.idx < 0 ? row.s : row.r[roleDef.idx] ?? 0, name: displayName(data.byId[row.id], !!row.sh) }));
    list.sort((a, b) => b.score - a.score);
    list.forEach((r, i) => { r.rank = i + 1; });
    return list;
  }, [rows, roleDef.idx, data.byId]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return ranked.filter((r) => {
      if (!shadows && r.row.sh) return false;
      if (s && !r.name.toLowerCase().includes(s)) return false;
      if (types.length && !data.byId[r.row.id].types.some((t) => types.includes(t))) return false;
      return true;
    });
  }, [ranked, q, types, shadows, data.byId]);

  const { visible, more } = useShowMore(filtered, 50);
  const top = ranked[0]?.score || 100;

  return (
    <>
      <PageHeader title="PvP Rankings"
        subtitle={<>Trainer Battle meta rankings from PvPoke{date ? ` (updated ${date})` : ''}. Pick a league or cup, filter by name, type or role, and expand any Pokémon for its key matchups, rank-1 IVs and quick links to the simulator and IV ranker.</>}
        actions={<><Link className="btn" to={`/pvp/team`}>🧩 Team builder</Link><Link className="btn" to={`/pvp/sim?league=${league}`}>🥊 Simulator</Link></>} />

      <Card className="pvp-controls-card" style={{ marginBottom: 16 }}>
        <div className="pvp-controls">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <FormatPicker value={league} onChange={(k) => { setParam('league', k); setSavedLeague(k); setOpen(null); }} />
            {fmt && <span className="badge accent">{fmt.title} · {isUncapped(fmt.cp) ? 'no CP cap' : `${fmt.cp} CP`}{rows ? ` · ${rows.length} ranked` : ''}</span>}
          </div>
          <div className="row">
            <input className="input search" placeholder="Search Pokémon…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search Pokémon" />
            <Switch checked={shadows} onChange={setShadows} label="Include shadows" />
            {(q || types.length > 0) && <button className="btn sm ghost" onClick={() => { setQ(''); setTypes([]); }}>Clear filters</button>}
          </div>
          <div className="chips type-chips" role="group" aria-label="Filter by type">
            {TYPES.map((t) => (
              <button key={t} className={`chip ${types.includes(t) ? 'on' : ''}`} onClick={() => setTypes((x) => (x.includes(t) ? x.filter((y) => y !== t) : [...x, t]))} style={types.includes(t) ? { borderColor: `var(--t-${t})` } : undefined}>
                <img src={typeIcon(t)} alt="" loading="lazy" /><span style={{ textTransform: 'capitalize' }}>{t}</span>
              </button>
            ))}
          </div>
        </div>
      </Card>

      <Tabs tabs={ROLES.map((r) => ({ id: r.id, label: r.label }))} value={role} onChange={(r) => setParam('role', r)} />
      <p className="small muted" style={{ marginTop: -6 }}>{roleDef.desc} Moves show fast-move turns, charged-move energy and how many fast moves it takes to reach each charged move from empty.</p>

      <Card flush>
        {loading && <Spinner label="Loading rankings…" />}
        {error && <Empty icon="⚠️">Couldn’t load rankings for this format.<div className="small">{error}</div></Empty>}
        {rows && filtered.length === 0 && <Empty>No Pokémon match these filters.</Empty>}
        {rows && filtered.length > 0 && (
          <div className="table-wrap">
            <table className="table pvp-table">
              <thead>
                <tr>
                  <th className="num">#</th>
                  <th>Pokémon</th>
                  <th className="hide-mobile">Types</th>
                  <th>{roleDef.label === 'Overall' ? 'Score' : roleDef.label.replace(/s$/, '')}</th>
                  <th className="hide-mobile">Recommended moveset</th>
                  <th aria-label="Details" />
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => {
                  const p = data.byId[r.row.id];
                  const key = `${r.row.id}${r.row.sh ? '_s' : ''}`;
                  const isOpen = open === key;
                  return (
                    <Fragment key={key}>
                      <tr className={`clickable ${isOpen ? 'open' : ''}`} onClick={() => setOpen(isOpen ? null : key)}>
                        <td className="num"><Rank n={r.rank} /></td>
                        <td onClick={(e) => e.stopPropagation()}>
                          <Mon p={p} shadow={!!r.row.sh} showTypes={false} sub={<span className="show-mobile"><Types types={p.types} small /></span>} />
                          <div className="show-mobile" style={{ marginTop: 4 }}><Moveset moves={r.row.m} p={p} /></div>
                        </td>
                        <td className="hide-mobile"><Types types={p.types} small /></td>
                        <td>
                          <span className="score-bar"><span className="num bold">{r.score.toFixed(1)}</span>
                            <span className="progress hide-mobile"><div style={{ width: `${Math.max(0, (r.score / top) * 100)}%` }} /></span></span>
                        </td>
                        <td className="hide-mobile" onClick={(e) => e.stopPropagation()}><Moveset moves={r.row.m} p={p} /></td>
                        <td className="right"><button className="expand-btn" aria-expanded={isOpen} aria-label={isOpen ? 'Collapse' : 'Expand'} onClick={(e) => { e.stopPropagation(); setOpen(isOpen ? null : key); }}>{isOpen ? '▾' : '▸'}</button></td>
                      </tr>
                      {isOpen && (
                        <tr className="pvp-detail"><td colSpan={6}><RowDetail r={r} league={league} cap={fmt?.cp ?? 1500} /></td></tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
            {more}
          </div>
        )}
      </Card>
      <p className="tiny faint" style={{ marginTop: 10 }}>Rankings, scores and matchup ratings are PvPoke’s. Ratings: 500 = even, above 500 = win. Shadow Pokémon are ranked separately.</p>
    </>
  );
}

function RowDetail({ r, league, cap }: { r: Ranked; league: string; cap: number }) {
  const data = useData();
  const p = data.byId[r.row.id];
  const sh = !!r.row.sh;
  const iv50 = useMemo(() => rank1(p, data.settings, cap, 50), [p, data.settings, cap]);
  const iv51 = useMemo(() => rank1(p, data.settings, cap, 51), [p, data.settings, cap]);
  const ivLeague = isUncapped(cap) ? 'master' : mainKeyForCap(cap);
  const simBase = `/pvp/sim?league=${league}&a=${p.id}${sh ? '&as=1' : ''}`;
  const matchup = (pv: string, rating: number) => {
    const res = data.fromPvpoke(pv);
    return (
      <li key={pv}>
        {res ? <Mon p={res.pokemon} shadow={res.shadow} size={26} /> : <span className="muted">{pvName(data, pv)}</span>}
        <span className="row nowrap" style={{ gap: 8 }}>
          {res && <Link className="sim-link" to={`${simBase}&b=${res.pokemon.id}${res.shadow ? '&bs=1' : ''}`} title="Simulate this matchup">sim ›</Link>}
          <Rating r={rating} />
        </span>
      </li>
    );
  };
  const ivBlock = (label: string, x: ReturnType<typeof rank1>) => (
    <div className="row nowrap" style={{ justifyContent: 'space-between' }}>
      <span className="small muted">{label}</span>
      {x ? <span className="row nowrap" style={{ gap: 8 }}><IvBars ivs={x.ivs} /><span className="num bold">{x.ivs.join('/')}</span><span className="small muted num">L{x.level} · {x.cp} CP</span></span> : <span className="small faint">Over the cap</span>}
    </div>
  );
  return (
    <div className="detail-grid">
      <div>
        <h3 className="small bold" style={{ marginBottom: 6 }}>Key wins</h3>
        {r.row.mu.length ? <ul className="matchup-list">{r.row.mu.map(([pv, rt]) => matchup(pv, rt))}</ul> : <span className="faint small">—</span>}
      </div>
      <div>
        <h3 className="small bold" style={{ marginBottom: 6 }}>Key losses</h3>
        {r.row.c.length ? <ul className="matchup-list">{r.row.c.map(([pv, rt]) => matchup(pv, rt))}</ul> : <span className="faint small">—</span>}
      </div>
      <div className="col" style={{ gap: 8 }}>
        <h3 className="small bold">Build</h3>
        <div className="kv">
          <span>Overall score</span><span className="num">{r.row.s.toFixed(1)}</span>
          {r.row.sp !== undefined && <><span>Stat product</span><span className="num" title="PvPoke's stat product (Atk × Def × HP ÷ 1000) at its default IVs">{r.row.sp.toLocaleString()}</span></>}
        </div>
        <div className="chips">
          {ROLES.filter((x) => x.idx >= 0).map((x) => <span key={x.id} className="badge" title={x.desc}>{x.label} <span className="num">{(r.row.r[x.idx] ?? 0).toFixed(1)}</span></span>)}
        </div>
        <div className="col" style={{ gap: 4 }}>
          <span className="tiny faint">Rank-1 IVs ({isUncapped(cap) ? 'no cap' : `${shortLeague(cap)} ${cap} CP`})</span>
          {ivBlock('Max level 50', iv50)}
          {ivBlock('Best buddy (51)', iv51)}
        </div>
        <div className="row" style={{ gap: 6 }}>
          <Link className="btn sm primary" to={simBase}>🥊 Simulate</Link>
          <Link className="btn sm" to={`/pvp/ivs?id=${p.id}&league=${ivLeague}`}>📊 IV ranks</Link>
          <Link className="btn sm" to={`/dex/${p.id}`}>📖 Pokédex</Link>
        </div>
      </div>
    </div>
  );
}
