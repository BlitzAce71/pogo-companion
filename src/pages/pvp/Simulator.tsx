import { useEffect, useMemo, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Card, copyText, Empty, Field, IvInputs, Mon, NumberInput, PageHeader, PokemonPicker, Segmented, Select, Switch, useToast } from '../../components/ui';
import { displayName, useData, useRankings } from '../../lib/data';
import { cp, effectiveness, LEVELS, pvpDamage, rankPvpIvs, stats } from '../../lib/pogo';
import { useStored } from '../../lib/storage';
import type { GameData, Pokemon } from '../../lib/types';
import { FormatPicker, HpBar, Moveset, PvpMove, PvpMoveSelect, Rating, ShadowToggle } from './pvpUi';
import { formatByKey, isUncapped, makeCombatant, maxLevelUnderCap, ratingClass, recommendedMoveset, type Ivs } from './pvpUtils';
import { simulate, type BuffMode, type Combatant, type ShieldMode, type SimConfig, type SimEvent, type SimResult, type SideOpts } from './sim';

// ---------------------------------------------------------------- state
type IvMode = 'rank1' | 'max' | 'custom';
interface SideCfg {
  id: string | null; shadow: boolean;
  league: string | null;            // null = same as the battle
  ivMode: IvMode; ivs: Ivs; level: number; // level 0 = highest under the cap
  maxLevel: 50 | 51;
  moves: string[] | null;           // null = recommended
  movesFor?: string;                // "id|shadow|league" the custom moves were picked for
  shields: number; energy: number;
  shieldMode: ShieldMode; bait: boolean;
}
interface SimOptsState { buffMode: BuffMode; smartPct: number; forms: boolean; seed: number }
interface SimState { league: string; a: SideCfg; b: SideCfg; opts: SimOptsState }

const SIDE0: SideCfg = { id: null, shadow: false, league: null, ivMode: 'rank1', ivs: [15, 15, 15], level: 0, maxLevel: 50, moves: null, shields: 1, energy: 0, shieldMode: 'always', bait: true };
const DEFAULT: SimState = { league: 'great', a: { ...SIDE0, id: 'MEDICHAM' }, b: { ...SIDE0, id: 'AZUMARILL' }, opts: { buffMode: 'guaranteed', smartPct: 40, forms: true, seed: 1 } };

interface Built { cfg: SideCfg; p: Pokemon | null; cap: number; leagueKey: string; combatant: Combatant | null; moves: string[]; recSource: 'rankings' | 'heuristic' | null; overCap: boolean; tooHigh: boolean }

function useBuilt(data: GameData, cfg: SideCfg, battleLeague: string): Built {
  const leagueKey = formatByKey(data.settings, cfg.league || battleLeague)?.key || 'great';
  const cap = formatByKey(data.settings, leagueKey)?.cp ?? 1500;
  const { rows } = useRankings(leagueKey);
  const p = cfg.id ? data.byId[cfg.id] ?? null : null;
  const cfgKey = JSON.stringify(cfg); // cfg is rebuilt every render; memo on its content
  return useMemo(() => {
    if (!p) return { cfg, p, cap, leagueKey, combatant: null, moves: [], recSource: null, overCap: false, tooHigh: false };
    const rec = recommendedMoveset(data, rows, p, cfg.shadow);
    const custom = !!(cfg.moves && cfg.moves[0] && cfg.movesFor === movesKey(cfg, leagueKey));
    const moves = custom ? cfg.moves! : rec.moves;
    let ivs: Ivs | undefined;
    let level: number | null = null;
    if (cfg.ivMode === 'max') ivs = [15, 15, 15];
    if (cfg.ivMode === 'custom') { ivs = cfg.ivs; level = cfg.level || null; }
    const tooHigh = cp(p, data.settings, 1, ivs || [0, 0, 0]) > cap;
    const combatant = makeCombatant(data, p, cfg.shadow, { cap, maxLevel: cfg.maxLevel, ivs, level, moves });
    const overCap = !!combatant && combatant.cp > cap;
    return { cfg, p, cap, leagueKey, combatant, moves, recSource: custom ? null : rec.source, overCap, tooHigh };
  }, [data, rows, p, cfgKey, cap, leagueKey]); // eslint-disable-line react-hooks/exhaustive-deps
}

const movesKey = (c: SideCfg, leagueKey: string) => `${c.id}|${c.shadow ? 1 : 0}|${leagueKey}`;
const sideOpts = (c: SideCfg): SideOpts => ({ shields: c.shields, energy: c.energy, shieldMode: c.shieldMode, bait: c.bait });
const time = (turn: number) => `${(turn * 0.5).toFixed(1)}s`;

