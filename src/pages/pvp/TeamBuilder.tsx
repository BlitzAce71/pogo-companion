import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, Empty, Mon, MultChip, PageHeader, PokemonPicker, Rank, Spinner, StatTile, Types, TypeBadge } from '../../components/ui';
import { displayName, useData, useRankings } from '../../lib/data';
import { effectiveness, TYPES } from '../../lib/pogo';
import { useStored } from '../../lib/storage';
import type { GameData, Pokemon, RankingRow } from '../../lib/types';
import { FormatPicker, Moveset, PvpMoveSelect, Rating, ShadowToggle, useDeferred } from './pvpUi';
import { formatByKey, isUncapped, makeCombatant, recommendedMoveset, rowFor } from './pvpUtils';
import { quickRating, type Combatant, type SimConfig } from './sim';

interface Member { id: string; shadow: boolean; moves: string[] | null }
interface TeamState { league: string; members: (Member | null)[] }
const DEFAULT_TEAM: TeamState = { league: 'great', members: [null, null, null] };

const META_SIZE = 100;     // meta Pokémon simulated against the team
const THREAT_SHOW = 10;
const ANSWER_TOP_THREATS = 5;
const SUGGEST_POOL = 60;   // candidates considered for "suggest a teammate"

interface BuiltMember { slot: number; m: Member; p: Pokemon; moves: string[]; c: Combatant | null; row: RankingRow | null; rank: number | null }
interface MetaMon { row: RankingRow; rank: number; p: Pokemon; c: Combatant }

/** Compact column header: species name, with an (S) for shadows. */
const short = (p: Pokemon, shadow: boolean) => `${p.name}${shadow ? ' (S)' : ''}`;

const metaCache = new Map<string, Combatant | null>();
function metaCombatant(data: GameData, row: RankingRow, cap: number, league: string): Combatant | null {
  const key = `${league}|${row.id}|${row.sh ? 1 : 0}`;
  if (!metaCache.has(key)) {
    const p = data.byId[row.id];
    metaCache.set(key, p ? makeCombatant(data, p, !!row.sh, { cap, moves: recommendedMoveset(data, [row], p, !!row.sh).moves }) : null);
  }
  return metaCache.get(key)!;
}

