import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Card, copyText, Empty, Field, IvBars, IvInputs, NumberInput, PageHeader, PokeImg, PokemonPicker, Rank, Segmented, Select, Spinner, StatTile, Switch, Types, useShowMore, useToast } from '../../components/ui';
import { displayName, loadRankings, useData } from '../../lib/data';
import { cp, rankPvpIvs, type PvpIvRow } from '../../lib/pogo';
import { useStored } from '../../lib/storage';
import type { Pokemon } from '../../lib/types';
import { useDeferred } from './pvpUi';
import { buildSearchString, IV_FLOORS, isUncapped, parseIvLine, searchName, type Ivs } from './pvpUtils';
import './pvp.css';

const LEAGUES = [
  { id: 'little', label: 'Little', cap: 500 },
  { id: 'great', label: 'Great', cap: 1500 },
  { id: 'ultra', label: 'Ultra', cap: 2500 },
  { id: 'master', label: 'Master', cap: 10000 },
  { id: 'custom', label: 'Custom', cap: 0 },
] as const;
type LeagueId = (typeof LEAGUES)[number]['id'];

const ivKey = (v: Ivs) => v.join('/');
const pctClass = (p: number) => (p >= 98 ? 'pct-good' : p >= 95 ? 'pct-ok' : 'pct-bad');
const f1 = (n: number) => n.toFixed(1);