// ---------------------------------------------------------------- page
export default function Simulator() {
  const data = useData();
  const [stored, setSt] = useStored<SimState>('pvp.sim', DEFAULT);
  const base: SimState = { ...DEFAULT, ...stored, a: { ...SIDE0, ...stored.a }, b: { ...SIDE0, ...stored.b }, opts: { ...DEFAULT.opts, ...stored.opts } };
  const [params, setParams] = useSearchParams();
  const toast = useToast();

  // The URL is the source of truth for species, shadow flags and league (so other pages can link in);
  // everything else (IVs, moves, shields…) persists locally.
  const urlLeague = params.get('league');
  const fromUrl = (k: 'a' | 'b') => {
    const id = params.get(k);
    return id && data.byId[id] ? { id, shadow: params.get(k === 'a' ? 'as' : 'bs') === '1' } : { id: base[k].id, shadow: base[k].shadow };
  };
  const st: SimState = { ...base, league: urlLeague && formatByKey(data.settings, urlLeague) ? urlLeague : base.league, a: { ...base.a, ...fromUrl('a') }, b: { ...base.b, ...fromUrl('b') } };
  const urlFor = (x: SimState) => {
    const next = new URLSearchParams();
    if (x.a.id) next.set('a', x.a.id);
    if (x.a.shadow) next.set('as', '1');
    if (x.b.id) next.set('b', x.b.id);
    if (x.b.shadow) next.set('bs', '1');
    next.set('league', x.league);
    return next;
  };
  // opened without parameters (e.g. from the menu): put the restored matchup in the URL so it can be shared
  useEffect(() => {
    if (!params.get('a') && !params.get('b') && !params.get('league')) setParams(urlFor(st), { replace: true });
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps
  const update = (fn: (x: SimState) => SimState) => {
    const next = fn(st);
    setSt(next);
    const u = urlFor(next);
    if (u.toString() !== params.toString()) setParams(u, { replace: true });
  };
  const setSide = (side: 'a' | 'b', patch: Partial<SideCfg>) => update((x) => ({ ...x, [side]: { ...x[side], ...patch } }));
  const setOpts = (patch: Partial<SimOptsState>) => update((x) => ({ ...x, opts: { ...x.opts, ...patch } }));

  const A = useBuilt(data, st.a, st.league);
  const B = useBuilt(data, st.b, st.league);
  const cfg: SimConfig = useMemo(() => ({ chart: data.types, combat: data.settings.combat, buffMode: st.opts.buffMode, smartPct: st.opts.smartPct, forms: st.opts.forms, seed: st.opts.seed }), [data, st.opts.buffMode, st.opts.smartPct, st.opts.forms, st.opts.seed]);
  const oa = sideOpts(st.a), ob = sideOpts(st.b);
  const ready = A.combatant && B.combatant;
  const result = useMemo(() => (A.combatant && B.combatant ? simulate(A.combatant, B.combatant, oa, ob, { ...cfg, log: true }) : null),
    [A.combatant, B.combatant, cfg, oa.shields, oa.energy, oa.shieldMode, oa.bait, ob.shields, ob.energy, ob.shieldMode, ob.bait]); // eslint-disable-line react-hooks/exhaustive-deps
  const matrix = useMemo(() => {
    if (!A.combatant || !B.combatant) return null;
    return [0, 1, 2].map((sa) => [0, 1, 2].map((sb) => simulate(A.combatant!, B.combatant!, { ...oa, shields: sa }, { ...ob, shields: sb }, cfg).rating[0]));
  }, [A.combatant, B.combatant, cfg, oa.energy, oa.shieldMode, oa.bait, ob.energy, ob.shieldMode, ob.bait]); // eslint-disable-line react-hooks/exhaustive-deps

  const swap = () => update((x) => ({ ...x, a: x.b, b: x.a }));
  const share = async () => toast.show((await copyText(location.href)) ? 'Link copied' : 'Copy failed');

  return (
    <>
      <PageHeader title="Battle Simulator"
        subtitle="Simulate a 1v1 Trainer Battle turn by turn: pick two Pokémon, IVs, moves, shields and starting energy. See the winner, battle rating, a timeline of every charged move, all nine shield scenarios, and the breakpoints that change fast-move damage."
        actions={<><button className="btn" onClick={swap}>⇄ Swap sides</button><button className="btn" onClick={share}>🔗 Copy link</button></>} />

      <Card style={{ marginBottom: 16 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <Field label="League (both sides)"><FormatPicker value={st.league} onChange={(k) => update((x) => ({ ...x, league: k }))} /></Field>
          <div className="row small muted">
            <Link to={`/pvp?league=${st.league}`}>🏆 Rankings</Link>
            <Link to="/pvp/team">🧩 Team builder</Link>
          </div>
        </div>
      </Card>

      <div className="sim-sides">
        <SidePanel side="a" built={A} other={B} onChange={(p) => setSide('a', p)} battleLeague={st.league} />
        <SidePanel side="b" built={B} other={A} onChange={(p) => setSide('b', p)} battleLeague={st.league} />
      </div>

      <div className="col" style={{ gap: 16, marginTop: 16 }}>
        {!ready && <Card><Empty icon="🥊">Pick a Pokémon with at least a fast move on both sides to run the battle.</Empty></Card>}
        {ready && result && (
          <>
            <ResultCard A={A.combatant!} B={B.combatant!} r={result} sa={st.a.shields} sb={st.b.shields} />
            <div className="grid grid-2">
              <MatrixCard A={A.combatant!} B={B.combatant!} m={matrix!} cur={[st.a.shields, st.b.shields]} onPick={(sa, sb) => update((x) => ({ ...x, a: { ...x.a, shields: sa }, b: { ...x.b, shields: sb } }))} />
              <OptionsCard opts={st.opts} setOpts={setOpts} />
            </div>
            <TimelineCard A={A.combatant!} B={B.combatant!} r={result} />
            <BreakpointsCard A={A} B={B} />
          </>
        )}
        <HowItWorks />
      </div>
      {toast.node}
    </>
  );
}

// ---------------------------------------------------------------- side panel
function SidePanel({ side, built, other, onChange, battleLeague }: { side: 'a' | 'b'; built: Built; other: Built; onChange: (p: Partial<SideCfg>) => void; battleLeague: string }) {
  const data = useData();
  const { cfg, p, combatant: c } = built;
  const levels = useMemo(() => LEVELS.filter((l) => l <= cfg.maxLevel), [cfg.maxLevel]);
  const setMove = (i: number, id: string) => {
    const ms = [...built.moves];
    while (ms.length < 3) ms.push('');
    ms[i] = id;
    onChange({ moves: ms, movesFor: movesKey(cfg, built.leagueKey) });
  };
  const autoLevel = p && cfg.ivMode === 'custom' ? maxLevelUnderCap(p, data.settings, cfg.ivs, built.cap, cfg.maxLevel) : null;
  const eff = c ? { atk: c.atk * (c.shadow ? data.settings.combat.shadowAtk : 1), def: c.def * (c.shadow ? data.settings.combat.shadowDef : 1) } : null;
  const fastE = c?.fast.energy || 0;
  return (
    <Card className={`side-card side-${side}`} title={<span className="row nowrap" style={{ gap: 8 }}><span className={`side-dot ${side}`} />{side === 'a' ? 'Side A' : 'Side B'}</span>}
      actions={p && <span className="row nowrap" style={{ gap: 6 }}><Link className="btn sm ghost" to={`/pvp/ivs?id=${p.id}&league=${built.cap <= 500 ? 'little' : built.cap <= 1500 ? 'great' : built.cap <= 2500 ? 'ultra' : 'master'}`} title="IV ranks">📊</Link><Link className="btn sm ghost" to={`/dex/${p.id}`} title="Pokédex">📖</Link></span>}>
      <div className="col" style={{ gap: 12 }}>
        <PokemonPicker value={p} onChange={(np) => onChange({ id: np?.id ?? null, shadow: np && cfg.shadow && np.shadowReleased ? cfg.shadow : false })} />
        {p && (
          <>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <ShadowToggle p={p} value={cfg.shadow} onChange={(v) => onChange({ shadow: v })} />
              <Select className="sm" style={{ width: 'auto' }} value={cfg.league || ''} onChange={(v) => onChange({ league: v || null })}
                options={[{ id: '', label: `Battle league (${formatByKey(data.settings, battleLeague)?.title ?? battleLeague})` }, ...data.settings.rankings.map((r) => ({ id: r.key, label: `${r.title}${r.cp >= 10000 ? '' : ` · ${r.cp}`}` }))]} />
            </div>

            <Field label="IVs & level">
              <Segmented size="sm" value={cfg.ivMode} onChange={(v) => onChange({ ivMode: v })}
                options={[{ id: 'rank1', label: isUncapped(built.cap) ? 'Rank 1 (15/15/15)' : 'Rank 1' }, { id: 'max', label: '15/15/15' }, { id: 'custom', label: 'Custom' }]} />
            </Field>
            {cfg.ivMode === 'custom' && (
              <div className="col" style={{ gap: 8 }}>
                <IvInputs value={cfg.ivs} onChange={(v) => onChange({ ivs: v })} />
                <Field label="Level">
                  <Select className="sm" value={cfg.level} onChange={(v) => onChange({ level: v })}
                    options={[{ id: 0, label: `Highest under cap${autoLevel ? ` (L${autoLevel})` : ''}` }, ...levels.map((l) => ({ id: l, label: `Level ${l}` }))]} />
                </Field>
              </div>
            )}
            <div className="row small" style={{ justifyContent: 'space-between' }}>
              <Segmented size="sm" value={cfg.maxLevel} onChange={(v) => onChange({ maxLevel: v })} options={[{ id: 50, label: 'Max L50' }, { id: 51, label: 'L51 buddy' }]} />
              {c && <span className="muted num">{c.ivs.join('/')} · L{c.level}</span>}
            </div>
            {c && eff && (
              <div className="stat-line">
                <div><div className="k">CP</div><div className={`v ${built.overCap ? 'bad' : ''}`}>{c.cp}</div></div>
                <div><div className="k">Atk{c.shadow ? '*' : ''}</div><div className="v">{eff.atk.toFixed(1)}</div></div>
                <div><div className="k">Def{c.shadow ? '*' : ''}</div><div className="v">{eff.def.toFixed(1)}</div></div>
                <div><div className="k">HP</div><div className="v">{c.hp}</div></div>
              </div>
            )}
            {c?.shadow && <div className="tiny faint">* Shadow bonus applied (×{data.settings.combat.shadowAtk} Atk, ×{data.settings.combat.shadowDef.toFixed(3)} Def).</div>}
            {built.tooHigh && <div className="callout warn small">{displayName(p)} is over {built.cap} CP even at level 1 with these IVs.</div>}
            {built.overCap && !built.tooHigh && <div className="callout warn small">CP {c?.cp} is over the {built.cap} cap at this level.</div>}

            <Field label={<span className="row nowrap" style={{ gap: 6 }}>Moves {built.recSource === 'rankings' ? <span className="badge accent">PvPoke recommended</span> : built.recSource === 'heuristic' ? <span className="badge">auto-picked</span> : <button className="btn sm ghost" style={{ padding: '0 6px' }} onClick={() => onChange({ moves: null })}>↺ recommended</button>}</span>}>
              <div className="col" style={{ gap: 6 }}>
                <PvpMoveSelect p={p} shadow={cfg.shadow} kind="fast" value={built.moves[0] || ''} onChange={(v) => setMove(0, v)} />
                <PvpMoveSelect p={p} shadow={cfg.shadow} kind="charged" value={built.moves[1] || ''} onChange={(v) => setMove(1, v)} allowNone />
                <PvpMoveSelect p={p} shadow={cfg.shadow} kind="charged" value={built.moves[2] || ''} onChange={(v) => setMove(2, v)} allowNone />
                {(p.megaOf || built.moves.length > 3) && <PvpMoveSelect p={p} shadow={cfg.shadow} kind="charged" value={built.moves[3] || ''} onChange={(v) => setMove(3, v)} allowNone />}
              </div>
            </Field>
            {c && <Moveset moves={[c.fast.id, ...c.charged.map((m) => m.id)]} p={p} />}
            {c && other.combatant && <DamageList att={c} def={other.combatant} />}

            <div className="fields">
              <Field label="Shields"><Segmented size="sm" value={cfg.shields} onChange={(v) => onChange({ shields: v })} options={[0, 1, 2].map((n) => ({ id: n, label: String(n) }))} /></Field>
              <Field label="Starting energy" hint={fastE ? `= ${Math.floor(cfg.energy / fastE)} fast moves` : undefined}>
                <NumberInput className="sm" value={cfg.energy} min={0} max={100} onChange={(v) => onChange({ energy: v === '' ? 0 : Math.max(0, Math.min(100, Math.round(v))) })} />
              </Field>
            </div>
            <div className="fields">
              <Field label="Shield strategy">
                <Select className="sm" value={cfg.shieldMode} onChange={(v) => onChange({ shieldMode: v })} options={[{ id: 'always', label: 'Shield everything' }, { id: 'smart', label: 'Smart (KO / big hits)' }, { id: 'never', label: 'Never shield' }]} />
              </Field>
              <Field label="Charged moves"><Switch checked={cfg.bait} onChange={(v) => onChange({ bait: v })} label="Bait shields" title="Throw the cheapest charged move while the opponent would shield it" /></Field>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

function DamageList({ att, def }: { att: Combatant; def: Combatant }) {
  const data = useData();
  const { combat } = data.settings;
  const a = att.atk * (att.shadow ? combat.shadowAtk : 1), d = def.def * (def.shadow ? combat.shadowDef : 1);
  const rows = [att.fast, ...att.charged].map((m) => {
    const eff = effectiveness(data.types, m.type, def.pokemon.types);
    const mult = (att.pokemon.types.includes(m.type) ? combat.stab : 1) * eff;
    const dmg = pvpDamage(m.power, a, d, mult);
    return { m, dmg, eff, pct: (dmg / def.hp) * 100 };
  });
  return (
    <div className="table-wrap">
      <table className="table compact">
        <thead><tr><th>vs {displayName(def.pokemon, def.shadow)}</th><th className="num">Dmg</th><th className="num">% HP</th><th className="num">Eff.</th></tr></thead>
        <tbody>
          {rows.map(({ m, dmg, eff, pct }) => (
            <tr key={m.id}>
              <td><PvpMove id={m.id} link={false} /></td>
              <td className="num bold">{dmg}</td>
              <td className="num">{pct.toFixed(1)}%</td>
              <td className={`num small ${eff > 1.01 ? 'good' : eff < 0.99 ? 'bad' : 'muted'}`}>×{Math.round(eff * 1000) / 1000}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------- result
function ResultCard({ A, B, r, sa, sb }: { A: Combatant; B: Combatant; r: SimResult; sa: number; sb: number }) {
  const winner = r.winner === 0 ? A : r.winner === 1 ? B : null;
  return (
    <Card title={`Result · ${sa}–${sb} shields`} actions={<span className="small muted num">{time(r.turns)} of turns · {r.turns} turns</span>}>
      <div className="col" style={{ gap: 14 }}>
        <div className={`winner-banner ${r.winner === 0 ? 'win-a' : r.winner === 1 ? 'win-b' : ''}`}>
          {winner ? <Mon p={winner.pokemon} shadow={winner.shadow} size={44} link={false} /> : <span style={{ fontSize: 30 }}>🤝</span>}
          <div className="col" style={{ gap: 2, flex: 1, minWidth: 160 }}>
            <span className="big">{winner ? `${displayName(winner.pokemon, winner.shadow)} wins` : r.reason === 'double-ko' ? 'Tie — both faint on the same turn' : 'Draw'}</span>
            <span className="small muted">{r.reason === 'timeout' ? 'Timer ran out — decided by battle rating.' : r.reason === 'double-ko' ? 'Simultaneous knockout.' : `${displayName((r.winner === 0 ? B : A).pokemon, (r.winner === 0 ? B : A).shadow)} fainted after ${time(r.turns)}.`}</span>
          </div>
          <div className="row nowrap" style={{ gap: 10 }}>
            <span className="col center" style={{ gap: 2 }}><span className="tiny faint">A rating</span><Rating r={r.rating[0]} /></span>
            <span className="col center" style={{ gap: 2 }}><span className="tiny faint">B rating</span><Rating r={r.rating[1]} /></span>
          </div>
        </div>
        <div className="grid grid-2">
          {[A, B].map((c, i) => (
            <div key={i} className="col" style={{ gap: 6 }}>
              <HpBar hp={r.hp[i]} max={r.maxHp[i]} label={<span className="row nowrap" style={{ gap: 6 }}><span className={`side-dot ${i ? 'b' : 'a'}`} /><b>{displayName(c.pokemon, c.shadow)}</b></span>} />
              <span className="tiny faint num">Energy left {r.energy[i]} · shields left {r.shieldsLeft[i]} · charged moves used {r.chargedUsed[i]}</span>
            </div>
          ))}
        </div>
        <HpChart r={r} />
      </div>
    </Card>
  );
}

function HpChart({ r }: { r: SimResult }) {
  const W = 600, H = 120;
  const T = Math.max(1, r.turns);
  const path = (i: 0 | 1) => {
    const pts = r.timeline;
    if (!pts.length) return '';
    const y = (hp: number) => 4 + (1 - hp / r.maxHp[i]) * (H - 8);
    let d = `M0,${y(pts[0].hp[i]).toFixed(1)}`;
    for (const p of pts.slice(1)) d += ` H${((p.turn / T) * W).toFixed(1)} V${y(p.hp[i]).toFixed(1)}`;
    return d + ` H${W}`;
  };
  const charged = r.events.filter((e) => e.kind === 'charged');
  return (
    <svg className="hp-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="HP over time">
      {[0.25, 0.5, 0.75].map((f) => <line key={f} className="grid-line" x1={0} x2={W} y1={4 + f * (H - 8)} y2={4 + f * (H - 8)} />)}
      {charged.map((e, k) => <line key={k} x1={(e.turn / T) * W} x2={(e.turn / T) * W} y1={0} y2={H} stroke={e.side ? 'var(--purple)' : 'var(--accent)'} strokeOpacity={0.35} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />)}
      <path d={path(0)} fill="none" stroke="var(--accent)" strokeWidth={2.5} vectorEffect="non-scaling-stroke" />
      <path d={path(1)} fill="none" stroke="var(--purple)" strokeWidth={2.5} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// ---------------------------------------------------------------- timeline
type TLRow = { kind: 'fast'; from: number; to: number; n: [number, number]; dmg: [number, number]; hp: [number, number] } | { kind: 'event'; e: SimEvent };

function buildTimeline(events: SimEvent[]): TLRow[] {
  const out: TLRow[] = [];
  let cur: Extract<TLRow, { kind: 'fast' }> | null = null;
  for (const e of events) {
    if (e.kind === 'fast') {
      if (!cur) { cur = { kind: 'fast', from: e.turn, to: e.turn, n: [0, 0], dmg: [0, 0], hp: e.hp }; out.push(cur); }
      cur.n[e.side]++; cur.dmg[e.side] += e.damage || 0; cur.to = e.turn; cur.hp = e.hp;
    } else { cur = null; out.push({ kind: 'event', e }); }
  }
  return out;
}

function TimelineCard({ A, B, r }: { A: Combatant; B: Combatant; r: SimResult }) {
  const rows = useMemo(() => buildTimeline(r.events), [r.events]);
  const cs = [A, B];
  const nm = (i: number) => displayName(cs[i].pokemon, cs[i].shadow);
  const stageTxt = (s: { side: 0 | 1; atk: number; def: number }) => {
    const f = (v: number) => (v > 0 ? `+${v}` : String(v));
    return `${nm(s.side)}: Atk ${f(s.atk)}, Def ${f(s.def)}`;
  };
  return (
    <Card title="Timeline" flush footer="Fast moves between charged moves are summarised. Times are battle turns × 0.5 s (charged-move animations not counted). HP shown after each step as A / B.">
      <ul className="timeline" style={{ padding: '4px 12px' }}>
        {rows.map((row, k) => {
          if (row.kind === 'fast') {
            const parts: ReactNode[] = [];
            [0, 1].forEach((i) => { if (row.n[i]) parts.push(<span key={i}><b>{row.n[i]}×</b> {cs[i].fast.name} <span className="faint">({row.dmg[i]} dmg)</span></span>); });
            return (
              <li key={k} className="fastsum">
                <span className="t">{time(row.from)}{row.to > row.from ? `–${time(row.to)}` : ''}</span>
                <span />
                <span className="row" style={{ gap: 4, rowGap: 0 }}>{parts.reduce<ReactNode[]>((acc, x, i) => (i ? [...acc, <span key={`s${i}`} className="faint">·</span>, x] : [x]), [])}</span>
                <span className="hp">{row.hp[0]} / {row.hp[1]}</span>
              </li>
            );
          }
          const e = row.e;
          const dot = <span className={`side-dot ${e.side ? 'b' : 'a'}`} />;
          if (e.kind === 'charged') return (
            <li key={k} className="charged">
              <span className="t">{time(e.turn)}</span>{dot}
              <span>
                <b>{nm(e.side)}</b> used <PvpMove id={e.move!.id} link={false} /> — {e.damage} dmg
                {e.shielded && <span className="badge accent" style={{ marginLeft: 6 }}>🛡 shielded</span>}
                {e.disguise && <span className="badge purple" style={{ marginLeft: 6 }}>Disguise</span>}
                {e.cmp && <span className="badge" style={{ marginLeft: 6 }} title="Both threw a charged move this turn">CMP{e.cmp === 'tie' ? ' tie' : ''}</span>}
              </span>
              <span className="hp">{e.hp[0]} / {e.hp[1]}</span>
            </li>
          );
          if (e.kind === 'buff') return (
            <li key={k} className="fastsum"><span className="t">{time(e.turn)}</span>{dot}<span>📈 {e.move?.name}: {e.stages?.map(stageTxt).join(' · ')}</span><span className="hp" /></li>
          );
          if (e.kind === 'faint') return (
            <li key={k} className="charged"><span className="t">{time(e.turn)}</span>{dot}<span className="bad">💀 {nm(e.side)} fainted</span><span className="hp">{e.hp[0]} / {e.hp[1]}</span></li>
          );
          return <li key={k}><span className="t">{time(e.turn)}</span><span /><span className="warn">⏱ Time up</span><span className="hp">{e.hp[0]} / {e.hp[1]}</span></li>;
        })}
      </ul>
    </Card>
  );
}

// ---------------------------------------------------------------- shield matrix
function MatrixCard({ A, B, m, cur, onPick }: { A: Combatant; B: Combatant; m: number[][]; cur: [number, number]; onPick: (a: number, b: number) => void }) {
  const wins = m.flat().filter((x) => x > 500).length;
  return (
    <Card title="Shield scenarios" actions={<span className="small muted">{displayName(A.pokemon, A.shadow)} wins {wins}/9</span>}
      footer="Battle rating for side A. Rows: A’s shields, columns: B’s shields. Tap a cell to load that scenario.">
      <div className="matrix">
        <span className="hdr">A \ B</span>
        {[0, 1, 2].map((b) => <span key={b} className="hdr">{b} 🛡</span>)}
        {m.map((row, a) => (
          <FragmentRow key={a} label={`${a} 🛡`}>
            {row.map((r, b) => (
              <button key={b} className={`cell rating ${ratingClass(r)} ${cur[0] === a && cur[1] === b ? 'cur' : ''}`} onClick={() => onPick(a, b)} title={`${a} vs ${b} shields: ${r}`}>{r}</button>
            ))}
          </FragmentRow>
        ))}
      </div>
      <div className="small muted" style={{ marginTop: 10 }}>vs <b>{displayName(B.pokemon, B.shadow)}</b></div>
    </Card>
  );
}
function FragmentRow({ label, children }: { label: string; children: ReactNode }) {
  return <><span className="hdr">{label}</span>{children}</>;
}

// ---------------------------------------------------------------- options
function OptionsCard({ opts, setOpts }: { opts: SimOptsState; setOpts: (p: Partial<SimOptsState>) => void }) {
  return (
    <Card title="Battle options">
      <div className="col" style={{ gap: 12 }}>
        <Field label="Move side effects (buffs/debuffs)" hint={opts.buffMode === 'guaranteed' ? 'Only 100%-chance effects apply (PvPoke default).' : opts.buffMode === 'always' ? 'Every chance-based effect triggers.' : 'Chance-based effects roll with a fixed seed.'}>
          <Segmented size="sm" value={opts.buffMode} onChange={(v) => setOpts({ buffMode: v })} options={[{ id: 'guaranteed', label: 'Guaranteed only' }, { id: 'always', label: 'Always trigger' }, { id: 'random', label: 'Random' }]} />
        </Field>
        {opts.buffMode === 'random' && (
          <div className="row"><span className="small muted">Seed {opts.seed}</span><button className="btn sm" onClick={() => setOpts({ seed: opts.seed + 1 })}>🎲 Re-roll</button></div>
        )}
        <Field label={`Smart shielding threshold: ${opts.smartPct}% of current HP`} hint="Sides set to “Smart” shield a hit that would KO them or take more than this share of their remaining HP.">
          <input type="range" min={10} max={90} step={5} value={opts.smartPct} onChange={(e) => setOpts({ smartPct: Number(e.target.value) })} />
        </Field>
        <Switch checked={opts.forms} onChange={(v) => setOpts({ forms: v })} label="Model Mimikyu’s Disguise" title="First charged move that hits Mimikyu is blocked; it becomes Busted (−1 Defense)" />
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- breakpoints
function BreakpointsCard({ A, B }: { A: Built; B: Built }) {
  return (
    <Card title="Breakpoints & bulkpoints" footer="Fast-move damage at the current stats (no buffs). A breakpoint is the Attack needed for +1 damage; a bulkpoint is the Defense needed to take 1 less. IV spreads are evaluated at their highest level under the cap.">
      <div className="bp-grid">
        <BpBox att={A} def={B} label="a" />
        <BpBox att={B} def={A} label="b" />
      </div>
    </Card>
  );
}

function BpBox({ att, def, label }: { att: Built; def: Built; label: 'a' | 'b' }) {
  const data = useData();
  const info = useMemo(() => {
    const a = att.combatant, d = def.combatant;
    if (!a || !d || !att.p || !def.p) return null;
    const { combat } = data.settings;
    const m = a.fast;
    const sa = a.shadow ? combat.shadowAtk : 1, sd = d.shadow ? combat.shadowDef : 1;
    const mult = (a.pokemon.types.includes(m.type) ? combat.stab : 1) * effectiveness(data.types, m.type, d.pokemon.types);
    const atkE = a.atk * sa, defE = d.def * sd;
    const dmg = pvpDamage(m.power, atkE, defE, mult);
    // damage = floor(k × atk) + 1 with k = 0.5 × power × mult × pvpBonus / def
    const k = (0.5 * m.power * mult * combat.pvpBonus) / defE;
    const needAtk = dmg / k / sa;                 // raw Attack stat for dmg + 1
    const rowsA = rankPvpIvs(att.p, data.settings, { cap: att.cap, maxLevel: att.cfg.maxLevel });
    const reach = rowsA.filter((r) => pvpDamage(m.power, r.atk * sa, defE, mult) > dmg);
    // same IVs, higher level (still under the cap)
    let levelUp: number | null = null;
    for (const L of LEVELS) {
      if (L <= a.level || L > att.cfg.maxLevel) continue;
      if (cp(a.pokemon, data.settings, L, a.ivs) > att.cap) break;
      if (pvpDamage(m.power, stats(a.pokemon, data.settings, L, a.ivs).atk * sa, defE, mult) > dmg) { levelUp = L; break; }
    }
    // defender bulkpoint: damage − 1 when def > K / (dmg − 1), K = 0.5 × power × mult × pvpBonus × atk
    const K = 0.5 * m.power * mult * combat.pvpBonus * atkE;
    const needDef = dmg > 1 ? K / (dmg - 1) / sd : null;
    const rowsD = rankPvpIvs(def.p, data.settings, { cap: def.cap, maxLevel: def.cfg.maxLevel });
    const bulk = dmg > 1 ? rowsD.filter((r) => pvpDamage(m.power, atkE, r.def * sd, mult) < dmg) : [];
    const worse = rowsD.filter((r) => pvpDamage(m.power, atkE, r.def * sd, mult) > dmg).length;
    return { m, dmg, needAtk, reach, rowsA, levelUp, needDef, bulk, rowsD, worse, a, d };
  }, [att, def, data]);
  if (!info) return <div className="bp-box"><span className="faint">—</span></div>;
  const { m, dmg, needAtk, reach, rowsA, levelUp, needDef, bulk, rowsD, worse, a, d } = info;
  const an = displayName(a.pokemon, a.shadow), dn = displayName(d.pokemon, d.shadow);
  const best = reach[0];
  const bestBulk = bulk[0];
  return (
    <div className="bp-box">
      <h3><span className={`side-dot ${label}`} />{an} → {dn}</h3>
      <div><PvpMove id={m.id} link={false} /> does <b className="num">{dmg}</b> damage <span className="faint small">({m.turns} turn{m.turns > 1 ? 's' : ''}, {(dmg / m.turns).toFixed(1)}/turn)</span></div>
      <div className="divider" style={{ margin: '4px 0' }} />
      <div className="small"><b>Breakpoint ({dmg + 1} dmg):</b> {an} needs Attack ≥ <span className="num bold">{needAtk.toFixed(2)}</span> <span className="faint">(now {a.atk.toFixed(2)})</span></div>
      <div className="small muted">
        {levelUp ? <>Same IVs reach it at <b>level {levelUp}</b>. </> : null}
        {reach.length === 0 ? 'No IV spread reaches it under this cap.' : reach.length === rowsA.length ? 'Every IV spread already reaches it.' :
          <>{reach.length.toLocaleString()} of {rowsA.length.toLocaleString()} IV spreads reach it — best ranked: <b className="num">#{best.rank} {best.ivs.join('/')}</b> (L{best.level}, {best.pct.toFixed(1)}%).</>}
      </div>
      <div className="small" style={{ marginTop: 4 }}><b>Bulkpoint ({Math.max(1, dmg - 1)} dmg):</b> {dmg <= 1 ? 'already minimum damage.' : <>{dn} needs Defense ≥ <span className="num bold">{needDef!.toFixed(2)}</span> <span className="faint">(now {d.def.toFixed(2)})</span></>}</div>
      {dmg > 1 && (
        <div className="small muted">
          {bulk.length === 0 ? 'No IV spread reaches it under this cap.' : <>{bulk.length.toLocaleString()} of {rowsD.length.toLocaleString()} spreads take less — best ranked: <b className="num">#{bestBulk.rank} {bestBulk.ivs.join('/')}</b> (L{bestBulk.level}).</>}
          {worse > 0 && <> {worse.toLocaleString()} spreads would take {dmg + 1}+.</>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- explainer
function HowItWorks() {
  return (
    <Card title="How the simulator works">
      <details>
        <summary className="small muted">Mechanics, AI and known simplifications</summary>
        <ul className="small muted" style={{ marginTop: 10, paddingLeft: 18, display: 'grid', gap: 4 }}>
          <li>Battles run in 0.5 s turns. Fast moves take their listed turns; damage and energy land on the final turn. Fast moves landing on the same turn are simultaneous.</li>
          <li>Damage = ⌊0.5 × power × Attack ÷ Defense × STAB (1.2) × type effectiveness × 1.3⌋ + 1, with shadow (×1.2 Atk, ×0.833 Def) and stat stages (−4…+4) applied.</li>
          <li>When a charged move is thrown, the opponent’s fast move that was already in progress lands first. If both throw on the same turn, the higher Attack stat goes first (Charge Move Priority); exact ties alternate starting with side A.</li>
          <li>Shields block all but 1 damage; buffs and debuffs still apply. Energy caps at 100. Mimikyu’s Disguise blocks the first charged move it takes (optional).</li>
          <li>Charged-move AI: take a KO when available → bait with the cheapest move while the opponent would shield it → when about to faint, fire the strongest move → otherwise wait for the move with the best damage per energy. There is no look-ahead or energy stacking, and other form changes (Aegislash, Cramorant, Morpeko) aren’t modelled, so close results can differ from PvPoke.</li>
          <li>Battle rating = 500 × (damage dealt ÷ opponent HP) + 500 × (HP left ÷ own HP). 500 is even; above 500 is a win.</li>
        </ul>
      </details>
    </Card>
  );
}
