import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, Countdown, Empty, Mon, MoveTag, PageHeader, Rank, Segmented, Spinner, Tabs, TypeBadge, useShowMore } from '../../components/ui';
import { displayName, useData } from '../../lib/data';
import { dateRange, fmt } from '../../lib/format';
import { eventDate, eventStatus, useLive, type LiveEvent } from '../../lib/live';
import { stats, TYPES } from '../../lib/pogo';
import { neutralMovesetStats, type CounterResult } from '../../lib/pve';
import { useStored } from '../../lib/storage';
import type { MaxMoveCost, PokeType, Pokemon } from '../../lib/types';
import { FeedStatus } from './liveUtils';
import './live.css';

/**
 * G-Max Move each Gigantamax species uses — the main-series assignments (community-known);
 * ids are the matching VN_BM_* entries in moves.json.
 */
const GMAX_MOVES: Record<string, [string, string]> = {
  VENUSAUR: ['VN_BM_045', 'G-Max Vine Lash'], CHARIZARD: ['VN_BM_019', 'G-Max Wildfire'], BLASTOISE: ['VN_BM_046', 'G-Max Cannonade'],
  BUTTERFREE: ['VN_BM_020', 'G-Max Befuddle'], PIKACHU: ['VN_BM_021', 'G-Max Volt Crash'], MEOWTH: ['VN_BM_022', 'G-Max Gold Rush'],
  MACHAMP: ['VN_BM_023', 'G-Max Chi Strike'], GENGAR: ['VN_BM_024', 'G-Max Terror'], KINGLER: ['VN_BM_025', 'G-Max Foam Burst'],
  LAPRAS: ['VN_BM_026', 'G-Max Resonance'], SNORLAX: ['VN_BM_028', 'G-Max Replenish'], GARBODOR: ['VN_BM_029', 'G-Max Malodor'],
  RILLABOOM: ['VN_BM_047', 'G-Max Drum Solo'], CINDERACE: ['VN_BM_048', 'G-Max Fireball'], INTELEON: ['VN_BM_049', 'G-Max Hydrosnipe'],
  TOXTRICITY: ['VN_BM_038', 'G-Max Stun Shock'], GRIMMSNARL: ['VN_BM_041', 'G-Max Snooze'], URSHIFU_RAPID_STRIKE: ['VN_BM_051', 'G-Max Rapid Flow'],
};

type Tab = 'overview' | 'moves' | 'pokemon' | 'attackers';
const isMaxEvent = (e: LiveEvent) => e.eventType.startsWith('max-') || /dynamax|gigantamax|max battle|max monday|eternamax/i.test(e.name);

export default function MaxBattles() {
  const data = useData();
  const [tab, setTab] = useStored<Tab>('max.tab', 'overview');
  const dmaxCount = data.pokemon.filter((p) => p.dmax && !p.megaOf).length;
  const gmaxCount = data.pokemon.filter((p) => p.gmax).length;
  return (
    <div>
      <PageHeader title="Max Battles" subtitle={`Dynamax & Gigantamax: how Max Battles work, every Max Move, upgrade costs, the ${dmaxCount} Dynamax and ${gmaxCount} Gigantamax Pokémon in the game files, and the best picks to bring.`} />
      <Tabs value={tab} onChange={setTab} tabs={[
        { id: 'overview', label: 'Overview' }, { id: 'moves', label: 'Max Moves & costs' },
        { id: 'pokemon', label: 'Dynamax Pokémon' }, { id: 'attackers', label: 'Best attackers & tanks' },
      ]} />
      {tab === 'overview' && <Overview />}
      {tab === 'moves' && <MovesTab />}
      {tab === 'pokemon' && <PokemonTab />}
      {tab === 'attackers' && <AttackersTab />}
    </div>
  );
}

