import { memo, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, Empty, NumberInput, PageHeader, Segmented, StatTile, Tabs, TypeBadge } from '../../components/ui';
import { useData } from '../../lib/data';
import { fmt } from '../../lib/format';
import { typeIcon } from '../../lib/images';
import { useStored } from '../../lib/storage';
import type { Medal } from '../../lib/types';
import './refpages.css';

const TIER_NAMES = ['Bronze', 'Silver', 'Gold', 'Platinum'];
const tierName = (i: number) => TIER_NAMES[i] ?? `Tier ${i + 1}`;
/** CSS tier class (1..4); extra tiers reuse Platinum styling */
const tcls = (tier: number) => Math.min(4, tier);

type Group = 'dex' | 'catch' | 'battle' | 'explore' | 'type' | 'other';
const GROUPS: { id: Group; label: string; icon: string }[] = [
  { id: 'dex', label: 'Pokédex', icon: '📖' },
  { id: 'catch', label: 'Catching & Collection', icon: '🎯' },
  { id: 'battle', label: 'Battle', icon: '⚔️' },
  { id: 'explore', label: 'Exploration & Social', icon: '🧭' },
  { id: 'type', label: 'Type', icon: '🔷' },
  { id: 'other', label: 'Other', icon: '🏅' },
];

function groupOf(m: Medal): Group {
  const id = m.id;
  if (m.type) return 'type';
  if (/POKEDEX_ENTRIES/.test(id)) return 'dex';
  if (/BATTLE|RAID|ROCKET|LEAGUE|BERRIES_FED|HOURS_DEFENDED/.test(id)) return 'battle';
  if (/CAPTURE|MAGIKARP|RATTATA|PIKACHU|UNOWN|BUTTERFLY|EVOLVED|HATCHED|PURIFIED|MEGA_EVOS|PHOTOBOMB|STREAK|SHOWCASE|MAX_SIZE/.test(id)) return 'catch';
  if (/POKESTOP|TRAVEL|ROUTE|TRADING|FRIENDS|BUDDY|REFERRED|CHECK_INS|PARTY|WAYFARER|LURES|CHALLENGE_QUESTS/.test(id)) return 'explore';
  return 'other';
}

/** Medal description with the game's number placeholder ("#" or "{0:0.#}") filled in */
const describe = (m: Medal, n: number | null) => {
  const v = n === null ? '#' : fmt(n);
  return m.desc.replace(/\{0[^}]*\}/g, v).replace(/#/g, v).trim();
};

/** Community-known catch-rate bonus from a type medal tier (Platinum = Gold) */
const TYPE_BONUS = [1, 1.1, 1.2, 1.3, 1.3];

interface Status { value: number | null; tier: number; next: number | null; frac: number }
function statusOf(m: Medal, value: number | undefined): Status {
  const v = value ?? null;
  const tier = v === null ? 0 : m.targets.filter((t) => v >= t).length;
  const next = m.targets[tier] ?? null;
  const frac = v === null ? 0 : next === null ? 1 : Math.min(1, v / next);
  return { value: v, tier, next, frac };
}

type Sort = 'default' | 'near' | 'tier' | 'name';

