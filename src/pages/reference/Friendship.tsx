import { memo, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, Empty, NumberInput, PageHeader, PokeImg, Segmented, StatTile, useShowMore } from '../../components/ui';
import { displayName, useData } from '../../lib/data';
import { fmt } from '../../lib/format';
import type { Pokemon } from '../../lib/types';
import './refpages.css';

const FRIEND_NAMES = ['Friend', 'Good Friend', 'Great Friend', 'Ultra Friend', 'Best Friend', 'Best Friends Forever'];
const BUDDY_NAMES = ['Buddy', 'Good Buddy', 'Great Buddy', 'Ultra Buddy', 'Best Buddy'];

/** Readable labels for game-master buddy trait keys. The raw key is kept as a tooltip. */
function traitLabel(t: string, maxLevel: number): string {
  const k = t.toLowerCase().replace(/[\s_]+/g, '');
  switch (k) {
    case 'mapdeploy': return 'Appears with you on the map';
    case 'emotionindicator': return 'Mood indicator';
    case 'training': return 'Buddy training';
    case 'encountercameo': return 'Cameo in wild encounters';
    case 'pickupconsumables': return 'Brings you presents (items)';
    case 'pickupsouvenirs': return 'Brings souvenirs';
    case 'findattractivepois': return 'Points out interesting places';
    case 'bestbuddyasset': return 'Best Buddy ribbon';
    case 'cpboost': return `CP boost: +1 level while buddy (up to ${maxLevel + 1})`;
    default: return t;
  }
}

const pctBonus = (m: number) => { const v = Math.round((m - 1) * 1000) / 10; return `+${fmt(v, v % 1 ? 1 : 0)}%`; };
const hearts = (n: number, of: number) => (
  <span className="rp-hearts" aria-label={`${n} of ${of}`}>{'♥'.repeat(n)}<span className="off">{'♥'.repeat(Math.max(0, of - n))}</span></span>
);

const KM_OPTIONS = [0, 1, 3, 5, 20] as const;
type Km = (typeof KM_OPTIONS)[number];
const REGIONAL = /^(Alolan|Galarian|Hisuian|Paldean)/;

const BuddyTile = memo(function BuddyTile({ p }: { p: Pokemon }) {
  return (
    <Link className="rp-buddy" to={`/dex/${p.id}`} title={displayName(p)}>
      <PokeImg p={p} size={40} />
      <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <span className="n">{displayName(p)}</span>
        <span className="s">#{p.dex} · <span className={`rp-km k${p.buddyKm}`}>{p.buddyKm} km</span></span>
      </span>
    </Link>
  );
});

