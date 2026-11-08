import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Card, Empty, Field, Mon, NumberInput, PageHeader, PokemonPicker, Segmented, Select, StatTile } from '../../components/ui';
import { displayName, useData } from '../../lib/data';
import { fmt, pct } from '../../lib/format';
import { TRADE_DUST, appraisalStars, cp, hp } from '../../lib/pogo';
import { useStored } from '../../lib/storage';
import { LUCKY_IV_FLOOR, TRADE_IV_FLOOR, canTrade, friendName, levelOptions, num, tradeDiscount, usePokemonParam } from './toolUtils';
import './tools.css';

type Kind = 'regular' | 'newDex' | 'special' | 'specialNew';
const KINDS: { id: Kind; label: string; desc: string; special: boolean }[] = [
  { id: 'regular', label: 'Regular trade', desc: 'Already registered by the receiver; not shiny, Legendary or Mythical.', special: false },
  { id: 'newDex', label: 'New Pokédex entry', desc: 'The receiver has not registered this species yet.', special: true },
  { id: 'special', label: 'Shiny / Legendary / Mythical — registered', desc: 'Receiver already has it registered.', special: true },
  { id: 'specialNew', label: 'Shiny / Legendary / Mythical — NOT registered', desc: 'Receiver has never registered it.', special: true },
];
const FRIEND_LEVELS = [1, 2, 3, 4];

/** Community-known candy reward by distance between the two catch locations */
const DISTANCE_CANDY = [
  { range: '0 – 10 km', candy: 1 },
  { range: '10 – 100 km', candy: 2 },
  { range: '100 km +', candy: 3 },
];

export default function TradeCalculator() {
  const { settings } = useData();
  const [friend, setFriend] = useStored<number>('tools.trade.friend', 4);
  const [kind, setKind] = useStored<Kind>('tools.trade.kind', 'regular');
  const [count, setCount] = useStored<number | ''>('tools.trade.count', 1);
  const fIdx = FRIEND_LEVELS.indexOf(friend) >= 0 ? FRIEND_LEVELS.indexOf(friend) : 3;
  const cost = TRADE_DUST[kind][fIdx];
  const k = KINDS.find((x) => x.id === kind)!;
  const luckyUnlock = settings.levelRewards.find((r) => r.unlocks.some((u) => /lucky/i.test(u)));
  const tradeUnlock = settings.levelRewards.find((r) => r.unlocks.includes('Trade'));

  return (
    <div className="stack">
      <PageHeader title="Trade Calculator" subtitle="Stardust cost by friendship and trade type, post-trade IV floors and CP ranges, and the rules worth knowing." />
      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        <Card title="Trade cost">
          <div className="col" style={{ gap: 14 }}>
            <Field label="Friendship level"><Segmented value={friend} onChange={setFriend} options={FRIEND_LEVELS.map((l) => ({ id: l, label: friendName(l) }))} /></Field>
            <Field label="Trade type" hint={k.desc}><Select value={kind} onChange={setKind} options={KINDS.map((x) => ({ id: x.id, label: x.label }))} /></Field>
            <Field label="Number of trades" style={{ maxWidth: 160 }}><NumberInput value={count} onChange={setCount} min={1} /></Field>
            <div className="tool-tiles">
              <StatTile label="Per trade" value={fmt(cost)} sub="Stardust, paid by both players" />
              <StatTile label="Total" value={fmt(cost * Math.max(1, num(count, 1)))} />
              <StatTile label="IV floor" value={TRADE_IV_FLOOR[friend]} sub={`${LUCKY_IV_FLOOR} if Lucky`} />
              <StatTile label="Discount" value={pct(tradeDiscount(settings, friend) * 100, 0)} sub="vs Good Friend" />
            </div>
            {k.special && <div className="callout warn small"><b>Special Trade</b> — limited to one per day (events sometimes raise this). Both trainers need enough Stardust.</div>}
          </div>
        </Card>

        <Card title="Cost matrix" flush footer={<span className="tool-note">Stardust per trade. Tap a cell to use it above. Friendship discounts from the game master: {FRIEND_LEVELS.map((l) => `${friendName(l)} ${pct(tradeDiscount(settings, l) * 100, 0)}`).join(' · ')}.</span>}>
          <div className="table-wrap">
            <table className="table compact matrix">
              <thead><tr><th>Trade type</th>{FRIEND_LEVELS.map((l) => <th key={l} className="num">{friendName(l)}</th>)}</tr></thead>
              <tbody>
                {KINDS.map((x) => (
                  <tr key={x.id}>
                    <td className="small">{x.label}{x.special && <span className="badge warn" style={{ marginLeft: 6 }}>Special</span>}</td>
                    {FRIEND_LEVELS.map((l, i) => (
                      <td key={l} className={`num cell-btn ${x.id === kind && l === friend ? 'pick' : ''}`} onClick={() => { setKind(x.id); setFriend(l); }}>{fmt(TRADE_DUST[x.id][i])}</td>
                    ))}
                  </tr>
                ))}
                <tr><td className="small muted">Minimum IV after trade</td>{FRIEND_LEVELS.map((l) => <td key={l} className="num muted">{TRADE_IV_FLOOR[l]}</td>)}</tr>
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <PostTrade />

      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        <Card title="Lucky trades">
          <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }} className="small">
            <li>A Lucky Pokémon gets IVs of at least <b>{LUCKY_IV_FLOOR}/{LUCKY_IV_FLOOR}/{LUCKY_IV_FLOOR}</b> and costs <b>{pct(settings.upgrade.luckyDustMult * 100, 0)}</b> of the normal Stardust to power up.</li>
            <li>The older the Pokémon (by catch date), the better the lucky chance — Pokémon from 2016–2017 have much higher odds (community-observed).</li>
            <li><b>Lucky Friends</b>: Best Friends can randomly become Lucky Friends (or via a Lucky Trinket); their next trade is guaranteed Lucky.</li>
            {luckyUnlock && <li>Trainer level <b>{luckyUnlock.level}</b> unlocks an increased Lucky chance (from game data).</li>}
            <li>Search <code>age365-&amp;!lucky&amp;!traded</code> to find old, untraded Pokémon to use as lucky-trade fodder. <Link to="/tools/search">Search strings →</Link></li>
          </ul>
        </Card>
        <Card title="Candy bonus by distance" flush footer={<span className="tool-note">Distance between where the Pokémon was caught and where the receiver is (community-known). Long-distance trades can also award Candy XL to trainers level 31+.</span>}>
          <div className="table-wrap">
            <table className="table compact">
              <thead><tr><th>Catch distance</th><th className="num">Bonus candy</th></tr></thead>
              <tbody>{DISTANCE_CANDY.map((d) => <tr key={d.range}><td>{d.range}</td><td className="num bold">+{d.candy}</td></tr>)}</tbody>
            </table>
          </div>
        </Card>
      </div>

      <Card title="Trading rules">
        <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }} className="small">
          <li>Trading unlocks at trainer level <b>{tradeUnlock?.level ?? 10}</b>; trainers must be friends and within about 100 m (events sometimes extend this).</li>
          <li>The Pokémon keeps its <b>level</b>, moves, size and shiny status; IVs are re-rolled with the friendship floor, so CP and HP change.</li>
          <li>Each Pokémon can only be traded once. Shadow Pokémon, Mythical Pokémon (except Meltan and Melmetal), buddies, gym defenders and injured Pokémon can't be traded.</li>
          <li>Special Trades (new Pokédex entries, shiny, Legendary, Mythical) are limited to one per day and need at least Good Friend status.</li>
          <li>When the two Pokémon have different costs, both trainers pay the higher one.</li>
          <li>Pokémon that “Trade evolve” (e.g. Kadabra, Machoke) evolve for zero candy after a trade.</li>
        </ul>
      </Card>
    </div>
  );
}