const MedalCard = memo(function MedalCard({ m, st, onValue }: { m: Medal; st: Status; onValue: (id: string, v: number | '') => void }) {
  const done = st.next === null && st.value !== null;
  return (
    <div className="rp-medal">
      <div className="rp-medal-head">
        <span className={`rp-medal-icon t${tcls(st.tier)}`} aria-hidden>
          {m.type ? <img src={typeIcon(m.type)} alt="" loading="lazy" /> : (GROUPS.find((g) => g.id === groupOf(m))?.icon ?? '🏅')}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="name">{m.name}</div>
          <div className="small muted">{describe(m, st.next ?? m.targets[m.targets.length - 1] ?? null)}</div>
        </div>
        {m.type && <TypeBadge type={m.type} small />}
      </div>
      <div className="rp-tiers" style={m.targets.length > 4 ? { gridTemplateColumns: `repeat(${m.targets.length}, minmax(0, 1fr))` } : undefined}>
        {m.targets.map((t, i) => (
          <div key={i} className={`rp-tier t${tcls(i + 1)} ${st.tier > i ? 'done' : ''}`} title={`${tierName(i)}: ${fmt(t)}`}>
            <span className="tn">{tierName(i)}</span><span className="tv">{fmt(t)}</span>
          </div>
        ))}
      </div>
      <div className="rp-medal-progress">
        <NumberInput className="sm" value={st.value ?? ''} min={0} placeholder="Your total" onChange={(v) => onValue(m.id, v)} />
        <div className="grow">
          <div className="row nowrap small" style={{ justifyContent: 'space-between', gap: 6 }}>
            <span className={`rp-tierpill t${tcls(st.tier)}`}>{st.tier ? tierName(st.tier - 1) : 'No tier'}</span>
            <span className="faint num" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {st.value === null ? 'Not tracked' : done ? 'Complete!' : `${fmt(st.next! - st.value)} to ${tierName(st.tier)}`}
            </span>
          </div>
          <div className={`progress rp-p${tcls(Math.min(st.tier + 1, m.targets.length))}`}><div style={{ width: `${st.frac * 100}%` }} /></div>
        </div>
      </div>
      {m.type && st.tier > 0 && <div className="tiny muted">Catch bonus for {m.type}-type Pokémon: <b>×{TYPE_BONUS[Math.min(st.tier, 4)]}</b></div>}
    </div>
  );
});