export default function PvpIvs() {
  const data = useData();
  const { settings } = data;
  const [params, setParams] = useSearchParams();
  const [lastId, setLastId] = useStored<string | null>('pvp.ivs.last', null);
  const [ivs, setIvs] = useStored<Ivs>('pvp.ivs.mine', [0, 15, 15]);
  const [customCap, setCustomCap] = useStored<number>('pvp.ivs.customCap', 1500);
  const [floorId, setFloorId] = useStored<string>('pvp.ivs.floor', 'wild');
  const [topN, setTopN] = useState<number>(25);
  const toast = useToast();

  const id = params.get('id') || lastId;
  const p = id ? data.byId[id] ?? null : null;
  const leagueParam = params.get('league') || 'great';
  const leagueId: LeagueId = (LEAGUES.some((l) => l.id === leagueParam) ? leagueParam : /^\d+$/.test(leagueParam) ? 'custom' : 'great') as LeagueId;
  const cap = leagueId === 'custom' ? (/^\d+$/.test(leagueParam) ? Number(leagueParam) : customCap) : LEAGUES.find((l) => l.id === leagueId)!.cap;
  const maxLevel = params.get('ml') === '51' ? 51 : 50;
  const floor = IV_FLOORS.find((f) => f.id === floorId)?.min ?? 0;

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) { if (v === null) next.delete(k); else next.set(k, v); }
    setParams(next, { replace: true });
  };
  const pick = (np: Pokemon | null) => { if (np) { setLastId(np.id); update({ id: np.id }); } else { setLastId(null); update({ id: null }); } };

  // keep IVs above the floor
  useEffect(() => { if (ivs.some((v) => v < floor)) setIvs(ivs.map((v) => Math.max(v, floor)) as Ivs); }, [floor]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => (p && cap > 0 ? rankPvpIvs(p, settings, { cap, maxLevel, minIv: floor }) : []), [p, settings, cap, maxLevel, floor]);
  const rowsAll = useMemo(() => (p && cap > 0 ? (floor > 0 ? rankPvpIvs(p, settings, { cap, maxLevel }) : rows) : []), [p, settings, cap, maxLevel, floor, rows]);
  const index = useMemo(() => new Map(rows.map((r) => [ivKey(r.ivs), r])), [rows]);
  const indexAll = useMemo(() => new Map(rowsAll.map((r) => [ivKey(r.ivs), r])), [rowsAll]);
  const mine = index.get(ivKey(ivs)) || null;
  const mineAll = indexAll.get(ivKey(ivs)) || null;
  const r1 = rows[0] || null;
  const minCp = p ? cp(p, settings, 1, [floor, floor, floor]) : 0;
  const maxCp = p ? cp(p, settings, maxLevel, [15, 15, 15]) : 0;
  const uncapped = isUncapped(cap) || maxCp <= cap;

  return (
    <>
      <PageHeader title="PvP IV Ranker"
        subtitle="Rank every IV combination by stat product (Attack × Defense × HP) at the highest level that fits under a league’s CP cap. Check your Pokémon, compare its evolutions across leagues, bulk-check a list, and generate an in-game search string for the best spreads." />
      <div className="split">
        <div className="col sticky-side" style={{ gap: 16 }}>
          <Card title="Pokémon & league">
            <div className="col" style={{ gap: 12 }}>
              <PokemonPicker value={p} onChange={pick} placeholder="Search Pokémon…" autoFocus={!p} />
              <Field label="League / CP cap">
                <Segmented size="sm" options={LEAGUES.map((l) => ({ id: l.id, label: l.label }))} value={leagueId}
                  onChange={(v) => update({ league: v === 'custom' ? String(customCap) : v })} />
              </Field>
              {leagueId === 'custom' && (
                <Field label="Custom CP cap">
                  <NumberInput value={cap} min={10} max={10000} step={50} onChange={(v) => { if (v !== '' && v >= 10) { setCustomCap(v); update({ league: String(v) }); } }} />
                </Field>
              )}
              <div className="fields">
                <Field label="Max level" hint="Best Buddy adds +1 level">
                  <Segmented size="sm" options={[{ id: 50, label: 'L50' }, { id: 51, label: 'L51 buddy' }]} value={maxLevel} onChange={(v) => update({ ml: v === 51 ? '51' : null })} />
                </Field>
                <Field label="IV floor" hint="Minimum IVs for how it was obtained">
                  <Select className="sm" value={floorId} onChange={setFloorId} options={IV_FLOORS.map((f) => ({ id: f.id, label: f.label }))} />
                </Field>
              </div>
            </div>
          </Card>
          {p && (
            <Card title="Your IVs" actions={<span className="num bold">{ivs.join(' / ')}</span>}>
              <IvInputs value={ivs} onChange={setIvs} min={floor} />
              <div className="row" style={{ marginTop: 10, gap: 6 }}>
                {r1 && <button className="btn sm" onClick={() => setIvs(r1.ivs)}>Set to rank 1</button>}
                <button className="btn sm ghost" onClick={() => setIvs([15, 15, 15])}>15/15/15</button>
              </div>
            </Card>
          )}
        </div>

        <div className="col" style={{ gap: 16, minWidth: 0 }}>
          {!p && <Card><Empty icon="📊">Pick a Pokémon to rank its IVs for PvP.</Empty></Card>}
          {p && cap > 0 && rows.length === 0 && (
            <Card><Empty icon="🚫">{displayName(p)} can’t fit under {cap} CP even at level 1 ({minCp} CP minimum).</Empty></Card>
          )}
          {p && r1 && (
            <>
              <Card title={<span className="row nowrap" style={{ gap: 8 }}>{displayName(p)} <Types types={p.types} small /></span>}
                actions={<span className="badge accent">{isUncapped(cap) ? 'No cap' : `${cap} CP`} · L{maxLevel}{floor ? ` · floor ${floor}` : ''}</span>}>
                {uncapped && <div className="callout" style={{ marginBottom: 12 }}>Max CP at level {maxLevel} is {maxCp} — every spread reaches max level under this cap, so higher IVs are simply better (15/15/15 is rank 1).</div>}
                {mine ? (
                  <>
                    <div className="iv-result">
                      <StatTile label="Rank" value={<span>#{mine.rank.toLocaleString()}</span>} sub={`of ${rows.length.toLocaleString()}${floor ? ` (floor ${floor})` : ''}${floor && mineAll ? ` · #${mineAll.rank.toLocaleString()} of all` : ''}`} />
                      <StatTile label="% of rank 1" value={<span className={pctClass(mine.pct)}>{mine.pct.toFixed(2)}%</span>} sub="stat product" />
                      <StatTile label="Level · CP" value={<span>L{mine.level} · {mine.cp}</span>} sub={`Rank 1: L${r1.level} · ${r1.cp} CP`} />
                      <StatTile label="Stat product" value={Math.round(mine.product / 1000).toLocaleString()} sub={`Rank 1: ${Math.round(r1.product / 1000).toLocaleString()} (÷1000)`} />
                    </div>
                    <div className="table-wrap" style={{ marginTop: 12 }}>
                      <table className="table compact cmp-table">
                        <thead><tr><th>Stat</th><th>Yours ({ivs.join('/')})</th><th>Rank 1 ({r1.ivs.join('/')})</th><th>Difference</th></tr></thead>
                        <tbody>
                          {(['atk', 'def', 'hp'] as const).map((k) => {
                            const d = mine[k] - r1[k];
                            return (
                              <tr key={k}>
                                <td>{k === 'atk' ? 'Attack' : k === 'def' ? 'Defense' : 'HP'}</td>
                                <td className="num">{k === 'hp' ? mine[k] : f1(mine[k])}</td>
                                <td className="num">{k === 'hp' ? r1[k] : f1(r1[k])}</td>
                                <td className={`num ${d > 0.05 ? 'good' : d < -0.05 ? 'bad' : 'muted'}`}>{d > 0 ? '+' : ''}{k === 'hp' ? d : f1(d)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <div className="row" style={{ marginTop: 12, gap: 6 }}>
                      <Link className="btn sm" to={`/pvp/sim?a=${p.id}&league=${leagueId === 'custom' ? 'great' : leagueId}`}>🥊 Simulate</Link>
                      <Link className="btn sm" to={`/pvp?league=${leagueId === 'custom' ? 'great' : leagueId}`}>🏆 Rankings</Link>
                      <Link className="btn sm" to={`/dex/${p.id}`}>📖 Pokédex</Link>
                    </div>
                  </>
                ) : (
                  <div className="callout warn">{ivs.join('/')} {ivs.some((v) => v < floor) ? `is below the IV floor (${floor}).` : `can’t fit under ${cap} CP even at level 1.`}</div>
                )}
              </Card>

              <TopTable rows={rows} mine={mine} n={topN} setN={setTopN} />
              <FamilyCard p={p} ivs={ivs} maxLevel={maxLevel} floor={floor} onPick={pick} />
              <SearchStringCard p={p} rows={rows} toast={toast.show} />
              <BulkCard index={index} total={rows.length} floor={floor} />
            </>
          )}
        </div>
      </div>
      {toast.node}
    </>
  );
}

// ---------------------------------------------------------------- top N
function TopTable({ rows, mine, n, setN }: { rows: PvpIvRow[]; mine: PvpIvRow | null; n: number; setN: (n: number) => void }) {
  const list = useMemo(() => (n > 0 ? rows.slice(0, n) : rows), [rows, n]);
  const { visible, more } = useShowMore(list, 100);
  return (
    <Card title="Top IV spreads" flush actions={<Segmented size="sm" options={[{ id: 10, label: '10' }, { id: 25, label: '25' }, { id: 100, label: '100' }, { id: 0, label: 'All' }]} value={n} onChange={setN} />}>
      <div className="table-wrap" style={{ maxHeight: 520 }}>
        <table className="table compact pvp-table">
          <thead><tr><th className="num">Rank</th><th>IVs</th><th className="num">Level</th><th className="num">CP</th><th className="num">Atk</th><th className="num">Def</th><th className="num">HP</th><th className="num hide-mobile">Product</th><th className="num">%</th></tr></thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.rank} className={mine && mine.rank === r.rank ? 'me' : ''}>
                <td className="num"><Rank n={r.rank} /></td>
                <td><span className="row nowrap" style={{ gap: 8 }}><IvBars ivs={r.ivs} /><span className="num bold">{r.ivs.join('/')}</span></span></td>
                <td className="num">{r.level}</td>
                <td className="num">{r.cp}</td>
                <td className="num">{f1(r.atk)}</td>
                <td className="num">{f1(r.def)}</td>
                <td className="num">{r.hp}</td>
                <td className="num hide-mobile">{Math.round(r.product / 1000).toLocaleString()}</td>
                <td className={`num ${pctClass(r.pct)}`}>{r.pct.toFixed(2)}</td>
              </tr>
            ))}
            {mine && n > 0 && mine.rank > n && (
              <tr className="me">
                <td className="num"><Rank n={mine.rank} /></td>
                <td><span className="row nowrap" style={{ gap: 8 }}><IvBars ivs={mine.ivs} /><span className="num bold">{mine.ivs.join('/')}</span> <span className="badge accent">yours</span></span></td>
                <td className="num">{mine.level}</td><td className="num">{mine.cp}</td><td className="num">{f1(mine.atk)}</td><td className="num">{f1(mine.def)}</td><td className="num">{mine.hp}</td>
                <td className="num hide-mobile">{Math.round(mine.product / 1000).toLocaleString()}</td><td className={`num ${pctClass(mine.pct)}`}>{mine.pct.toFixed(2)}</td>
              </tr>
            )}
          </tbody>
        </table>
        {more}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- family
const FAMILY_LEAGUES = [
  { key: 'little', label: 'Little', cap: 500 },
  { key: 'great', label: 'Great', cap: 1500 },
  { key: 'ultra', label: 'Ultra', cap: 2500 },
  { key: 'master', label: 'Master', cap: 10000 },
];

function FamilyCard({ p, ivs, maxLevel, floor, onPick }: { p: Pokemon; ivs: Ivs; maxLevel: number; floor: number; onPick: (p: Pokemon) => void }) {
  const data = useData();
  const members = useMemo(() => {
    const fam = data.family(p.family).filter((m) => m.released || m.id === p.id);
    return fam.length ? fam : [p];
  }, [data, p]);
  const [meta, setMeta] = useState<Record<string, Record<string, number>>>({});
  useEffect(() => {
    let live = true;
    Promise.all(FAMILY_LEAGUES.map((l) => loadRankings(l.key).then((rows) => [l.key, rows] as const).catch(() => [l.key, []] as const))).then((res) => {
      if (!live) return;
      const out: Record<string, Record<string, number>> = {};
      for (const [k, rows] of res) {
        const m: Record<string, number> = {};
        rows.forEach((r, i) => { if (!r.sh && m[r.id] === undefined) m[r.id] = i + 1; });
        out[k] = m;
      }
      setMeta(out);
    });
    return () => { live = false; };
  }, []);
  const key = ivKey(ivs);
  const { value: table, busy } = useDeferred(() => members.map((m) => ({
    m,
    cells: FAMILY_LEAGUES.map((l) => {
      const rows = rankPvpIvs(m, data.settings, { cap: l.cap, maxLevel, minIv: floor });
      const row = rows.find((r) => ivKey(r.ivs) === key) || null;
      return { l, row, total: rows.length };
    }),
  })), [members, key, maxLevel, floor]);
  return (
    <Card title="Family across leagues" footer="Your IVs ranked for every member of the evolution family, in each open league. Meta # is the open-league PvPoke rank (non-shadow) when ranked.">
      {busy && !table && <Spinner label="Ranking the family…" />}
      {table && (
        <div className="table-wrap">
          <table className="table compact">
            <thead><tr><th>Pokémon</th>{FAMILY_LEAGUES.map((l) => <th key={l.key}>{l.label}</th>)}</tr></thead>
            <tbody>
              {table.map(({ m, cells }) => (
                <tr key={m.id} style={m.id === p.id ? { background: 'var(--accent-soft)' } : undefined}>
                  <td><button className="btn ghost sm" style={{ padding: '2px 4px' }} onClick={() => onPick(m)} title="Rank this Pokémon"><span className="mon"><PokeImg p={m} size={26} /><span className="mon-name">{displayName(m)}</span></span></button></td>
                  {cells.map(({ l, row, total }) => {
                    const mr = meta[l.key]?.[m.id];
                    return (
                      <td key={l.key}>
                        {total === 0 ? <span className="faint small">Over cap</span> : row ? (
                          <div className="family-cell">
                            <span><span className="num bold">#{row.rank}</span> <span className={`small num ${pctClass(row.pct)}`}>{row.pct.toFixed(1)}%</span></span>
                            <span className="tiny faint num">L{row.level} · {row.cp} CP</span>
                            {mr && <Link className="tiny" to={`/pvp?league=${l.key}`}>Meta #{mr}</Link>}
                          </div>
                        ) : <span className="faint small">—</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- search string
function SearchStringCard({ p, rows, toast }: { p: Pokemon; rows: PvpIvRow[]; toast: (m: string) => void }) {
  const [n, setN] = useState(10);
  const [family, setFamily] = useState(true);
  const res = useMemo(() => buildSearchString(searchName(p, family), rows.slice(0, n).map((r) => r.ivs)), [p, family, rows, n]);
  return (
    <Card title="In-game search string" actions={<Segmented size="sm" options={[5, 10, 25, 50, 100].map((x) => ({ id: x, label: `Top ${x}` }))} value={n} onChange={setN} />}
      footer={<>Uses the appraisal-bar filters (<span className="mono">attack</span>/<span className="mono">defense</span>/<span className="mono">hp</span> 0–4, where 0 = 0, 1 = 1–5, 2 = 6–10, 3 = 11–14, 4 = 15). Pokémon GO applies “,” (OR) before “&amp;” (AND), so the string is written as AND-ed groups. Bars are coarse, so a few non-top spreads can also match — check them here.</>}>
      <div className="col" style={{ gap: 10 }}>
        <textarea className="input search-out" readOnly value={res.query} onFocus={(e) => e.currentTarget.select()} aria-label="Search string" />
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <Switch checked={family} onChange={setFamily} label={<span>Whole family <span className="faint small">(+{p.name.toLowerCase()})</span></span>} />
          <button className="btn primary sm" onClick={async () => toast((await copyText(res.query)) ? 'Search string copied' : 'Copy failed — select and copy manually')}>Copy</button>
        </div>
        <div className="small muted">
          Matches all of your top {Math.min(n, rows.length)} spreads{res.extra > 0 ? <> plus <b>{res.extra}</b> other IV combination{res.extra === 1 ? '' : 's'} sharing the same appraisal bars</> : ' and nothing else'} · {res.query.length} characters.
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- bulk check
function BulkCard({ index, total, floor }: { index: Map<string, PvpIvRow>; total: number; floor: number }) {
  const [text, setText] = useStored('pvp.ivs.bulk', '');
  const [sortByRank, setSortByRank] = useState(true);
  const results = useMemo(() => {
    const out = text.split(/\r?\n/).map((line, i) => ({ line: line.trim(), i, ivs: parseIvLine(line) })).filter((x) => x.line)
      .map((x) => ({ ...x, row: x.ivs ? index.get(ivKey(x.ivs)) || null : null }));
    if (sortByRank) out.sort((a, b) => (a.row?.rank ?? 1e9) - (b.row?.rank ?? 1e9));
    return out;
  }, [text, index, sortByRank]);
  return (
    <Card title="Bulk check" actions={<Switch checked={sortByRank} onChange={setSortByRank} label="Sort by rank" />}>
      <div className="col" style={{ gap: 10 }}>
        <textarea className="input mono" rows={4} placeholder={'One per line, e.g.\n0/15/14\n2 13 15\nNickname 1-14-15'} value={text} onChange={(e) => setText(e.target.value)} aria-label="IVs to check" />
        {results.length > 0 && (
          <div className="table-wrap">
            <table className="table compact pvp-table">
              <thead><tr><th>Input</th><th>IVs</th><th className="num">Rank</th><th className="num">%</th><th className="num">Level</th><th className="num">CP</th></tr></thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.i}>
                    <td className="small muted" style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.line}</td>
                    {!r.ivs ? <td colSpan={5} className="small bad">Couldn’t read three IVs (0–15)</td> : !r.row ? (
                      <><td className="num bold">{r.ivs.join('/')}</td><td colSpan={4} className="small faint">{r.ivs.some((v) => v < floor) ? `Below IV floor ${floor}` : 'Over the cap'}</td></>
                    ) : (
                      <>
                        <td><span className="row nowrap" style={{ gap: 6 }}><IvBars ivs={r.row.ivs} /><span className="num bold">{r.row.ivs.join('/')}</span></span></td>
                        <td className="num"><Rank n={r.row.rank} /> <span className="tiny faint">/ {total}</span></td>
                        <td className={`num ${pctClass(r.row.pct)}`}>{r.row.pct.toFixed(2)}</td>
                        <td className="num">{r.row.level}</td>
                        <td className="num">{r.row.cp}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Card>
  );
}
