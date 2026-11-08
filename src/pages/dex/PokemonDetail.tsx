import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Card, Empty, IvBars, MoveTag, MultChip, PokeImg, Rank, Segmented, StatBar, StatTile, Types, useSort } from '../../components/ui';
import { displayName, isElite, movePool, useData, useRankings } from '../../lib/data';
import { fmt } from '../../lib/format';
import { cp, cpRange, defensiveProfile, ENCOUNTERS, hp, LEAGUES, rankPvpIvs, weatherFor, WEATHERS } from '../../lib/pogo';
import { neutralMovesetStats } from '../../lib/pve';
import { DEX_FLAGS, useCollection } from '../../lib/storage';
import type { Evolution, Move, Pokemon } from '../../lib/types';
import './dex.css';

const GEN_NAMES = ['', 'Kanto', 'Johto', 'Hoenn', 'Sinnoh', 'Unova', 'Kalos', 'Alola', 'Galar', 'Paldea'];

export default function PokemonDetail() {
  const { id = '' } = useParams();
  const data = useData();
  const p = data.byId[id] || data.byId[id.toUpperCase()];
  if (!p) return <Empty icon="❓">No Pokémon with id “{id}”. <Link to="/dex">Back to Pokédex</Link></Empty>;
  return <Detail key={p.id} p={p} />;
}

function Detail({ p }: { p: Pokemon }) {
  const data = useData();
  const { settings } = data;
  const [shiny, setShiny] = useState(false);
  useEffect(() => { document.title = `${displayName(p)} · PoGo Companion`; }, [p]);
  const forms = data.pokemon.filter((x) => x.dex === p.dex && (x.released || x.id === p.id || !p.released));
  const base = p.megaOf ? data.byId[p.megaOf] : p;
  const total = p.atk + p.def + p.sta;
  const MAX = useMemo(() => ({ atk: Math.max(...data.pokemon.map((x) => x.atk)), def: Math.max(...data.pokemon.map((x) => x.def)), sta: Math.max(...data.pokemon.map((x) => x.sta)) }), [data.pokemon]);

  return (
    <div className="stack">
      {/* ---------------- hero ---------------- */}
      <Card>
        <div className="dex-hero" style={{ ['--tc' as string]: `var(--t-${p.types[0]})` }}>
          <div className="dex-hero-art">
            <PokeImg p={p} shiny={shiny} size={170} />
            <button className={`btn sm shiny-toggle ${shiny ? 'primary' : ''}`} onClick={() => setShiny((s) => !s)} title="Toggle shiny sprite">✦ Shiny</button>
          </div>
          <div className="col" style={{ gap: 6 }}>
            <div className="faint num">#{String(p.dex).padStart(4, '0')} · Gen {p.gen} ({GEN_NAMES[p.gen]})</div>
            <h1>{displayName(p)}</h1>
            {p.category && <div className="dex-sub">{p.category}</div>}
            <div className="row" style={{ gap: 6 }}>
              <Types types={p.types} />
              {p.class === 'legendary' && <span className="badge warn">Legendary</span>}
              {p.class === 'mythical' && <span className="badge purple">Mythical</span>}
              {p.class === 'ultra_beast' && <span className="badge accent">Ultra Beast</span>}
              {p.megaOf && <span className="badge bad">{p.form === 'PRIMAL' ? 'Primal Reversion' : 'Mega Evolution'}</span>}
              {p.shadowReleased && <span className="badge purple">Shadow available</span>}
              {p.dmax && <span className="badge bad">Dynamax</span>}
              {p.gmax && <span className="badge bad">Gigantamax</span>}
              {!p.released && <span className="badge">Not yet released</span>}
              {!p.tradable && <span className="badge">Untradable</span>}
            </div>
            {p.desc && <p className="muted" style={{ maxWidth: 680, marginTop: 6 }}>{p.desc}</p>}
            {forms.length > 1 && (
              <div className="form-switch">
                {forms.map((f) => (
                  <Link key={f.id} to={`/dex/${f.id}`} className={f.id === p.id ? 'on' : ''}><PokeImg p={f} size={24} />{f.formName || 'Normal'}</Link>
                ))}
              </div>
            )}
            <div className="row" style={{ marginTop: 8, gap: 6 }}>
              <Link className="btn sm" to={`/counters?boss=${p.id}`}>🛡️ Counters</Link>
              <Link className="btn sm" to={`/tools/iv?id=${p.id}`}>🧮 IV calc</Link>
              <Link className="btn sm" to={`/tools/cp?id=${p.id}`}>📈 CP chart</Link>
              <Link className="btn sm" to={`/pvp/ivs?id=${p.id}&league=great`}>📊 PvP IVs</Link>
              <Link className="btn sm" to={`/pvp/sim?a=${p.id}`}>🥊 Simulate</Link>
            </div>
          </div>
        </div>
      </Card>

      <CollectionFlags p={p} />

      <div className="grid grid-2">
        {/* ---------------- stats ---------------- */}
        <Card title="Base stats">
          <div className="col" style={{ gap: 8 }}>
            <StatBar label="Attack" value={p.atk} max={MAX.atk} color="#f2555a" />
            <StatBar label="Defense" value={p.def} max={MAX.def} color="#4f8ef7" />
            <StatBar label="Stamina" value={p.sta} max={MAX.sta} color="#3ccf8e" />
            <div className="faint small">Total {total}</div>
          </div>
          <div className="grid grid-3" style={{ marginTop: 14, gap: 8 }}>
            <StatTile label="Max CP L40" value={fmt(cp(p, settings, 40))} sub={`${hp(p, settings, 40)} HP`} />
            <StatTile label="Max CP L50" value={fmt(cp(p, settings, 50))} sub={`${hp(p, settings, 50)} HP`} />
            <StatTile label="Best buddy L51" value={fmt(cp(p, settings, 51))} sub={`${hp(p, settings, 51)} HP`} />
          </div>
        </Card>

        {/* ---------------- type matchups ---------------- */}
        <TypeMatchups p={p} />
      </div>

      <div className="grid grid-2">
        <CatchCp p={p} />
        <Info p={p} base={base} />
      </div>

      <Evolutions p={p} />
      <PveMovesets p={p} />
      <PvpSection p={p} />
      <MoveLists p={p} />
    </div>
  );
}