export default function TeamBuilder() {
  const data = useData();
  const [stored, setTeam] = useStored<TeamState>('pvp.team', DEFAULT_TEAM);
  const team: TeamState = { ...DEFAULT_TEAM, ...stored, members: stored.members?.length ? stored.members : DEFAULT_TEAM.members };
  const fmt = formatByKey(data.settings, team.league) || formatByKey(data.settings, 'great')!;
  const league = fmt.key;
  const cap = fmt.cp;
  const { rows, loading } = useRankings(league);
  const cfg: SimConfig = useMemo(() => ({ chart: data.types, combat: data.settings.combat, buffMode: 'guaranteed', forms: true }), [data]);

  const setMember = (i: number, m: Member | null) => setTeam((prev) => {
    const members = [...(prev.members?.length ? prev.members : DEFAULT_TEAM.members)];
    members[i] = m;
    return { ...DEFAULT_TEAM, ...prev, members };
  });
  const addSlot = () => setTeam((prev) => ({ ...DEFAULT_TEAM, ...prev, members: [...(prev.members || []), null].slice(0, 6) }));
  const removeSlot = (i: number) => setTeam((prev) => ({ ...DEFAULT_TEAM, ...prev, members: (prev.members || []).filter((_, k) => k !== i) }));
  const addToTeam = (id: string, shadow: boolean) => {
    const free = team.members.findIndex((m) => !m);
    if (free >= 0) setMember(free, { id, shadow, moves: null });
    else if (team.members.length < 6) setTeam((prev) => ({ ...DEFAULT_TEAM, ...prev, members: [...prev.members, { id, shadow, moves: null }] }));
  };

  const rankIndex = useMemo(() => {
    const m = new Map<string, number>();
    rows?.forEach((r, i) => { const k = `${r.id}|${r.sh ? 1 : 0}`; if (!m.has(k)) m.set(k, i + 1); });
    return m;
  }, [rows]);

  const built: BuiltMember[] = useMemo(() => team.members.map((m, slot) => {
    if (!m || !data.byId[m.id]) return null;
    const p = data.byId[m.id];
    const moves = m.moves && m.moves[0] ? m.moves : recommendedMoveset(data, rows, p, m.shadow).moves;
    const c = makeCombatant(data, p, m.shadow, { cap, moves });
    return { slot, m, p, moves, c, row: rowFor(rows, p.id, m.shadow), rank: rankIndex.get(`${p.id}|${m.shadow ? 1 : 0}`) ?? null };
  }).filter((x): x is BuiltMember => !!x), [team.members, data, rows, cap, rankIndex]);

  const meta: MetaMon[] = useMemo(() => {
    if (!rows) return [];
    const out: MetaMon[] = [];
    for (let i = 0; i < rows.length && out.length < META_SIZE; i++) {
      const c = metaCombatant(data, rows[i], cap, league);
      if (c) out.push({ row: rows[i], rank: i + 1, p: c.pokemon, c });
    }
    return out;
  }, [rows, data, cap, league]);

  const memberKey = built.map((b) => b.c?.key ?? '').join('&');
  const analysis = useDeferred(() => {
    const ms = built.filter((b) => b.c);
    if (!ms.length || !meta.length) return null;
    const ratings = ms.map((b) => meta.map((t) => quickRating(b.c!, t.c, 1, cfg)));
    const best = meta.map((_, k) => Math.max(...ratings.map((r) => r[k])));
    const coverage = best.filter((x) => x > 500).length / meta.length;
    const score = best.reduce((a, b) => a + b, 0) / meta.length / 10;
    const threats = meta.map((t, k) => ({ t, k, beats: ratings.filter((r) => r[k] < 500).length, avg: ratings.reduce((a, r) => a + r[k], 0) / ratings.length }))
      .sort((x, y) => y.beats - x.beats || x.avg - y.avg).slice(0, THREAT_SHOW);
    const top = threats.slice(0, ANSWER_TOP_THREATS);
    const memberSet = new Set(ms.map((b) => `${b.p.id}|${b.m.shadow}`));
    const answers = meta.filter((cand) => !memberSet.has(`${cand.p.id}|${!!cand.row.sh}`)).map((cand) => {
      const vs = top.map((th) => quickRating(cand.c, th.t.c, 1, cfg));
      return { cand, vs, wins: vs.filter((x) => x > 500).length, avg: vs.reduce((a, b) => a + b, 0) / vs.length };
    }).sort((x, y) => y.wins - x.wins || y.avg - x.avg).slice(0, 8);
    return { ms, ratings, best, coverage, score, threats, top, answers };
  }, [memberKey, meta, cfg]);

  const filled = built.length;
  const canSuggest = filled >= 1 && filled < 6 && !!meta.length;

  return (
    <>
      <PageHeader title="Team Builder"
        subtitle={<>Build a Trainer Battle team and see its type weaknesses, move coverage, and which meta Pokémon threaten it. Each member is simulated 1v1 (one shield each, rank-1 IVs) against the top {META_SIZE} of the chosen league’s PvPoke rankings.</>}
        actions={<Link className="btn" to={`/pvp?league=${league}`}>🏆 Rankings</Link>} />

      <Card style={{ marginBottom: 16 }} title="League" actions={<span className="badge accent">{fmt.title} · {isUncapped(cap) ? 'no cap' : `${cap} CP`}</span>}>
        <FormatPicker value={league} onChange={(k) => setTeam((prev) => ({ ...DEFAULT_TEAM, ...prev, league: k, members: (prev.members || []).map((m) => (m ? { ...m, moves: null } : m)) }))} />
      </Card>

      <Card title={`Your team (${filled}/${team.members.length})`} style={{ marginBottom: 16 }}
        actions={<span className="row nowrap" style={{ gap: 6 }}>
          {team.members.length < 6 && <button className="btn sm" onClick={addSlot}>＋ Slot</button>}
          {filled > 0 && <button className="btn sm ghost danger" onClick={() => setTeam((prev) => ({ ...DEFAULT_TEAM, ...prev, members: [null, null, null] }))}>Clear</button>}
        </span>}>
        <div className="team-slots">
          {team.members.map((m, i) => (
            <Slot key={i} i={i} m={m} b={built.find((x) => x.slot === i) || null} canRemove={team.members.length > 3}
              onChange={(nm) => setMember(i, nm)} onRemove={() => removeSlot(i)} />
          ))}
        </div>
      </Card>

      {filled === 0 ? (
        <Card><Empty icon="🧩">Add Pokémon to your team to see its analysis. Tip: open a Pokémon in the rankings and pick it here, or use “Suggest a teammate” once you have one.</Empty></Card>
      ) : (
        <div className="col" style={{ gap: 16 }}>
          <ScoreCard analysis={analysis.value} busy={analysis.busy || loading} members={built} />
          <DefenseCard members={built} />
          <CoverageCard members={built} />
          <ThreatsCard analysis={analysis.value} busy={analysis.busy || loading} members={built} league={league} />
          <AnswersCard analysis={analysis.value} busy={analysis.busy || loading} onAdd={addToTeam} canAdd={filled < 6} league={league} />
          {canSuggest && <SuggestCard members={built} meta={meta} cfg={cfg} onAdd={addToTeam} />}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------- slot
function Slot({ i, m, b, canRemove, onChange, onRemove }: { i: number; m: Member | null; b: BuiltMember | null; canRemove: boolean; onChange: (m: Member | null) => void; onRemove: () => void }) {
  const data = useData();
  const p = m ? data.byId[m.id] ?? null : null;
  const setMove = (k: number, id: string) => {
    if (!m || !b) return;
    const ms = [...b.moves];
    while (ms.length < 3) ms.push('');
    ms[k] = id;
    onChange({ ...m, moves: ms });
  };
  return (
    <div className={`team-slot ${p ? '' : 'empty'}`}>
      <div className="slot-head">
        <span className="small bold muted">#{i + 1}</span>
        <span className="spacer" />
        {b?.rank && <span className="badge" title="Rank in this league's PvPoke rankings">Meta #{b.rank}</span>}
        {canRemove && <button className="btn sm ghost" onClick={onRemove} aria-label="Remove slot">✕</button>}
      </div>
      <PokemonPicker value={p} allowClear onChange={(np) => onChange(np ? { id: np.id, shadow: false, moves: null } : null)} placeholder="Add a Pokémon…" />
      {p && m && b && (
        <>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <ShadowToggle p={p} value={m.shadow} onChange={(v) => onChange({ ...m, shadow: v, moves: null })} />
            {m.moves ? <button className="btn sm ghost" onClick={() => onChange({ ...m, moves: null })}>↺ recommended</button> : <span className="tiny faint">{b.row ? 'PvPoke moveset' : 'auto moveset'}</span>}
          </div>
          <PvpMoveSelect p={p} shadow={m.shadow} kind="fast" value={b.moves[0] || ''} onChange={(v) => setMove(0, v)} />
          <PvpMoveSelect p={p} shadow={m.shadow} kind="charged" value={b.moves[1] || ''} onChange={(v) => setMove(1, v)} allowNone />
          <PvpMoveSelect p={p} shadow={m.shadow} kind="charged" value={b.moves[2] || ''} onChange={(v) => setMove(2, v)} allowNone />
          {b.c && <Moveset moves={[b.c.fast.id, ...b.c.charged.map((x) => x.id)]} p={p} />}
          {b.c && <div className="tiny faint num">Rank-1 IVs {b.c.ivs.join('/')} · L{b.c.level} · {b.c.cp} CP</div>}
          {!b.c && <div className="callout warn small">Pick a fast move to include this Pokémon in simulations.</div>}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- analysis cards
type Analysis = {
  ms: BuiltMember[]; ratings: number[][]; best: number[]; coverage: number; score: number;
  threats: { t: MetaMon; k: number; beats: number; avg: number }[];
  top: { t: MetaMon; k: number; beats: number; avg: number }[];
  answers: { cand: MetaMon; vs: number[]; wins: number; avg: number }[];
};

function teamWeaknesses(data: GameData, members: BuiltMember[]) {
  return TYPES.map((t) => {
    const mults = members.map((b) => effectiveness(data.types, t, b.p.types));
    const weak = mults.filter((x) => x > 1.01).length;
    const resist = mults.filter((x) => x < 0.99).length;
    return { t, mults, weak, resist, status: weak >= 2 && weak > resist ? 'weak' as const : resist >= 2 && weak === 0 ? 'strong' as const : null };
  });
}

function ScoreCard({ analysis, busy, members }: { analysis: Analysis | null; busy: boolean; members: BuiltMember[] }) {
  const data = useData();
  const weak = useMemo(() => teamWeaknesses(data, members).filter((x) => x.status === 'weak'), [data, members]);
  const grade = analysis ? (analysis.score >= 68 ? 'A' : analysis.score >= 62 ? 'B' : analysis.score >= 56 ? 'C' : analysis.score >= 50 ? 'D' : 'E') : '—';
  return (
    <Card title="Team summary" footer="Team score = the average, over the top meta, of your best member’s battle rating ÷ 10 (50 = even). Coverage = share of the meta at least one member beats. Letter grade is a rough guide.">
      {busy && !analysis ? <Spinner label="Simulating the meta…" /> : (
        <div className="grid grid-4">
          <StatTile label="Team score" value={<span className="row nowrap" style={{ gap: 10 }}><span className="grade">{grade}</span><span>{analysis ? analysis.score.toFixed(1) : '—'}</span></span>} sub={busy ? 'updating…' : 'avg best rating ÷ 10'} />
          <StatTile label="Meta coverage" value={analysis ? `${Math.round(analysis.coverage * 100)}%` : '—'} sub={`of the top ${META_SIZE} beaten by someone`} />
          <StatTile label="Biggest threat" value={analysis?.threats[0] ? <span style={{ fontSize: '1rem' }}>{displayName(analysis.threats[0].t.p, !!analysis.threats[0].t.row.sh)}</span> : '—'}
            sub={analysis?.threats[0] ? `beats ${analysis.threats[0].beats}/${analysis.ms.length} members` : undefined} />
          <StatTile label="Shared weaknesses" value={weak.length} sub={weak.length ? <span className="types">{weak.map((w) => <TypeBadge key={w.t} type={w.t} small noIcon />)}</span> : 'none'} />
        </div>
      )}
    </Card>
  );
}

function DefenseCard({ members }: { members: BuiltMember[] }) {
  const data = useData();
  const rows = useMemo(() => teamWeaknesses(data, members), [data, members]);
  return (
    <Card title="Defensive matchups" flush footer="Damage multiplier each member takes from every attacking type. Red rows: two or more members are weak and weaknesses outnumber resistances.">
      <div className="table-wrap">
        <table className="table compact def-table">
          <thead><tr><th>Attacking type</th>{members.map((b) => <th key={b.slot} title={displayName(b.p, b.m.shadow)}>{short(b.p, b.m.shadow)}</th>)}<th>Weak / Resist</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.t} className={r.status || ''}>
                <td><TypeBadge type={r.t} small /></td>
                {r.mults.map((m, i) => <td key={i}><MultChip m={m} /></td>)}
                <td className="num small"><span className={r.weak ? 'bad' : 'faint'}>{r.weak}</span> / <span className={r.resist ? 'good' : 'faint'}>{r.resist}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function CoverageCard({ members }: { members: BuiltMember[] }) {
  const data = useData();
  const cov = useMemo(() => TYPES.map((t) => {
    let best = 0, by: { p: Pokemon; move: string } | null = null;
    for (const b of members) if (b.c) for (const mv of [b.c.fast, ...b.c.charged]) {
      const e = effectiveness(data.types, mv.type, [t]);
      if (e > best) { best = e; by = { p: b.p, move: mv.name }; }
    }
    return { t, best, by };
  }), [data, members]);
  const gaps = cov.filter((c) => c.best < 1.59);
  return (
    <Card title="Offensive coverage" footer="Best multiplier your chosen moves (fast and charged) reach against each single type.">
      {gaps.length > 0 && <div className="callout warn small" style={{ marginBottom: 12 }}>No super-effective coverage vs <span className="types">{gaps.map((g) => <TypeBadge key={g.t} type={g.t} small noIcon />)}</span></div>}
      <div className="cov-grid">
        {cov.map((c) => (
          <div key={c.t} className={`cov-cell ${c.best < 1.59 ? 'gap' : ''}`}>
            <span className="col" style={{ gap: 2, minWidth: 0 }}>
              <TypeBadge type={c.t} small />
              {c.by && <span className="by" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.by.move}</span>}
            </span>
            <MultChip m={c.best || 1} />
          </div>
        ))}
      </div>
    </Card>
  );
}

function ThreatsCard({ analysis, busy, members, league }: { analysis: Analysis | null; busy: boolean; members: BuiltMember[]; league: string }) {
  const simulable = members.filter((b) => b.c);
  return (
    <Card title="Threats" flush footer="Meta Pokémon that beat the most of your members (1 shield each). Ratings are from your member’s side — tap one to open the simulator.">
      {busy && !analysis ? <Spinner label="Finding threats…" /> : !analysis ? <Empty>Rankings unavailable for this league.</Empty> : (
        <div className="table-wrap">
          <table className="table compact pvp-table">
            <thead><tr><th className="num">Meta</th><th>Pokémon</th><th className="num">Beats</th>{simulable.map((b) => <th key={b.slot} className="center" title={displayName(b.p, b.m.shadow)}>{short(b.p, b.m.shadow)}</th>)}</tr></thead>
            <tbody>
              {analysis.threats.map(({ t, k, beats }) => (
                <tr key={`${t.p.id}${t.row.sh ? 's' : ''}`}>
                  <td className="num"><Rank n={t.rank} /></td>
                  <td><Mon p={t.p} shadow={!!t.row.sh} size={28} sub={<Types types={t.p.types} small />} /></td>
                  <td className={`num bold ${beats >= Math.ceil(simulable.length / 2) ? 'bad' : ''}`}>{beats}/{simulable.length}</td>
                  {analysis.ms.map((b, i) => (
                    <td key={b.slot} className="center">
                      <Link to={`/pvp/sim?league=${league}&a=${b.p.id}${b.m.shadow ? '&as=1' : ''}&b=${t.p.id}${t.row.sh ? '&bs=1' : ''}`}><Rating r={analysis.ratings[i][k]} /></Link>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function AnswersCard({ analysis, busy, onAdd, canAdd, league }: { analysis: Analysis | null; busy: boolean; onAdd: (id: string, shadow: boolean) => void; canAdd: boolean; league: string }) {
  return (
    <Card title="Answers to your top threats" flush footer={`Highly ranked Pokémon that beat the most of your top ${ANSWER_TOP_THREATS} threats (1 shield each).`}>
      {busy && !analysis ? <Spinner label="Looking for answers…" /> : !analysis ? null : (
        <div className="table-wrap">
          <table className="table compact pvp-table">
            <thead><tr><th className="num">Meta</th><th>Pokémon</th><th className="num">Wins</th>{analysis.top.map((th) => <th key={`${th.t.p.id}${th.t.row.sh}`} className="center" title={`vs ${displayName(th.t.p, !!th.t.row.sh)}`}>vs {short(th.t.p, !!th.t.row.sh)}</th>)}<th /></tr></thead>
            <tbody>
              {analysis.answers.map(({ cand, vs, wins }) => (
                <tr key={`${cand.p.id}${cand.row.sh ? 's' : ''}`}>
                  <td className="num"><Rank n={cand.rank} /></td>
                  <td><Mon p={cand.p} shadow={!!cand.row.sh} size={28} sub={<Moveset moves={cand.row.m} p={cand.p} />} /></td>
                  <td className="num bold">{wins}/{vs.length}</td>
                  {vs.map((r, i) => <td key={i} className="center"><Link to={`/pvp/sim?league=${league}&a=${cand.p.id}${cand.row.sh ? '&as=1' : ''}&b=${analysis.top[i].t.p.id}${analysis.top[i].t.row.sh ? '&bs=1' : ''}`}><Rating r={r} /></Link></td>)}
                  <td>{canAdd && <button className="btn sm" onClick={() => onAdd(cand.p.id, !!cand.row.sh)}>＋ Add</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function SuggestCard({ members, meta, cfg, onAdd }: { members: BuiltMember[]; meta: MetaMon[]; cfg: SimConfig; onAdd: (id: string, shadow: boolean) => void }) {
  const [run, setRun] = useState(0);
  const memberKey = members.map((b) => b.c?.key ?? '').join('&');
  const res = useDeferred(() => {
    if (!run) return null;
    const ms = members.filter((b) => b.c);
    if (!ms.length) return null;
    const base = meta.map((t) => Math.max(...ms.map((b) => quickRating(b.c!, t.c, 1, cfg))));
    const baseAvg = base.reduce((a, b) => a + b, 0) / base.length;
    const baseCov = base.filter((x) => x > 500).length;
    const have = new Set(ms.map((b) => `${b.p.id}|${b.m.shadow}`));
    return meta.slice(0, SUGGEST_POOL).filter((c) => !have.has(`${c.p.id}|${!!c.row.sh}`)).map((cand) => {
      const nb = meta.map((t, k) => Math.max(base[k], quickRating(cand.c, t.c, 1, cfg)));
      const avg = nb.reduce((a, b) => a + b, 0) / nb.length;
      return { cand, score: avg / 10, gain: (avg - baseAvg) / 10, cov: nb.filter((x) => x > 500).length, covGain: nb.filter((x) => x > 500).length - baseCov };
    }).sort((a, b) => b.score - a.score).slice(0, 6);
  }, [run, memberKey, meta, cfg]);
  return (
    <Card title="Suggest a teammate" actions={<button className="btn primary sm" onClick={() => setRun((x) => x + 1)} disabled={res.busy && run > 0}>{run ? '↻ Re-run' : '✨ Suggest'}</button>}
      footer={`Tests the top ${SUGGEST_POOL} ranked Pokémon as an extra member and ranks them by the new team score (best member rating vs the top ${META_SIZE}).`}>
      {!run ? <span className="small muted">Find the ranked Pokémon that best covers what your current {members.length === 1 ? 'pick' : `${members.length} picks`} can’t beat.</span>
        : res.busy ? <Spinner label="Testing candidates…" /> : !res.value?.length ? <Empty>No suggestions.</Empty> : (
          <div className="table-wrap">
            <table className="table compact pvp-table">
              <thead><tr><th className="num">Meta</th><th>Pokémon</th><th className="num">New score</th><th className="num">Coverage</th><th /></tr></thead>
              <tbody>
                {res.value.map(({ cand, score, gain, cov, covGain }) => (
                  <tr key={`${cand.p.id}${cand.row.sh ? 's' : ''}`}>
                    <td className="num"><Rank n={cand.rank} /></td>
                    <td><Mon p={cand.p} shadow={!!cand.row.sh} size={28} sub={<Types types={cand.p.types} small />} /></td>
                    <td className="num"><b>{score.toFixed(1)}</b> <span className="good small">+{gain.toFixed(1)}</span></td>
                    <td className="num">{Math.round((cov / meta.length) * 100)}% <span className="good small">+{covGain}</span></td>
                    <td><button className="btn sm" onClick={() => onAdd(cand.p.id, !!cand.row.sh)}>＋ Add</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </Card>
  );
}
