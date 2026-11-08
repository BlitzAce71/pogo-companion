import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, Empty, Mon, PageHeader, Spinner, TypeBadge, Types } from '../../components/ui';
import { useData } from '../../lib/data';
import { fmt } from '../../lib/format';
import { useLive, type LiveRocket, type LiveRocketMon, type Resolved } from '../../lib/live';
import { TYPES } from '../../lib/pogo';
import type { BattleOptions, CounterResult } from '../../lib/pve';
import { usePrefs } from '../../lib/storage';
import type { GameData, PokeType, Pokemon } from '../../lib/types';
import { cachedCounters, CompactCounters, optsKey, tierById, useQueued } from '../battle/counterUtils';
import { FeedStatus, JumpChips, LiveSprite, ShinyBadge, useResolver, WeaknessList } from './liveUtils';
import './live.css';

/** Well-known pre-battle lines typed grunts say (they reveal the lineup type). */
const QUOTES: Partial<Record<PokeType, string>> = {
  normal: 'Normal does not mean weak.',
  fire: 'Do you know how hot Pokémon fire breath can get?',
  water: 'These waters are treacherous!',
  grass: 'Don’t tangle with us!',
  electric: 'Get ready to be shocked!',
  ice: 'You’re gonna be frozen in your tracks.',
  fighting: 'This buff physique isn’t just for show!',
  poison: 'Coiled and ready to strike!',
  ground: 'You’ll be defeated into the ground!',
  flying: 'Battle against my Flying-type Pokémon!',
  psychic: 'Are you scared of psychics that use unseen power?',
  bug: 'Go, my super bug Pokémon!',
  rock: 'Let’s rock and roll!',
  ghost: 'Ke…ke…ke…ke…ke…ke!',
  dragon: 'ROAR! …How’d that sound?',
  dark: 'Wherever there is light, there is also shadow.',
  steel: 'You’re no match for my iron will!',
  fairy: 'Check out my cute Pokémon!',
};

const ROCKET_TIER = tierById('shadow3'); // Rocket Pokémon are shadows; rank vs a Shadow-tier-3-strength version

type Kind = 'boss' | 'leader' | 'grunt' | 'other';
const kindOf = (r: LiveRocket): Kind => (/boss/i.test(r.title) || /giovanni/i.test(r.name) ? 'boss' : /leader/i.test(r.title) ? 'leader' : r.type ? 'grunt' : 'other');