// ---------------------------------------------------------------- overview
function Overview() {
  const { reference } = useData();
  const feed = useLive('events');
  const now = Date.now();
  const maxEvents = (feed.data || []).filter(isMaxEvent).filter((e) => eventStatus(e, now) !== 'ended')
    .sort((a, b) => (eventDate(a.start)?.getTime() ?? 0) - (eventDate(b.start)?.getTime() ?? 0));
  const mushroom = reference.items.find((i) => /max mushroom/i.test(i.name));
  const steps = [
    { ico: '📍', t: 'Power Spots', d: 'Max Battles take place at Power Spots on the map. Visit them to battle the Dynamax Pokémon they host.' },
    { ico: '✨', t: 'Max Particles (MP)', d: 'Collected from Power Spots and by exploring. MP is spent to join Max Battles and to unlock and level up Max Moves.' },
    { ico: '👥', t: 'Teams', d: 'Each Trainer brings up to three Dynamax or Gigantamax Pokémon. Most Max Battles are for small groups of up to four Trainers; Gigantamax battles allow much larger groups.' },
    { ico: '📈', t: 'Max Meter', d: 'Fills as you battle. When it is full, your Pokémon Dynamaxes for a short Max Phase in which you choose Max Moves instead of normal attacks.' },
    { ico: '💥', t: 'Max Attack', d: 'Deals heavy damage. Its type follows your Pokémon’s fast move (e.g. a Fire fast move → Max Flare). Gigantamax Pokémon use their signature G-Max Move.' },
    { ico: '🛡️', t: 'Max Guard', d: 'Adds a protective shield that absorbs incoming damage — the key move for tanks.' },
    { ico: '💚', t: 'Max Spirit', d: 'Restores HP to your whole team.' },
    { ico: '⭐', t: 'Battle tiers', d: 'Dynamax battles range from 1★ to 5★; Gigantamax battles are the hardest (6★). Defeat the boss to earn a chance to catch it.' },
    ...(mushroom ? [{ ico: '🍄', t: mushroom.name, d: mushroom.desc }] : []),
  ];
  return (
    <div className="stack">
      <Card title="Upcoming & live Max events" actions={<FeedStatus {...feed} what="events" />}>
        {!feed.data && feed.loading ? <Spinner /> : maxEvents.length ? (
          <ul className="list-plain">
            {maxEvents.map((e) => {
              const st = eventStatus(e, now);
              const s = eventDate(e.start), en = eventDate(e.end);
              return (
                <li key={e.eventID + e.start} className="row" style={{ padding: '8px 0', gap: 12 }}>
                  {e.image && <img src={e.image} alt="" width={84} height={40} loading="lazy" style={{ objectFit: 'cover', borderRadius: 8, flex: 'none' }} />}
                  <div className="col" style={{ gap: 1, flex: 1, minWidth: 180 }}>
                    <a href={e.link} target="_blank" rel="noopener noreferrer" className="bold" style={{ color: 'var(--text)' }}>{e.name}</a>
                    <span className="small faint">{dateRange(s, en)}</span>
                  </div>
                  {st === 'live' ? <span className="badge live">LIVE{en ? <> · <Countdown to={en} /> left</> : null}</span>
                    : s ? <span className="badge accent">in <Countdown to={s} /></span> : null}
                </li>
              );
            })}
          </ul>
        ) : <div className="faint small">No Max Battle events announced in the current feed.</div>}
        <p className="small muted" style={{ marginTop: 8, marginBottom: 0 }}>Max Mondays feature a spotlighted Dynamax Pokémon at Power Spots for most of the day each Monday — check <Link to="/events">Events</Link> for the full calendar.</p>
      </Card>
      <Card title="How Max Battles work">
        <div className="mx-steps">
          {steps.map((s) => (
            <div key={s.t} className="mx-step"><span className="ico" aria-hidden>{s.ico}</span><div><h4>{s.t}</h4><p>{s.d}</p></div></div>
          ))}
        </div>
        <div className="callout" style={{ marginTop: 14 }}>
          <b>Team tip:</b> a balanced team pairs a hard-hitting attacker (high Attack, fast move of the boss’s weakness) with a bulky tank running Max Guard, and someone ready to use Max Spirit when HP runs low.
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- moves & costs
function MovesTab() {
  const data = useData();
  const special = Object.values(data.moves).filter((m) => m.max && /behemoth|dynamax cannon/i.test(m.name));
  const gmaxList = data.pokemon.filter((p) => p.gmax).map((p) => ({ p, mv: GMAX_MOVES[p.id] || GMAX_MOVES[p.speciesId] })).filter((x) => x.mv);
  return (
    <div className="stack">
      <Card title="Max Moves by type" footer="A Dynamax Pokémon’s Max Attack takes the type of its fast move.">
        <div className="mx-moves">
          {data.settings.maxMoves.map((m) => (
            <div key={m.id} className="mx-move" style={{ ['--tc' as string]: `var(--t-${m.type})` }}>
              <TypeBadge type={m.type} small /><span className="nm">{m.name}</span>
            </div>
          ))}
        </div>
      </Card>
      {gmaxList.length > 0 && (
        <Card title="G-Max Moves" footer="Signature moves of Gigantamax Pokémon (main-series assignments). G-Max Moves are stronger than regular Max Moves.">
          <div className="mx-moves">
            {gmaxList.map(({ p, mv }) => {
              const move = data.moves[mv[0]];
              return (
                <div key={p.id} className="mx-move" style={{ ['--tc' as string]: `var(--t-${move?.type || p.types[0]})` }}>
                  <Mon p={p} size={30} sub={<span>{mv[1]}{move ? <> · <span style={{ textTransform: 'capitalize' }}>{move.type}</span></> : null}</span>} />
                </div>
              );
            })}
          </div>
        </Card>
      )}
      {special.length > 0 && (
        <Card title="Special Max Moves">
          <div className="mx-moves">{special.map((m) => <div key={m.id} className="mx-move" style={{ ['--tc' as string]: `var(--t-${m.type})` }}><TypeBadge type={m.type} small /><span className="nm">{m.name}</span></div>)}</div>
          <p className="small faint" style={{ marginBottom: 0, marginTop: 8 }}>Zacian, Zamazenta and Eternatus have their own Max Moves in the game files.</p>
        </Card>
      )}
      <UpgradeCosts />
    </div>
  );
}

const GROUP_NAMES: Record<string, string> = { '1': 'Group 1', '2': 'Group 2', '3': 'Group 3', '4': 'Group 4', '8': 'Eternatus', Z: 'Zacian & Zamazenta' };

function costText(c: MaxMoveCost & { stardustCost?: number }, isDefault: boolean) {
  if (isDefault) return <span className="faint">Unlocked</span>;
  const parts: string[] = [];
  if (c.mpCost) parts.push(`${fmt(c.mpCost)} MP`);
  if (c.candyCost) parts.push(`${fmt(c.candyCost)} Candy`);
  if (c.xlCandyCost) parts.push(`${fmt(c.xlCandyCost)} XL`);
  if (c.stardustCost) parts.push(`${fmt(c.stardustCost)} Dust`);
  return <span className="num">{parts.join(' + ') || '—'}</span>;
}

function UpgradeCosts() {
  const data = useData();
  const groups = Object.keys(data.settings.maxMoveLevels).sort((a, b) => (Number(a) || 50) - (Number(b) || 50));
  const [g, setG] = useState(groups[0] || '1');
  const lv = data.settings.maxMoveLevels[g];
  const members = data.pokemon.filter((p) => p.maxGroup === g && (p.dmax || p.gmax) && !p.megaOf);
  const kinds = [['attack', 'Max Attack'], ['guard', 'Max Guard'], ['spirit', 'Max Spirit']] as const;
  return (
    <Card title="Max Move upgrade costs" actions={<Segmented size="sm" value={g} onChange={setG} options={groups.map((x) => ({ id: x, label: GROUP_NAMES[x] || `Group ${x}` }))} />}
      footer="Max Attack starts at level 1 for every Dynamax Pokémon; Max Guard and Max Spirit must be unlocked first. Costs vary by Pokémon cost group.">
      {lv ? (
        <div className="table-wrap">
          <table className="table compact mx-cost">
            <thead><tr><th>Level</th>{kinds.map(([, n]) => <th key={n}>{n}</th>)}</tr></thead>
            <tbody>
              {[0, 1, 2].map((i) => (
                <tr key={i}>
                  <td className="bold">Level {i + 1}</td>
                  {kinds.map(([k]) => {
                    const c = lv[k][i] as (MaxMoveCost & { stardustCost?: number }) | undefined;
                    // Level-1 Max Attack is granted by default; the game master stores a 1 MP / 1 candy placeholder for it.
                    const isDefault = k === 'attack' && i === 0 && (c?.candyCost ?? 0) <= 1 && (c?.mpCost ?? 0) <= 1;
                    return <td key={k}>{c ? costText(c, isDefault) : '—'}{c?.xpReward ? <div className="tiny faint">+{fmt(c.xpReward)} XP</div> : null}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <Empty>No cost data.</Empty>}
      {members.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div className="subhead">{members.length} Dynamax Pokémon in this group</div>
          <div className="row small" style={{ gap: '4px 10px' }}>
            {members.slice(0, 40).map((p) => <Link key={p.id} to={`/dex/${p.id}`}>{displayName(p)}</Link>)}
            {members.length > 40 && <span className="faint">+{members.length - 40} more</span>}
          </div>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- Pokémon list
function PokemonTab() {
  const data = useData();
  const [f, setF] = useState<'all' | 'dmax' | 'gmax'>('all');
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return data.pokemon.filter((p) => !p.megaOf && (f === 'all' ? p.dmax || p.gmax : f === 'dmax' ? p.dmax : p.gmax) && (!s || displayName(p).toLowerCase().includes(s) || p.types.includes(s as PokeType)))
      .sort((a, b) => a.dex - b.dex);
  }, [data.pokemon, f, q]);
  const { visible, more } = useShowMore(list, 60);
  return (
    <Card title={`${list.length} Pokémon`} actions={<Segmented size="sm" value={f} onChange={setF} options={[{ id: 'all', label: 'All' }, { id: 'dmax', label: 'Dynamax' }, { id: 'gmax', label: 'Gigantamax' }]} />}
      footer="Based on Dynamax / Gigantamax data in the game files — not every entry is obtainable yet; availability comes with Max Battle rotations and events.">
      <input className="input" placeholder="Search name or type…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search Dynamax Pokémon" style={{ marginBottom: 12, maxWidth: 320 }} />
      {list.length ? (
        <div className="reward-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
          {visible.map((p) => (
            <div key={p.id} className="reward-tile">
              <Mon p={p} size={40} showTypes />
              <span className="col" style={{ marginLeft: 'auto', gap: 3, alignItems: 'flex-end' }}>
                {p.dmax && <span className="badge" style={{ background: 'rgba(233,61,130,0.16)', color: '#e93d82' }}>Dynamax</span>}
                {p.gmax && <span className="badge" style={{ background: 'rgba(214,64,159,0.2)', color: '#d6409f' }}>G-Max</span>}
                {p.maxGroup && <span className="tiny faint" title="Max Move upgrade cost group">Cost {GROUP_NAMES[p.maxGroup] || p.maxGroup}</span>}
              </span>
            </div>
          ))}
        </div>
      ) : <Empty>No Pokémon match.</Empty>}
      {more}
    </Card>
  );
}

// ---------------------------------------------------------------- attackers & tanks
function AttackersTab() {
  const data = useData();
  const candidates = useMemo(() => data.pokemon.filter((p) => (p.dmax || p.gmax) && !p.megaOf && p.released), [data.pokemon]);
  // Every moveset of every candidate vs a neutral boss (computed once).
  const evals = useMemo(() => candidates.map((p) => ({ p, sets: neutralMovesetStats(data, p, false, 40) })), [candidates, data]);
  const byType = useMemo(() => {
    const out = new Map<PokeType, { p: Pokemon; best: CounterResult }[]>();
    for (const t of TYPES) {
      const rows: { p: Pokemon; best: CounterResult }[] = [];
      for (const { p, sets } of evals) {
        let best: CounterResult | null = null;
        for (const s of sets) if (s.fast.type === t && (!best || s.dps > best.dps)) best = s;
        if (best) rows.push({ p, best });
      }
      rows.sort((a, b) => b.best.dps - a.best.dps);
      if (rows.length) out.set(t, rows);
    }
    return out;
  }, [evals]);
  const available = TYPES.filter((t) => byType.has(t));
  const [type, setType] = useState<PokeType>(available.includes('fighting') ? 'fighting' : available[0]);
  const rows = byType.get(type) || [];
  const maxMove = data.settings.maxMoves.find((m) => m.type === type);

  const tanks = useMemo(() => candidates.map((p) => { const s = stats(p, data.settings, 40); return { p, def: s.def, hp: s.hp, bulk: s.def * s.hp }; })
    .sort((a, b) => b.bulk - a.bulk).slice(0, 15), [candidates, data.settings]);

  return (
    <div className="stack">
      <Card title="Best Dynamax attackers by type" footer="Neutral DPS of the best moveset whose fast move matches the type (that fast move decides the Max Move type), level 40, 15/15/15. Attack also drives Max Move damage.">
        <div className="type-pick" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }} role="group" aria-label="Max Move type">
          {available.map((t) => (
            <button key={t} type="button" onClick={() => setType(t)} aria-pressed={type === t}
              style={{ border: `2px solid ${type === t ? 'var(--text)' : 'transparent'}`, borderRadius: 99, padding: 0, background: 'none', cursor: 'pointer', opacity: type === t ? 1 : 0.6 }}>
              <TypeBadge type={t} small />
            </button>
          ))}
        </div>
        {maxMove && <div className="small muted" style={{ marginBottom: 8 }}>Max Attack: <b>{maxMove.name}</b> · {rows.length} Dynamax Pokémon with a {type} fast move</div>}
        {rows.length ? <AttackerTable rows={rows} /> : <Empty>No Dynamax Pokémon with a {type} fast move.</Empty>}
      </Card>
      <Card title="Best tanks (Max Guard / Max Spirit)" footer="Ranked by Defense × HP at level 40 with 15/15/15 IVs. Resistances to the boss’s moves matter just as much — check its weaknesses on the Pokédex." flush>
        <div className="table-wrap">
          <table className="table compact">
            <thead><tr><th className="num">#</th><th>Pokémon</th><th className="num">Def</th><th className="num">HP</th><th className="num">Bulk</th></tr></thead>
            <tbody>
              {tanks.map((t, i) => (
                <tr key={t.p.id}>
                  <td className="num"><Rank n={i + 1} /></td>
                  <td><Mon p={t.p} size={30} showTypes />{t.p.gmax && <span className="badge" style={{ marginLeft: 6, background: 'rgba(214,64,159,0.2)', color: '#d6409f' }}>G-Max</span>}</td>
                  <td className="num">{fmt(t.def, 1)}</td>
                  <td className="num">{fmt(t.hp)}</td>
                  <td className="num bold">{fmt(t.bulk / 1000, 1)}k</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function AttackerTable({ rows }: { rows: { p: Pokemon; best: CounterResult }[] }) {
  const { settings } = useData();
  const { visible, more } = useShowMore(rows, 10);
  const top = rows[0]?.best.dps || 1;
  return (
    <>
      <div className="table-wrap">
        <table className="table compact">
          <thead><tr><th className="num">#</th><th>Pokémon</th><th>Moveset</th><th className="num">DPS</th><th className="num hide-mobile">Atk</th><th className="num hide-mobile">%</th></tr></thead>
          <tbody>
            {visible.map(({ p, best }, i) => (
              <tr key={p.id}>
                <td className="num"><Rank n={i + 1} /></td>
                <td><Mon p={p} size={30} showTypes /></td>
                <td><div className="ctr-moves" style={{ display: 'flex', flexDirection: 'column', fontSize: '0.85rem' }}>
                  <MoveTag id={best.fast.id} elite={p.eliteFast.includes(best.fast.id)} />
                  <MoveTag id={best.charged.id} elite={p.eliteCharged.includes(best.charged.id)} />
                </div></td>
                <td className="num bold">{fmt(best.dps, 2)}</td>
                <td className="num hide-mobile">{fmt(stats(p, settings, 40).atk, 1)}</td>
                <td className="num hide-mobile">{fmt((best.dps / top) * 100)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {more}
    </>
  );
}