function PostTrade() {
  const { settings } = useData();
  const [p, setP] = usePokemonParam('trade');
  const [level, setLevel] = useStored<number>('tools.trade.level', 20);
  const [floorKey, setFloorKey] = useStored<number>('tools.trade.floor', 4);
  const floor = floorKey === 5 ? LUCKY_IV_FLOOR : TRADE_IV_FLOOR[floorKey] ?? 1;

  const dist = useMemo(() => {
    const n = 16 - floor;
    const total = n * n * n;
    const stars = [0, 0, 0, 0, 0];
    for (let a = floor; a < 16; a++) for (let d = floor; d < 16; d++) for (let s = floor; s < 16; s++) stars[appraisalStars([a, d, s])]++;
    return { total, stars };
  }, [floor]);

  const tradable = p ? canTrade(p) : true;
  return (
    <Card title="After the trade">
      <div className="split" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.2fr)' }}>
        <div className="col" style={{ gap: 12 }}>
          <Field label="Pokémon (optional)"><PokemonPicker value={p} onChange={setP} allowClear /></Field>
          <Field label="Its level (unchanged by trading)"><Select value={level} onChange={setLevel} options={levelOptions(50)} /></Field>
          <Field label="Friendship / lucky"><Segmented size="sm" value={floorKey} onChange={setFloorKey} options={[...FRIEND_LEVELS.map((l) => ({ id: l, label: friendName(l) })), { id: 5, label: '🍀 Lucky' }]} /></Field>
        </div>
        <div className="col" style={{ gap: 12 }}>
          {p && !tradable && <div className="callout bad small"><b>{displayName(p)}</b> can't be traded.</div>}
          {p && tradable && p.class && <div className="small muted">{displayName(p)} is {p.class === 'ultra_beast' ? 'an Ultra Beast' : `a ${p.class}`} Pokémon — trading it is a Special Trade.</div>}
          {p ? (
            <div className="tool-tiles">
              <StatTile label="CP range" value={`${fmt(cp(p, settings, level, [floor, floor, floor]))}–${fmt(cp(p, settings, level, [15, 15, 15]))}`} sub={<Mon p={p} size={20} link={false} />} />
              <StatTile label="HP range" value={`${hp(p, settings, level, floor)}–${hp(p, settings, level, 15)}`} />
            </div>
          ) : <Empty icon="🔁">Pick a Pokémon to see its CP range after the trade.</Empty>}
          <div className="tool-tiles">
            <StatTile label="IV floor" value={`${floor}/${floor}/${floor}`} />
            <StatTile label="Hundo odds" value={`1 in ${fmt(dist.total)}`} sub={pct((1 / dist.total) * 100, 2)} />
            <StatTile label="3★ or better" value={pct(((dist.stars[3] + dist.stars[4]) / dist.total) * 100, 1)} />
            <StatTile label="0★ chance" value={pct((dist.stars[0] / dist.total) * 100, 1)} />
          </div>
          <p className="tool-note">Each IV is assumed uniformly random from the floor to 15.</p>
        </div>
      </div>
    </Card>
  );
}