export default function Friendship() {
  const data = useData();
  const { settings } = data;
  const friendship = useMemo(() => [...settings.friendship].sort((a, b) => a.level - b.level), [settings.friendship]);
  const buddyLevels = useMemo(() => [...settings.buddyLevels].sort((a, b) => a.level - b.level), [settings.buddyLevels]);
  const maxLevel = settings.maxPokemonLevel;

  // ---------------- friendship planner
  const [days, setDays] = useState<number | ''>('');
  const d = days === '' ? null : Math.max(0, days);
  // Levels with a unique day requirement (the top tier shares Best Friend's day count in the data)
  const dayLevels = useMemo(() => friendship.filter((f, i) => i === 0 || f.points > friendship[i - 1].points), [friendship]);
  const currentLevel = d === null ? null : dayLevels.reduce((lvl, f) => (d >= f.points ? f.level : lvl), 0);
  const nextLevel = currentLevel === null ? null : dayLevels.find((f) => f.level > currentLevel) || null;
  const bestDays = dayLevels[dayLevels.length - 1]?.points || 0;
  const totalXp = friendship.reduce((s, f) => s + (f.level > 0 ? f.xp : 0), 0);

  // ---------------- buddy distance browser
  const [km, setKm] = useState<Km>(0);
  const [q, setQ] = useState('');
  const buddyPool = useMemo(() => {
    const base = new Map<string, Pokemon>();
    const out: Pokemon[] = [];
    for (const p of data.pokemon) {
      if (!p.released || p.megaOf) continue;
      const b = base.get(p.speciesId);
      if (!b) { base.set(p.speciesId, p); out.push(p); continue; }
      // keep regional forms and any form whose buddy distance differs from the species' first entry
      if (REGIONAL.test(p.formName || '') || p.buddyKm !== b.buddyKm) out.push(p);
    }
    return out.sort((a, b) => a.dex - b.dex);
  }, [data.pokemon]);
  const kmCounts = useMemo(() => {
    const c: Record<number, number> = {};
    for (const p of buddyPool) c[p.buddyKm] = (c[p.buddyKm] || 0) + 1;
    return c;
  }, [buddyPool]);
  const buddyRows = useMemo(() => {
    const s = q.trim().toLowerCase();
    const num = Number(s.replace('#', ''));
    return buddyPool.filter((p) => {
      if (km && p.buddyKm !== km) return false;
      if (!s) return true;
      if (!Number.isNaN(num)) return p.dex === num;
      return displayName(p).toLowerCase().includes(s) || p.types.some((t) => t === s);
    });
  }, [buddyPool, km, q]);
  const { visible, more } = useShowMore(buddyRows, 60);

  return (
    <div className="stack">
      <PageHeader title="Friendship & Buddy" subtitle="Friendship levels and their raid, trade and XP perks, buddy hearts and perks, and every Pokémon's buddy candy distance." />

      <div className="grid grid-4">
        <StatTile label="Days to Best Friend" value={fmt(bestDays)} sub="one interaction per day" />
        <StatTile label="Max attack bonus" value={friendship.length ? pctBonus(friendship[friendship.length - 1].attack) : '—'} sub="raids, gyms & Max Battles" />
        <StatTile label="Friendship XP total" value={fmt(totalXp)} sub="all level-ups combined" />
        <StatTile label="Hearts to Best Buddy" value={fmt(buddyLevels[buddyLevels.length - 1]?.points || 0)} sub={`CP boost: +1 level (max ${maxLevel + 1})`} />
      </div>

      <Card title="Friendship levels" flush footer={<>
        Days are cumulative. Each day you interact with a friend (open or send a gift, trade, raid, battle in a gym or Max Battle together, or Trainer Battle) earns one friendship point; only one counts per day.
        Level 5 appears in the game data with the same day count as Best Friend; the community calls it “Best Friends Forever”. Any further requirements aren't detailed in the data.
      </>}>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Level</th>
                <th className="num">Days</th>
                <th className="num" title="Attack bonus when battling alongside this friend in raids, gyms and Max Battles">Attack bonus</th>
                <th className="num" title="Extra Premier Balls after a raid won together">Raid balls</th>
                <th className="num" title="Stardust discount on trades with this friend">Trade discount</th>
                <th className="num" title="Trainer XP for reaching this level">XP reward</th>
                <th title="Lucky Trinket can be used to become Lucky Friends">Lucky Trinket</th>
              </tr>
            </thead>
            <tbody>
              {friendship.map((f) => (
                <tr key={f.level} className={currentLevel === f.level ? 'rp-tr-current' : ''}>
                  <td>
                    <div className="row nowrap" style={{ gap: 8 }}>
                      {hearts(Math.min(f.level, 4), 4)}
                      <span className="bold">{FRIEND_NAMES[f.level] ?? `Level ${f.level}`}</span>
                      {f.level === 5 && <span className="badge purple">Top tier</span>}
                    </div>
                  </td>
                  <td className="num">{f.level === 0 ? '—' : f.level === 5 ? `${fmt(f.points)}+` : fmt(f.points)}</td>
                  <td className="num">{f.attack > 1 ? pctBonus(f.attack) : '—'}</td>
                  <td className="num">{f.raidBalls ? `+${f.raidBalls}` : '—'}</td>
                  <td className="num">{f.tradeDiscount ? `${fmt(f.tradeDiscount * 100)}% off` : '—'}</td>
                  <td className="num">{f.level === 0 ? <span className="faint" title="Listed for level 0 in the game data">{fmt(f.xp)}</span> : fmt(f.xp)}</td>
                  <td>{f.luckyApplicator ? <span className="badge good">Yes</span> : <span className="faint">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid grid-2">
        <Card title="Friendship planner">
          <div className="col">
            <div className="row">
              <span className="muted small">Days interacted so far</span>
              <NumberInput value={days} onChange={setDays} min={0} placeholder="e.g. 12" style={{ width: 110 }} />
            </div>
            {d === null ? (
              <p className="faint small" style={{ margin: 0 }}>Enter how many days you've interacted with a friend to see your level and how long until the next one.</p>
            ) : (
              <>
                <div className="kv">
                  <span>Current level</span><span>{FRIEND_NAMES[currentLevel!]}</span>
                  <span>Next level</span>
                  <span>{nextLevel ? <>{FRIEND_NAMES[nextLevel.level]} in <b>{fmt(nextLevel.points - d)}</b> day{nextLevel.points - d === 1 ? '' : 's'}</> : 'Maximum day-based level reached'}</span>
                  {nextLevel && <><span>Estimated date</span><span>{new Date(Date.now() + (nextLevel.points - d) * 86400000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span></>}
                </div>
                <div>
                  <div className="row small muted" style={{ justifyContent: 'space-between' }}><span>Progress to Best Friend</span><span className="num">{fmt(Math.min(d, bestDays))} / {fmt(bestDays)}</span></div>
                  <div className="progress"><div style={{ width: `${bestDays ? Math.min(100, (d / bestDays) * 100) : 0}%` }} /></div>
                </div>
              </>
            )}
            <div className="callout small">
              <b>Tip:</b> Activate a Lucky Egg before a friendship level-up (e.g. before opening a gift or trading) to double the XP reward — the Best Friend bonus becomes {fmt((friendship.find((f) => f.level === 4)?.xp || 0) * 2)} XP. <span className="faint">(community-known)</span>
            </div>
          </div>
        </Card>

        <Card title="Lucky Friends">
          <div className="col small">
            <p style={{ margin: 0 }}>
              Lucky Friends are guaranteed that their <b>next trade</b> with each other produces Lucky Pokémon (Lucky Pokémon cost {fmt((1 - settings.upgrade.luckyDustMult) * 100)}% less Stardust to power up).
            </p>
            <p style={{ margin: 0 }} className="muted">
              Best Friends have a small random chance to become Lucky Friends each day they interact <span className="faint">(community-known)</span>.
              {friendship.some((f) => f.luckyApplicator) && <> A <b>Lucky Trinket</b> instantly makes you Lucky Friends; the game data allows it from <b>{FRIEND_NAMES[friendship.find((f) => f.luckyApplicator)!.level]}</b> upward.</>}
            </p>
            <p style={{ margin: 0 }} className="muted">
              The Lucky Friends status ends after the one trade. Trade stardust costs and the IV floors for each friendship level are in the <Link to="/tools/trade">Trade Calculator</Link>.
            </p>
          </div>
        </Card>
      </div>

      <Card title="Buddy levels" flush footer="Hearts are cumulative. A Best Buddy gets a CP boost (+1 level) while it is your active buddy, which lets it reach level 51 in battle.">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Level</th><th className="num">Hearts</th><th className="num" title="Rough days at about 10 hearts/day">≈ Days</th><th>New perks</th></tr>
            </thead>
            <tbody>
              {buddyLevels.map((b, i) => {
                const prev = new Set(i > 0 ? buddyLevels[i - 1].traits : []);
                const added = b.traits.filter((t) => !prev.has(t));
                return (
                  <tr key={b.level}>
                    <td><div className="row nowrap" style={{ gap: 8 }}>{hearts(b.level, 4)}<span className="bold">{BUDDY_NAMES[b.level] ?? `Level ${b.level}`}</span></div></td>
                    <td className="num">{b.level === 0 ? '—' : fmt(b.points)}</td>
                    <td className="num faint">{b.level === 0 ? '—' : fmt(Math.ceil(b.points / 10))}</td>
                    <td>
                      {added.length ? (
                        <div className="rp-perks">{added.map((t) => <span key={t} className={`badge ${/cp ?boost/i.test(t) ? 'good' : ''}`} title={t}>{traitLabel(t, maxLevel)}</span>)}</div>
                      ) : <span className="faint">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Earning buddy hearts" footer="Community-known: most activities give 1 heart and can each be done a limited number of times per day; the typical daily maximum is about 10 hearts. An Excited buddy earns double hearts.">
        <div className="rp-sources">
          {[
            { ico: '🚶', t: 'Walk 2 km together', d: '1 heart per 2 km walked' },
            { ico: '🍓', t: 'Give a treat', d: 'Berry or Poffin when your buddy is hungry' },
            { ico: '🤚', t: 'Play together', d: 'Pet your buddy on the buddy screen or in AR' },
            { ico: '⚔️', t: 'Battle together', d: 'Raids, gyms, Trainer Battles or Team GO Rocket' },
            { ico: '📍', t: 'Visit a new place', d: 'Spin a PokéStop you haven’t visited with it' },
            { ico: '📷', t: 'Take a snapshot', d: 'GO Snapshot of your buddy' },
          ].map((s) => (
            <div className="rp-source" key={s.t}><span className="ico" aria-hidden>{s.ico}</span><div><div className="t">{s.t}</div><div className="d">{s.d}</div></div></div>
          ))}
        </div>
      </Card>

      <Card title="Buddy candy distance" actions={<span className="faint small">{fmt(buddyRows.length)} Pokémon</span>}
        footer="Walk the buddy distance with a Pokémon to earn 1 Candy for its family. Community-known: an Excited buddy needs only a quarter of the distance, and at trainer level 31+ buddy walking can also award Candy XL.">
        <div className="grid grid-4" style={{ marginBottom: 14 }}>
          {[1, 3, 5, 20].map((k) => (
            <StatTile key={k} label={<><span className={`rp-km k${k}`}>{k} km</span></>} value={fmt(kmCounts[k] || 0)} sub={k === 20 ? 'mostly legendaries & rares' : 'Pokémon'} />
          ))}
        </div>
        <div className="rp-toolbar">
          <input className="input" placeholder="Search name, #dex or type…" value={q} onChange={(e) => setQ(e.target.value)} />
          <Segmented<Km> value={km} onChange={setKm} options={KM_OPTIONS.map((k) => ({ id: k, label: k === 0 ? 'All' : `${k} km` }))} />
        </div>
        {buddyRows.length === 0 ? <Empty>No Pokémon match these filters.</Empty> : (
          <>
            <div className="rp-buddy-grid">{visible.map((p) => <BuddyTile key={p.id} p={p} />)}</div>
            {more}
          </>
        )}
      </Card>
    </div>
  );
}
