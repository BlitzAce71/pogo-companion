import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, Empty, PageHeader, Spinner, Switch, Types } from '../../components/ui';
import { useData } from '../../lib/data';
import { fmt } from '../../lib/format';
import { useLive, type LiveRaid, type Resolved } from '../../lib/live';
import { estimateTrainers, type BattleOptions, type RaidTier } from '../../lib/pve';
import { usePrefs, useStored } from '../../lib/storage';
import type { GameData, PokeType } from '../../lib/types';
import { cachedCounters, CompactCounters, countersLink, optsKey, useQueued } from '../battle/counterUtils';
import { cpText, FeedStatus, raidTierFor, JumpChips, LiveName, LiveSprite, ShinyBadge, useResolver, WeaknessList, WeatherChips } from './liveUtils';
import './live.css';

const GROUPS: { id: string; label: string }[] = [
  { id: '1', label: '1★ Raids' }, { id: '3', label: '3★ Raids' }, { id: '4', label: '4★ Raids' }, { id: '5', label: '5★ Legendary Raids' },
  { id: 'mega', label: 'Mega Raids' }, { id: 'mega5', label: 'Mega Legendary & Primal Raids' }, { id: 'elite', label: 'Elite Raids' },
  { id: 'shadow1', label: 'Shadow 1★ Raids' }, { id: 'shadow3', label: 'Shadow 3★ Raids' }, { id: 'shadow5', label: 'Shadow 5★ Raids' },
  { id: 'other', label: 'Other raids' },
];

interface Item { raid: LiveRaid; res: Resolved | null; tier: RaidTier | null }

export default function Raids() {
  const data = useData();
  const [prefs] = usePrefs();
  const feed = useLive('raids');
  const resolve = useResolver();
  const [opts, setOpts] = useStored('raids.opts', { shadow: true, megas: true, auto: true });

  const battle: BattleOptions = useMemo(() => ({
    attackerLevel: prefs.attackerLevel || 40,
    friendship: prefs.bestFriends ? data.settings.friendship.find((f) => f.level === 4)?.attack ?? 1 : 1,
    includeShadow: opts.shadow, includeMega: opts.megas, includeElite: true, includeUnreleased: false,
  }), [prefs.attackerLevel, prefs.bestFriends, opts.shadow, opts.megas, data.settings.friendship]);

  const groups = useMemo(() => {
    const map = new Map<string, Item[]>();
    for (const raid of feed.data || []) {
      const res = resolve(raid.name, raid.image);
      const tier = raidTierFor(raid, res);
      const g = tier ? tier.id : 'other';
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push({ raid, res, tier });
    }
    return GROUPS.filter((g) => map.has(g.id)).map((g) => ({ ...g, items: map.get(g.id)! }));
  }, [feed.data, resolve]);

  const total = feed.data?.length ?? 0;
  const shinyCount = (feed.data || []).filter((r) => r.canBeShiny).length;

  return (
    <div>
      <PageHeader title="Raid Bosses" subtitle={total ? `${total} bosses in rotation · ${shinyCount} can be shiny. Catch CPs, weather boosts, weaknesses and the best counters for each.` : 'Current raid bosses with catch CPs, weaknesses and top counters.'}
        actions={<FeedStatus {...feed} what="raids" />} />

      <div className="page-tools">
        {groups.length > 1 && <JumpChips items={groups.map((g) => ({ id: `tier-${g.id}`, label: g.label, count: g.items.length }))} />}
      </div>
      <div className="row" style={{ gap: '8px 18px', marginBottom: 6 }}>
        <Switch checked={opts.auto} onChange={(v) => setOpts({ ...opts, auto: v })} label="Rank counters automatically" />
        <Switch checked={opts.shadow} onChange={(v) => setOpts({ ...opts, shadow: v })} label="Shadow attackers" />
        <Switch checked={opts.megas} onChange={(v) => setOpts({ ...opts, megas: v })} label="Mega attackers" />
        <span className="small faint">Counters: level {battle.attackerLevel}, 15/15/15{prefs.bestFriends ? ', best friends' : ''}, no weather · <Link to="/settings">change defaults</Link></span>
      </div>

      {!feed.data && feed.loading && <Spinner label="Loading raid bosses…" />}
      {feed.data && !total && <Card><Empty icon="⚔️">No raid bosses are listed right now. Try refreshing later.</Empty></Card>}

      {groups.map((g) => (
        <section key={g.id}>
          <div className="section-title" id={`tier-${g.id}`}>
            <h2>{g.label}</h2><span className="count">{g.items.length}</span>
            {g.items[0]?.tier && <span className="badge">{fmt(g.items[0].tier.hp)} HP · {g.items[0].tier.timer / 60} min</span>}
          </div>
          <div className="raid-grid">
            {g.items.map((it) => <RaidCard key={it.raid.name + it.raid.tier} item={it} battle={battle} auto={opts.auto} data={data} />)}
          </div>
        </section>
      ))}
      {total > 0 && <p className="faint small" style={{ marginTop: 18 }}>Catch CP ranges come from Leek Duck (level 20, or level 25 when weather boosted, 10/10/10 to 15/15/15 IVs). Counters use the same comprehensive DPS model as the Raid Counters page.</p>}
    </div>
  );
}