export default function Medals() {
  const { reference } = useData();
  const medals = reference.medals;
  const [progress, setProgress] = useStored<Record<string, number>>('medals', {});
  const [group, setGroup] = useState<Group | 'all'>('all');
  const [sort, setSort] = useState<Sort>('default');
  const [q, setQ] = useState('');

  const onValue = useMemo(() => (id: string, v: number | '') => setProgress((prev) => {
    const next = { ...prev };
    if (v === '' || v < 0) delete next[id]; else next[id] = v;
    return next;
  }), [setProgress]);

  const statuses = useMemo(() => {
    const m: Record<string, Status> = {};
    for (const x of medals) m[x.id] = statusOf(x, progress[x.id]);
    return m;
  }, [medals, progress]);

  const groupCounts = useMemo(() => {
    const c: Partial<Record<Group, number>> = {};
    for (const m of medals) { const g = groupOf(m); c[g] = (c[g] || 0) + 1; }
    return c;
  }, [medals]);

  const tierCounts = useMemo(() => {
    const c = [0, 0, 0, 0];
    let tracked = 0;
    for (const m of medals) {
      const st = statuses[m.id];
      if (st.value !== null) tracked++;
      if (st.tier > 0) c[Math.min(3, st.tier - 1)]++;
    }
    return { c, tracked };
  }, [medals, statuses]);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    const order = GROUPS.map((g) => g.id);
    const list = medals.filter((m) => {
      if (group !== 'all' && groupOf(m) !== group) return false;
      if (s && !(`${m.name} ${m.desc} ${m.type ?? ''}`.toLowerCase().includes(s))) return false;
      return true;
    });
    const st = (m: Medal) => statuses[m.id];
    const near = (m: Medal) => {
      const x = st(m);
      if (x.value === null) return -2;       // untracked last-ish
      if (x.next === null) return -1;        // completed after in-progress
      return x.frac;
    };
    return [...list].sort((a, b) => {
      switch (sort) {
        case 'near': return near(b) - near(a) || a.name.localeCompare(b.name);
        case 'tier': return st(b).tier - st(a).tier || st(b).frac - st(a).frac || a.name.localeCompare(b.name);
        case 'name': return a.name.localeCompare(b.name);
        default: return order.indexOf(groupOf(a)) - order.indexOf(groupOf(b)) || a.name.localeCompare(b.name);
      }
    });
  }, [medals, group, q, sort, statuses]);

  const tabs = [
    { id: 'all' as const, label: `All (${medals.length})` },
    ...GROUPS.filter((g) => groupCounts[g.id]).map((g) => ({ id: g.id, label: `${g.label} (${groupCounts[g.id]})` })),
  ];
  const grouped = sort === 'default' && group === 'all';

  const clearAll = () => { if (confirm('Clear all saved medal progress? This cannot be undone.')) setProgress({}); };

  return (
    <div className="stack">
      <PageHeader title="Medals" subtitle={`All ${medals.length} medals with their Bronze, Silver, Gold and Platinum targets. Enter your totals to track progress — saved on this device.`}
        actions={tierCounts.tracked > 0 ? <button className="btn sm danger" onClick={clearAll}>Clear progress</button> : undefined} />

      <div className="grid grid-4">
        <StatTile label="Platinum" value={fmt(tierCounts.c[3])} sub={`of ${medals.length} medals`} />
        <StatTile label="Gold" value={fmt(tierCounts.c[2])} sub="highest tier Gold" />
        <StatTile label="Silver" value={fmt(tierCounts.c[1])} sub="highest tier Silver" />
        <StatTile label="Bronze" value={fmt(tierCounts.c[0])} sub={`${fmt(tierCounts.tracked)} tracked`} />
      </div>

      <Card title="Type medals & catch rate">
        <div className="col small">
          <p style={{ margin: 0 }}>
            Each of the {groupCounts.type ?? 18} type medals boosts your chance to catch Pokémon of that type. <span className="faint">(Community-known values.)</span>
          </p>
          <div className="row" style={{ gap: 8 }}>
            {[1, 2, 3, 4].map((t) => (
              <span key={t} className={`rp-tierpill t${t}`}>{tierName(t - 1)} ×{TYPE_BONUS[t]}</span>
            ))}
          </div>
          <p style={{ margin: 0 }} className="muted">
            Platinum gives the same bonus as Gold. For dual-type Pokémon the two medal bonuses are averaged — e.g. Gold Water (×1.3) + no Flying medal (×1.0) gives ×1.15 on a Gyarados. The multiplier stacks with ball, berry, throw and curveball bonuses; see <Link to="/ref/mechanics">Game Mechanics</Link> for the full catch formula.
          </p>
        </div>
      </Card>

      <Tabs tabs={tabs} value={group} onChange={setGroup} />
      <div className="rp-toolbar">
        <input className="input" placeholder="Search medals…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Segmented<Sort> size="sm" value={sort} onChange={setSort} options={[
          { id: 'default', label: 'Grouped' },
          { id: 'near', label: 'Near next tier' },
          { id: 'tier', label: 'Highest tier' },
          { id: 'name', label: 'A–Z' },
        ]} />
      </div>

      {rows.length === 0 ? <Card><Empty icon="🏅">No medals match “{q}”.</Empty></Card> : grouped ? (
        GROUPS.filter((g) => rows.some((m) => groupOf(m) === g.id)).map((g) => (
          <div key={g.id} className="stack-sm">
            <h3>{g.icon} {g.label} <span className="faint small">({rows.filter((m) => groupOf(m) === g.id).length})</span></h3>
            <div className="rp-medal-grid">
              {rows.filter((m) => groupOf(m) === g.id).map((m) => <MedalCard key={m.id} m={m} st={statuses[m.id]} onValue={onValue} />)}
            </div>
          </div>
        ))
      ) : (
        <div className="rp-medal-grid">
          {rows.map((m) => <MedalCard key={m.id} m={m} st={statuses[m.id]} onValue={onValue} />)}
        </div>
      )}
      <p className="rp-note">Medal targets come from the game master. Some medals (e.g. region Pokédex medals) have Platinum targets that change when new Pokémon are released.</p>
    </div>
  );
}