// ---------------------------------------------------------------- collection flags
function CollectionFlags({ p }: { p: Pokemon }) {
  const { collection, toggle } = useCollection();
  const e = collection[p.id] || {};
  return (
    <div className="row" style={{ gap: 6 }}>
      <span className="small faint" style={{ marginRight: 4 }}>My collection:</span>
      {DEX_FLAGS.filter((f) => (f.key !== 'shadow' && f.key !== 'purified') || p.shadowReleased).filter((f) => (f.key !== 'dynamax' || p.dmax) && (f.key !== 'gigantamax' || p.gmax)).map((f) => (
        <button key={f.key} className={`flag-btn ${e[f.key] ? 'on' : ''}`} style={e[f.key] ? { background: f.color } : undefined} onClick={() => toggle(p.id, f.key)}>
          {e[f.key] ? '✓ ' : ''}{f.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- type matchups
function TypeMatchups({ p }: { p: Pokemon }) {
  const { types, settings } = useData();
  const prof = defensiveProfile(types, p.types);
  const weak = prof.filter((x) => x.mult > 1.01).sort((a, b) => b.mult - a.mult);
  const resist = prof.filter((x) => x.mult < 0.99).sort((a, b) => a.mult - b.mult);
  const boosted = [...new Set(p.types.map((t) => weatherFor(settings, t)).filter(Boolean))] as string[];
  return (
    <Card title="Type matchups (defending)">
      <div className="field-label" style={{ marginBottom: 6 }}>Weak to</div>
      <div className="weak-grid">{weak.map((w) => <div key={w.type} className="weak-cell"><Types types={[w.type]} small /><MultChip m={w.mult} /></div>)}</div>
      <div className="field-label" style={{ margin: '14px 0 6px' }}>Resists</div>
      <div className="weak-grid">{resist.map((w) => <div key={w.type} className="weak-cell"><Types types={[w.type]} small /><MultChip m={w.mult} /></div>)}</div>
      <div className="small muted" style={{ marginTop: 14 }}>
        Weather boosted in: {boosted.map((w) => { const x = WEATHERS.find((y) => y.id === w || (w === 'cloudy' && y.id === 'overcast')); return x ? `${x.icon} ${x.name}` : w; }).join(', ')}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- catch CP
function CatchCp({ p }: { p: Pokemon }) {
  const { settings } = useData();
  const rows = [
    { label: 'Raid / Max Battle catch', lvl: ENCOUNTERS.raid.level, boosted: ENCOUNTERS.raid.boosted, floor: 10 },
    { label: 'Field research', lvl: ENCOUNTERS.research.level, boosted: null, floor: 10 },
    { label: 'Egg hatch', lvl: ENCOUNTERS.egg.level, boosted: null, floor: 10 },
    { label: 'Rocket (shadow) catch', lvl: ENCOUNTERS.rocket.level, boosted: ENCOUNTERS.rocket.boosted, floor: 0 },
    { label: 'Wild max (L30 / boosted L35)', lvl: 30, boosted: 35, floor: 0 },
  ];
  return (
    <Card title="Encounter CP reference" footer="Ranges show the IV floor → 100% (15/15/15). The 100% CP is the “hundo” number to look for.">
      <div className="table-wrap">
        <table className="table compact">
          <thead><tr><th>Source</th><th className="num">Level</th><th className="num">CP range</th><th className="num">Boosted</th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const n = cpRange(p, settings, r.lvl, r.floor);
              const b = r.boosted ? cpRange(p, settings, r.boosted, r.label.startsWith('Wild') ? 4 : r.floor) : null;
              return (
                <tr key={r.label}>
                  <td>{r.label}</td>
                  <td className="num faint">{r.lvl}{r.boosted ? ` / ${r.boosted}` : ''}</td>
                  <td className="num">{fmt(n.min)}–<b>{fmt(n.max)}</b></td>
                  <td className="num">{b ? <>{fmt(b.min)}–<b>{fmt(b.max)}</b></> : <span className="faint">—</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- info
function Info({ p, base }: { p: Pokemon; base: Pokemon }) {
  const { settings } = useData();
  const lvl = (settings.maxMoveLevels && p.maxGroup) ? p.maxGroup : null;
  const items: [string, React.ReactNode][] = [
    ['Buddy distance', `${p.buddyKm} km per candy`],
    ['Buddy size', p.buddySize ? p.buddySize.replace(/_/g, ' ') : 'Medium'],
    ['Evolve cost', p.candyToEvolve ? `${p.candyToEvolve} candy` : '—'],
    ['2nd charged move', p.thirdMove ? `${fmt(p.thirdMove.dust)} dust + ${p.thirdMove.candy} candy` : '—'],
    ['Purification', p.purify && p.shadowReleased ? `${fmt(p.purify.dust)} dust + ${p.purify.candy} candy` : '—'],
    ['Catch bonus', p.bonusCandy || p.bonusXl ? `+${p.bonusCandy} candy${p.bonusXl ? `, +${p.bonusXl} XL` : ''} (raids/special)` : '—'],
    ['Height / weight', `${p.height} m · ${p.weight} kg`],
  ];
  if (p.size) items.push(['XXS / XXL height', `≤ ${p.size.xs.toFixed(2)} m / ≥ ${p.size.xl.toFixed(2)} m`]);
  if (p.captureRate != null) items.push(['Base capture rate', `${Math.round(p.captureRate * 100)}%`]);
  if (p.fleeRate != null) items.push(['Base flee rate', `${Math.round(p.fleeRate * 100)}%`]);
  if (p.megaEnergy) items.push(['Mega Energy', `${fmt(p.megaEnergy.first)} first · ${fmt(p.megaEnergy.after)} after`]);
  if (base.megas?.length && !p.megaOf) items.push(['Mega forms', base.megas.length]);
  if (lvl) items.push(['Max Move cost group', `Group ${lvl}`]);
  items.push(['Tradable', p.tradable ? 'Yes' : 'No'], ['Transferable', p.transferable ? 'Yes' : 'No']);
  if (p.variants) items.push(['Cosmetic variants', `${p.variants} forms with identical stats`]);
  return (
    <Card title="Details">
      <div className="kv">{items.map(([k, v]) => <Fragment key={k}><span>{k}</span><span>{v}</span></Fragment>)}</div>
    </Card>
  );
}

// ---------------------------------------------------------------- evolutions
function evoReq(e: Evolution): string[] {
  const r: string[] = [];
  if (e.candy) r.push(`${e.candy} candy`);
  if (e.item) r.push(e.item + (e.itemCost ? ` ×${e.itemCost}` : ''));
  if (e.lure) r.push(e.lure);
  if (e.buddyKm) r.push(`walk ${e.buddyKm} km as buddy`);
  else if (e.mustBeBuddy) r.push('as buddy');
  if (e.time) r.push(e.time === 'Full moon' ? 'during a full moon' : `${e.time.toLowerCase()}time`);
  if (e.gender) r.push(`${e.gender} only`);
  if (e.upsideDown) r.push('phone upside-down');
  if (e.quest && !(e.buddyKm && /walk/i.test(e.quest))) r.push(e.quest);
  if (e.tradeFree) r.push('free if traded');
  return r;
}

function Evolutions({ p }: { p: Pokemon }) {
  const data = useData();
  const fam = data.family(p.family).filter((x) => x.released || !p.released || x.id === p.id);
  // Build tree from roots
  const roots = fam.filter((x) => !x.parentId || !fam.some((y) => y.id === x.parentId));
  const base = p.megaOf ? data.byId[p.megaOf] : p;
  const megas = (base.megas || []).map((m) => data.byId[m]).filter(Boolean);
  if (fam.length <= 1 && !megas.length) return null;
  const Node = ({ n }: { n: Pokemon }): JSX.Element => {
    const kids = (n.evolutions || []).map((e) => ({ e, t: data.byId[e.to] })).filter((x) => x.t && fam.includes(x.t));
    return (
      <div className="evo-chain">
        <Link to={`/dex/${n.id}`} className={`evo-node ${n.id === p.id ? 'on' : ''}`}><PokeImg p={n} size={56} /><span className="n">{displayName(n)}</span></Link>
        {kids.length > 0 && (
          <div className="evo-stage">
            {kids.map(({ e, t }) => (
              <div key={t.id} className="evo-chain">
                <div className="evo-arrow"><span className="arrow">→</span>{evoReq(e).map((r) => <span key={r}>{r}</span>)}</div>
                <Node n={t} />
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };
  return (
    <Card title="Evolution" footer={megas.length ? 'Mega Evolution costs Mega Energy (first / subsequent). Mega Pokémon boost same-type attacks of everyone in the raid.' : undefined}>
      <div className="col" style={{ gap: 12 }}>{roots.map((r) => <Node key={r.id} n={r} />)}</div>
      {megas.length > 0 && (
        <div className="row" style={{ marginTop: 14, gap: 8 }}>
          {megas.map((m) => (
            <Link key={m.id} to={`/dex/${m.id}`} className={`evo-node ${m.id === p.id ? 'on' : ''}`}>
              <PokeImg p={m} size={56} /><span className="n">{displayName(m)}</span>
              {m.megaEnergy && <span className="tiny faint">{fmt(m.megaEnergy.first)} / {fmt(m.megaEnergy.after)} energy</span>}
            </Link>
          ))}
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- PvE movesets
function PveMovesets({ p }: { p: Pokemon }) {
  const data = useData();
  const [shadow, setShadow] = useState(false);
  const [level, setLevel] = useState<40 | 50>(40);
  const rows = useMemo(() => neutralMovesetStats(data, p, shadow && p.shadowReleased, level), [data, p, shadow, level]);
  const top = rows[0]?.er || 1;
  const { sorted, th } = useSort(rows, { key: 'er', dir: -1 }, { dps: (r) => r.dps, tdo: (r) => r.tdo, er: (r) => r.er, fast: (r) => r.fast.name, charged: (r) => r.charged.name });
  return (
    <Card title="Raid & gym movesets" flush
      actions={<div className="row" style={{ gap: 6 }}>
        {p.shadowReleased && <Segmented size="sm" value={shadow ? 's' : 'n'} onChange={(v) => setShadow(v === 's')} options={[{ id: 'n', label: 'Normal' }, { id: 's', label: 'Shadow' }]} />}
        <Segmented size="sm" value={level} onChange={setLevel} options={[{ id: 40, label: 'L40' }, { id: 50, label: 'L50' }]} />
      </div>}
      footer="Neutral DPS/TDO against a generic Tier 5 boss (no type advantage). ER = (DPS³ × TDO)^¼ — the overall raid score. ★ = Elite TM / legacy move. Use Raid Counters for a specific boss.">
      <div className="table-wrap">
        <table className="table compact">
          <thead><tr><th>#</th>{th('fast', 'Fast move')}{th('charged', 'Charged move')}{th('dps', 'DPS', { num: true })}{th('tdo', 'TDO', { num: true })}{th('er', 'Score', { num: true })}</tr></thead>
          <tbody>
            {sorted.map((r, i) => (
              <tr key={r.fast.id + r.charged.id}>
                <td><Rank n={i + 1} /></td>
                <td><MoveTag id={r.fast.id} elite={isElite(p, r.fast.id)} /></td>
                <td><MoveTag id={r.charged.id} elite={isElite(p, r.charged.id)} /></td>
                <td className="num">{r.dps.toFixed(2)}</td>
                <td className="num">{fmt(r.tdo, 0)}</td>
                <td className="num"><b>{((r.er / top) * 100).toFixed(1)}%</b></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- PvP
function PvpSection({ p }: { p: Pokemon }) {
  const data = useData();
  const little = useRankings('little'), great = useRankings('great'), ultra = useRankings('ultra'), master = useRankings('master');
  const sets = { little, great, ultra, master };
  const [maxLevel, setMaxLevel] = useState<50 | 51>(50);
  const [shadow, setShadow] = useState(false);
  return (
    <Card title="Trainer Battles (PvP)"
      actions={<div className="row" style={{ gap: 6 }}>
        {p.shadowReleased && <Segmented size="sm" value={shadow ? 's' : 'n'} onChange={(v) => setShadow(v === 's')} options={[{ id: 'n', label: 'Normal' }, { id: 's', label: 'Shadow' }]} />}
        <Segmented size="sm" value={maxLevel} onChange={setMaxLevel} options={[{ id: 50, label: 'Max L50' }, { id: 51, label: 'L51 buddy' }]} />
      </div>}
      footer="Rankings & movesets from PvPoke. Rank-1 IVs maximise stat product under the CP cap.">
      <div className="grid grid-2" style={{ gap: 12 }}>
        {LEAGUES.map((L) => {
          const rows = sets[L.key].rows;
          const idx = rows ? rows.findIndex((r) => r.id === p.id && !!r.sh === shadow) : -1;
          const row = idx >= 0 ? rows![idx] : null;
          const maxCp = cp(p, data.settings, maxLevel);
          const eligible = L.cap >= 10000 || cp(p, data.settings, 1, [0, 0, 0]) <= L.cap;
          const ivs = eligible && L.cap < 10000 ? rankPvpIvs(p, data.settings, { cap: L.cap, maxLevel }) : null;
          const r1 = ivs?.[0];
          return (
            <div key={L.key} className="tile">
              <div className="row" style={{ marginBottom: 8 }}>
                <b style={{ flex: 1 }}>{L.name}</b>
                {row ? <span className="badge accent">#{idx + 1} · {row.s.toFixed(1)}</span> : rows ? <span className="badge">Unranked</span> : <span className="faint small">…</span>}
              </div>
              {row && (
                <div className="small" style={{ marginBottom: 8 }}>
                  <MoveTag id={row.m[0]} elite={isElite(p, row.m[0])} /> · {row.m.slice(1).map((m, i) => <Fragment key={m}>{i > 0 && ' · '}<MoveTag id={m} elite={isElite(p, m)} /></Fragment>)}
                </div>
              )}
              {!eligible ? <div className="small faint">Too strong for this league even at level 1.</div>
                : L.cap >= 10000 ? <div className="small muted">Max CP {fmt(maxCp)} (15/15/15, L{maxLevel})</div>
                  : r1 && (
                    <div className="row small" style={{ gap: 12 }}>
                      <span>Rank 1: <b className="num">{r1.ivs.join('/')}</b></span>
                      <IvBars ivs={r1.ivs} />
                      <span className="faint num">L{r1.level} · {r1.cp} CP</span>
                      {maxCp <= L.cap && <span className="badge warn">Can't reach cap</span>}
                    </div>
                  )}
              <div className="row" style={{ marginTop: 8, gap: 6 }}>
                {L.cap < 10000 && eligible && <Link className="btn sm" to={`/pvp/ivs?id=${p.id}&league=${L.key}`}>IV ranks</Link>}
                <Link className="btn sm" to={`/pvp/sim?a=${p.id}&league=${L.key}${shadow ? '&as=1' : ''}`}>Simulate</Link>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- move lists
function MoveLists({ p }: { p: Pokemon }) {
  const data = useData();
  const pool = movePool(p, true);
  const [mode, setMode] = useState<'pve' | 'pvp'>('pve');
  const list = (ids: string[]) => ids.map((id) => data.moves[id]).filter(Boolean) as Move[];
  const fast = list(pool.fast), charged = list(pool.charged);
  if (p.shadowReleased) {
    for (const id of ['FRUSTRATION', 'RETURN']) if (data.moves[id] && !charged.includes(data.moves[id])) charged.push(data.moves[id]);
  }
  const stab = (m: Move) => p.types.includes(m.type);
  const Table = ({ moves, fastMoves }: { moves: Move[]; fastMoves: boolean }) => (
    <div className="table-wrap">
      <table className="table compact">
        <thead><tr><th>Move</th><th>Type</th>
          {mode === 'pve'
            ? <><th className="num">Power</th><th className="num">Energy</th><th className="num">Time</th><th className="num">{fastMoves ? 'DPS' : 'DPE'}</th>{fastMoves && <th className="num">EPS</th>}</>
            : <><th className="num">Power</th><th className="num">Energy</th>{fastMoves ? <><th className="num">Turns</th><th className="num">DPT</th><th className="num">EPT</th></> : <><th className="num">DPE</th><th>Effect</th></>}</>}
        </tr></thead>
        <tbody>
          {moves.map((m) => {
            const mult = stab(m) ? 1.2 : 1;
            return (
              <tr key={m.id}>
                <td><MoveTag id={m.id} elite={isElite(p, m.id)} showType={false} />{stab(m) && <span className="badge" style={{ marginLeft: 6 }} title="Same-type attack bonus ×1.2">STAB</span>}{m.special === 'shadow' && <span className="badge purple" style={{ marginLeft: 6 }}>Shadow</span>}{m.special === 'purified' && <span className="badge accent" style={{ marginLeft: 6 }}>Purified</span>}</td>
                <td><Types types={[m.type]} small /></td>
                {mode === 'pve' && m.pve ? (
                  <>
                    <td className="num">{m.pve.power}</td><td className="num">{m.pve.energy}</td><td className="num">{(m.pve.duration / 1000).toFixed(1)}s</td>
                    <td className="num">{fastMoves ? ((m.pve.power * mult) / (m.pve.duration / 1000)).toFixed(2) : m.pve.energy ? ((m.pve.power * mult) / m.pve.energy).toFixed(2) : '—'}</td>
                    {fastMoves && <td className="num">{(m.pve.energy / (m.pve.duration / 1000)).toFixed(2)}</td>}
                  </>
                ) : mode === 'pvp' && m.pvp ? (
                  <>
                    <td className="num">{m.pvp.power}</td><td className="num">{m.pvp.energy}</td>
                    {fastMoves ? <><td className="num">{m.pvp.turns}</td><td className="num">{((m.pvp.power * mult) / m.pvp.turns).toFixed(2)}</td><td className="num">{(m.pvp.energy / m.pvp.turns).toFixed(2)}</td></>
                      : <><td className="num">{m.pvp.energy ? ((m.pvp.power * mult) / m.pvp.energy).toFixed(2) : '—'}</td><td className="small">{buffText(m)}</td></>}
                  </>
                ) : <td colSpan={5} className="faint">—</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
  return (
    <Card title="Moves" actions={<Segmented size="sm" value={mode} onChange={setMode} options={[{ id: 'pve', label: 'Raids & gyms' }, { id: 'pvp', label: 'Trainer battles' }]} />}
      footer="DPS/DPT include STAB. ★ = Elite TM / legacy. Shadow Pokémon know Frustration until purified (then Return).">
      <h3 style={{ marginBottom: 8 }}>Fast moves</h3>
      <Table moves={fast} fastMoves />
      <h3 style={{ margin: '16px 0 8px' }}>Charged moves</h3>
      <Table moves={charged} fastMoves={false} />
    </Card>
  );
}

export function buffText(m: Move): string {
  const b = m.pvp?.buffs;
  if (!b) return '';
  const parts: string[] = [];
  const f = (n: number, what: string) => n && parts.push(`${n > 0 ? '+' : ''}${n} ${what}`);
  f(b.selfAtk, 'Atk (self)'); f(b.selfDef, 'Def (self)'); f(b.oppAtk, 'Atk (opp)'); f(b.oppDef, 'Def (opp)');
  return `${parts.join(', ')}${b.chance < 1 ? ` · ${Math.round(b.chance * 1000) / 10}%` : ''}`;
}