function RaidCard({ item, battle, auto, data }: { item: Item; battle: BattleOptions; auto: boolean; data: GameData }) {
  const { raid, res, tier } = item;
  const [open, setOpen] = useState(false);
  const enabled = !!res && !!tier && (auto || open);
  const key = res && tier ? `raidcard:${res.pokemon.id}:${tier.id}:${optsKey(battle)}` : 'none';
  const counters = useQueued(key, () => cachedCounters(data, res!.pokemon, tier!, battle, undefined, 12), enabled);
  const types = res ? res.pokemon.types : (raid.types.map((t) => t.name.toLowerCase()) as PokeType[]);
  const trainers = counters && tier ? estimateTrainers(counters, tier) : null;
  const p = res?.pokemon;
  return (
    <Card className="raid-card" style={{ ['--tc' as string]: `var(--t-${types[0] || 'normal'})` }}>
      <div className="raid-top">
        <LiveSprite image={raid.image} p={p} size={64} shadow={res?.shadow} />
        <div className="col" style={{ gap: 4, minWidth: 0 }}>
          <h3><LiveName name={raid.name} r={res} />{raid.canBeShiny && <ShinyBadge small />}</h3>
          <div className="row" style={{ gap: 6 }}>
            <Types types={types} small />
            {tier && <span className="badge accent">{tier.stars}</span>}
          </div>
        </div>
      </div>
      <div className="raid-body">
        <div className="raid-kv">
          <span>Catch CP</span><span className="num bold">{cpText(raid.combatPower?.normal)}</span>
          <span>Boosted CP</span><span className="num">{cpText(raid.combatPower?.boosted)}</span>
          <span>Weather</span><WeatherChips names={(raid.boostedWeather || []).map((w) => w.name)} />
          <span>Weak to</span>{types.length ? <WeaknessList types={types} /> : <span className="faint small">—</span>}
        </div>
        {!res ? (
          <div className="callout warn small">Couldn’t match “{raid.name}” to the game data, so counters aren’t available.</div>
        ) : (
          <div className="raid-counters">
            <div className="raid-counters-head">
              <h4>Top counters</h4>
              {trainers != null && trainers !== Infinity && <span className="badge" title="Rough estimate with top-6 counters">~{trainers} trainer{trainers === 1 ? '' : 's'}</span>}
            </div>
            {enabled ? <CompactCounters rows={counters} limit={6} /> : (
              <button className="btn sm" style={{ width: '100%' }} onClick={() => setOpen(true)}>Show top counters</button>
            )}
            {tier && <div className="row" style={{ marginTop: 8, justifyContent: 'flex-end' }}><Link className="btn sm" to={countersLink(res.pokemon, tier)}>Full counters →</Link></div>}
          </div>
        )}
      </div>
    </Card>
  );
}