export default function Rocket() {
  const data = useData();
  const [prefs] = usePrefs();
  const feed = useLive('rocketLineups');

  const battle: BattleOptions = useMemo(() => ({
    attackerLevel: prefs.attackerLevel || 40, includeShadow: true, includeMega: false, includeElite: true, includeUnreleased: false,
  }), [prefs.attackerLevel]);

  const sections = useMemo(() => {
    const list = feed.data || [];
    const by = (k: Kind) => list.filter((r) => kindOf(r) === k);
    const grunts = by('grunt').sort((a, b) => TYPES.indexOf(a.type.toLowerCase() as PokeType) - TYPES.indexOf(b.type.toLowerCase() as PokeType));
    return [
      { id: 'rk-boss', label: 'Giovanni', items: by('boss') },
      { id: 'rk-leaders', label: 'Leaders', items: by('leader') },
      { id: 'rk-grunts', label: 'Typed grunts', items: grunts },
      { id: 'rk-other', label: 'Other grunts', items: by('other') },
    ].filter((s) => s.items.length);
  }, [feed.data]);

  return (
    <div>
      <PageHeader title="Team GO Rocket" subtitle="Current lineups for Giovanni, the Leaders and every grunt — which Shadow Pokémon you can catch, which can be shiny, and the best counters for each slot."
        actions={<FeedStatus {...feed} what="lineups" />} />

      <JumpChips items={[...sections.map((s) => ({ id: s.id, label: s.label, count: s.items.length })), { id: 'rk-quotes', label: 'Grunt quotes' }, { id: 'rk-tips', label: 'Battle tips' }]} />

      {!feed.data && feed.loading && <Spinner label="Loading lineups…" />}
      {feed.data && !feed.data.length && <Card><Empty icon="🚀">No Team GO Rocket lineups are listed right now.</Empty></Card>}

      {sections.map((s) => (
        <section key={s.id}>
          <div className="section-title" id={s.id}><h2>{s.label}</h2><span className="count">{s.items.length}</span></div>
          <div className="rk-grid">
            {s.items.map((r) => <LineupCard key={r.name} lineup={r} battle={battle} data={data} />)}
          </div>
        </section>
      ))}

      <div className="grid grid-2" style={{ marginTop: 22, alignItems: 'start' }}>
        <QuoteTable />
        <Tips />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- lineup card
interface SlotMon { m: LiveRocketMon; r: Resolved | null }

function LineupCard({ lineup, battle, data }: { lineup: LiveRocket; battle: BattleOptions; data: GameData }) {
  const resolve = useResolver();
  const [open, setOpen] = useState(false);
  const kind = kindOf(lineup);
  const type = lineup.type ? (lineup.type.toLowerCase() as PokeType) : null;
  const slots: SlotMon[][] = [lineup.firstPokemon, lineup.secondPokemon, lineup.thirdPokemon].map((s) => (s || []).map((m) => ({ m, r: resolve(m.name, m.image) })));
  const catchable = slots.flat().filter((x) => x.m.isEncounter);
  const icon = kind === 'boss' ? '👑' : kind === 'leader' ? '🎖️' : '🚀';
  return (
    <Card className="rk-card" title={<span className="row" style={{ gap: 8 }}>{icon} {lineup.name}{type && <TypeBadge type={type} small />}</span>}>
      <div className="col" style={{ gap: 10 }}>
        {type && QUOTES[type] && <div className="rk-quote">“{QUOTES[type]}”</div>}
        {lineup.name.toLowerCase().includes('decoy') && <div className="small muted">Decoy grunts can appear in place of Giovanni when tracking him with a Super Rocket Radar.</div>}
        <div className="rk-slots">
          {slots.map((s, i) => (
            <div key={i} className="rk-slot">
              <div className="rk-slot-title">Slot {i + 1}{s.length > 1 ? ` · 1 of ${s.length}` : ''}</div>
              {s.length ? s.map(({ m, r }) => <RocketMon key={m.name} m={m} r={r} />) : <span className="faint tiny center">—</span>}
            </div>
          ))}
        </div>
        <div className="small muted">
          {(() => {
            const names = [...new Set(catchable.map((x) => x.m.name))];
            if (!names.length) return 'No reward encounter listed.';
            return names.length === 1 ? <>Reward encounter: <b>Shadow {names[0]}</b></> : <>Possible reward encounters: {names.map((n) => `Shadow ${n}`).join(', ')}</>;
          })()}
        </div>
        {type && (
          <div className="row small" style={{ gap: 6 }}><span className="faint">Bring</span>{TYPES.filter((t) => (data.types[t]?.[type] ?? 1) > 1).map((t) => <TypeBadge key={t} type={t} small />)}<span className="faint">moves</span></div>
        )}
        <div className="divider" style={{ margin: '4px 0' }} />
        {!open ? (
          <button className="btn sm" onClick={() => setOpen(true)}>Show recommended counters</button>
        ) : (
          <LineupCounters slots={slots} battle={battle} data={data} name={lineup.name} />
        )}
      </div>
    </Card>
  );
}

function RocketMon({ m, r }: SlotMon) {
  const content = (
    <>
      <LiveSprite image={m.image} p={r?.pokemon} size={44} shadow />
      <span className="rk-name">{m.name}</span>
      <Types types={r ? r.pokemon.types : m.types} small />
      <span className="rk-flags">
        {m.isEncounter && <span className="badge good" title="Can be caught after the battle">Catch</span>}
        {m.canBeShiny && <ShinyBadge small />}
      </span>
    </>
  );
  return r ? <Link className="rk-mon" to={`/dex/${r.pokemon.id}`} title={`Shadow ${m.name}`}>{content}</Link> : <div className="rk-mon">{content}</div>;
}

// ---------------------------------------------------------------- counters
function LineupCounters({ slots, battle, data, name }: { slots: SlotMon[][]; battle: BattleOptions; data: GameData; name: string }) {
  const opponents = useMemo(() => {
    const seen = new Set<string>();
    const out: Pokemon[] = [];
    for (const x of slots.flat()) if (x.r && !seen.has(x.r.pokemon.id)) { seen.add(x.r.pokemon.id); out.push(x.r.pokemon); }
    return out;
  }, [slots]);
  const k = optsKey(battle);
  // Child components queue their per-opponent rankings first; this aggregate then runs on cached results.
  const allRound = useQueued(`rocket-agg:${name}:${opponents.map((p) => p.id).join(',')}:${k}`, () => aggregate(opponents.map((p) => cachedCounters(data, p, ROCKET_TIER, battle, undefined, 40))), opponents.length > 0);
  return (
    <div>
      <div className="rk-counter-block">
        <div className="subhead">Best all-round picks</div>
        {!allRound ? <Spinner label="Ranking…" /> : (
          <ol className="cc-list">
            {allRound.slice(0, 6).map((a, i) => (
              <li key={a.r.pokemon.id + (a.r.shadow ? 's' : '')} className="cc-row">
                <span className="cc-rank">{i + 1}</span>
                <span className="cc-mon"><Mon p={a.r.pokemon} shadow={a.r.shadow} size={28} sub={`Strong vs ${a.hits} of ${opponents.length}`} /></span>
                <span className="cc-score num" title="Average strength vs every possible opponent, relative to the best counter for each"><span className="bold">{fmt(a.score * 100)}%</span></span>
              </li>
            ))}
          </ol>
        )}
      </div>
      {slots.map((s, i) => s.some((x) => x.r) && (
        <div key={i} className="rk-counter-block">
          <div className="subhead">Slot {i + 1}</div>
          {s.filter((x) => x.r).map(({ m, r }) => <SlotCounters key={m.name} name={m.name} p={r!.pokemon} battle={battle} data={data} />)}
        </div>
      ))}
      <p className="faint tiny" style={{ marginTop: 8, marginBottom: 0 }}>
        Ranked with the raid DPS model against a Shadow, tier-3-strength version of each Pokémon (level {battle.attackerLevel} attackers, Megas excluded).
        Rocket fights use Trainer-battle mechanics, so treat this as a strong guide rather than an exact simulation.
      </p>
    </div>
  );
}

function SlotCounters({ name, p, battle, data }: { name: string; p: Pokemon; battle: BattleOptions; data: GameData }) {
  const rows = useQueued(`rocket:${p.id}:${optsKey(battle)}`, () => cachedCounters(data, p, ROCKET_TIER, battle, undefined, 40));
  return (
    <div style={{ marginBottom: 8 }}>
      <div className="row small" style={{ gap: 6, marginBottom: 2 }}><span className="bold">vs {name}</span><WeaknessList types={p.types} limit={4} /></div>
      <CompactCounters rows={rows} limit={3} />
    </div>
  );
}

function aggregate(lists: CounterResult[][]) {
  const acc = new Map<string, { r: CounterResult; sum: number; hits: number }>();
  for (const list of lists) {
    const top = list[0]?.er || 1;
    list.forEach((r, i) => {
      const key = r.pokemon.id + (r.shadow ? 's' : '');
      const e = acc.get(key) || { r, sum: 0, hits: 0 };
      e.sum += r.er / top;
      if (i < 15) e.hits++;
      if (r.er > e.r.er) e.r = r;
      acc.set(key, e);
    });
  }
  const n = Math.max(1, lists.length);
  return [...acc.values()].map((e) => ({ r: e.r, score: e.sum / n, hits: e.hits })).sort((a, b) => b.score - a.score);
}

// ---------------------------------------------------------------- reference
function QuoteTable() {
  const { types: chart } = useData();
  return (
    <Card id="rk-quotes" title="Grunt quotes → lineup type" flush>
      <div className="table-wrap">
        <table className="table compact">
          <thead><tr><th>Type</th><th>What the grunt says</th><th className="hide-mobile">Strong move types</th></tr></thead>
          <tbody>
            {TYPES.map((t) => (
              <tr key={t}>
                <td><TypeBadge type={t} small /></td>
                <td className="rk-quote" style={{ fontSize: '0.85rem' }}>“{QUOTES[t]}”</td>
                <td className="hide-mobile"><span className="types">{TYPES.filter((a) => (chart[a]?.[t] ?? 1) > 1).map((a) => <TypeBadge key={a} type={a} small noIcon />)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card-foot">Untyped grunts (plain “Male/Female Grunt”) give no type hint. Quotes are the in-game English lines.</div>
    </Card>
  );
}

function Tips() {
  return (
    <Card id="rk-tips" title="Battle tips">
      <ul className="stack-sm small" style={{ margin: 0, paddingLeft: 18 }}>
        <li><b>Trainer-battle rules.</b> Rocket fights use the same turn-based energy system as Trainer battles: fast moves build energy, charged attacks spend it, and either side can use Protect Shields.</li>
        <li><b>Shields.</b> Grunts, Leaders and Giovanni typically have two shields. Bait them with a cheap charged move before firing your big nuke.</li>
        <li><b>Shadow Pokémon hit harder.</b> Every opposing Pokémon is a Shadow, dealing extra damage but taking more in return — fast, hard-hitting counters are ideal.</li>
        <li><b>Leaders & Giovanni.</b> The first slot of a Leader (and Giovanni’s last slot) is the Shadow you can catch. Slots with three options are picked at random when the battle starts.</li>
        <li><b>Finding them.</b> Grunts drop Mysterious Components — six combine into a Rocket Radar that reveals a Leader’s hideout. Giovanni requires a Super Rocket Radar from special research.</li>
        <li><b>After the battle.</b> You throw Premier Balls at the Shadow Pokémon. Shadows can later be purified, or powered up as Shadows for their attack bonus.</li>
        <li><b>Heal up.</b> Rocket battles don’t restore HP — heal or swap in fresh attackers between fights.</li>
      </ul>
    </Card>
  );
}
