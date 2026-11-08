import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, Empty, Mon, PageHeader, Spinner, StatTile, Switch, Types } from '../../components/ui';
import { displayName, useData } from '../../lib/data';

import { useLive, type LiveEgg, type Resolved } from '../../lib/live';
import { cp, cpRange, ENCOUNTERS } from '../../lib/pogo';
import type { GameData, Pokemon } from '../../lib/types';
import { cpText, FeedStatus, JumpChips, LiveSprite, Rarity, ShinyBadge, useResolver } from './liveUtils';
import './live.css';

const EGG_COLORS: Record<string, [string, string]> = {
  '1 km': ['#f7c948', '#fff3c4'], '2 km': ['#5fd38d', '#e4fbe9'], '5 km': ['#f59f3a', '#fff0dc'], '7 km': ['#f5d34a', '#ff9fc6'],
  '10 km': ['#b16cf0', '#f1e3ff'], '12 km': ['#e5484d', '#2b2b2b'],
};

function EggIcon({ km }: { km: string }) {
  const [spot, shell] = EGG_COLORS[km] || ['#9aa5b8', '#eef1f6'];
  return (
    <svg className="egg-icon" viewBox="0 0 40 48" aria-hidden>
      <path d="M20 2C10 2 3 18 3 29c0 10 7.6 17 17 17s17-7 17-17C37 18 30 2 20 2z" fill={shell} stroke="rgba(0,0,0,0.25)" strokeWidth="1.2" />
      <circle cx="13" cy="24" r="4" fill={spot} /><circle cx="26" cy="16" r="3" fill={spot} /><circle cx="25" cy="33" r="5" fill={spot} /><circle cx="15" cy="38" r="2.5" fill={spot} />
    </svg>
  );
}

type Pool = 'standard' | 'adventure' | 'gift';
const POOL_LABEL: Record<Pool, string> = { standard: 'From PokéStops & Gyms', adventure: 'Adventure Sync rewards', gift: 'Route gift exchange' };
const poolOf = (e: LiveEgg): Pool => (e.isAdventureSync ? 'adventure' : e.isGiftExchange ? 'gift' : 'standard');
const kmNum = (s: string) => parseFloat(s) || 99;

interface Hatch { e: LiveEgg; res: Resolved | null; best: { p: Pokemon; maxCp: number } | null }

/** Strongest member of the hatch's family (by max CP at level 50) — a proxy for long-term value. */
function bestOfFamily(data: GameData, p: Pokemon) {
  const fam = data.family(p.family).filter((x) => x.released);
  const list = fam.length ? fam : [p];
  let best = list[0], bestCp = cp(best, data.settings, 50);
  for (const x of list) { const c = cp(x, data.settings, 50); if (c > bestCp) { best = x; bestCp = c; } }
  return { p: best, maxCp: bestCp };
}

export default function Eggs() {
  const data = useData();
  const feed = useLive('eggs');
  const resolve = useResolver();
  const [shinyOnly, setShinyOnly] = useState(false);
  const [q, setQ] = useState('');

  const hatches = useMemo<Hatch[]>(() => (feed.data || []).map((e) => {
    const res = resolve(e.name, e.image);
    return { e, res, best: res ? bestOfFamily(data, res.pokemon) : null };
  }), [feed.data, resolve, data]);

  const groups = useMemo(() => {
    const s = q.trim().toLowerCase();
    const m = new Map<string, Hatch[]>();
    for (const h of hatches) {
      if (shinyOnly && !h.e.canBeShiny) continue;
      if (s && !h.e.name.toLowerCase().includes(s) && !h.res?.pokemon.types.some((t) => t === s)) continue;
      if (!m.has(h.e.eggType)) m.set(h.e.eggType, []);
      m.get(h.e.eggType)!.push(h);
    }
    return [...m.entries()].sort((a, b) => kmNum(a[0]) - kmNum(b[0]));
  }, [hatches, shinyOnly, q]);

  const summary = useMemo(() => {
    const m = new Map<string, { total: number; shiny: number; regional: number; maxRarity: number }>();
    for (const h of hatches) {
      const v = m.get(h.e.eggType) || { total: 0, shiny: 0, regional: 0, maxRarity: 0 };
      v.total++; if (h.e.canBeShiny) v.shiny++; if (h.e.isRegional) v.regional++;
      v.maxRarity = Math.max(v.maxRarity, h.e.rarity || 0);
      m.set(h.e.eggType, v);
    }
    return [...m.entries()].sort((a, b) => kmNum(a[0]) - kmNum(b[0]));
  }, [hatches]);

  const topValue = useMemo(() => {
    const seen = new Set<string>();
    return hatches.filter((h) => h.best && !seen.has(h.best.p.id) && seen.add(h.best.p.id))
      .sort((a, b) => b.best!.maxCp - a.best!.maxCp).slice(0, 8);
  }, [hatches]);

  // Hatches whose rarity tier is above the rest of their egg pool (a pool where everything shares a tier has no “rare” hatch).
  const rarest = useMemo(() => {
    const poolMin = new Map<string, number>();
    for (const h of hatches) if (h.e.rarity) poolMin.set(h.e.eggType, Math.min(poolMin.get(h.e.eggType) ?? 9, h.e.rarity));
    const by = new Map<string, { h: Hatch; eggs: string[]; rarity: number }>();
    for (const h of hatches) {
      const r = h.e.rarity || 0;
      if (!r || r <= (poolMin.get(h.e.eggType) ?? r)) continue;
      const v = by.get(h.e.name) || { h, eggs: [], rarity: 0 };
      if (!v.eggs.includes(h.e.eggType)) v.eggs.push(h.e.eggType);
      v.rarity = Math.max(v.rarity, r);
      by.set(h.e.name, v);
    }
    return [...by.values()].sort((a, b) => b.rarity - a.rarity).slice(0, 10);
  }, [hatches]);

  return (
    <div>
      <PageHeader title="Eggs" subtitle={hatches.length ? `${hatches.length} possible hatches across ${summary.length} egg types — rarity, shiny odds, regionals and hatch CP for each.` : 'What can hatch from each egg right now.'}
        actions={<FeedStatus {...feed} what="egg pool" />} />

      {!feed.data && feed.loading && <Spinner label="Loading egg pool…" />}
      {feed.data && !hatches.length && <Card><Empty icon="🥚">No egg data available right now.</Empty></Card>}

      {summary.length > 0 && (
        <>
          <div className="egg-summary" style={{ marginBottom: 16 }}>
            {summary.map(([km, v]) => (
              <a key={km} href={`#egg-${km.replace(/\s/g, '')}`} onClick={(ev) => { ev.preventDefault(); document.getElementById(`egg-${km.replace(/\s/g, '')}`)?.scrollIntoView({ behavior: 'smooth' }); }}>
                <StatTile label={<span className="row nowrap" style={{ gap: 6 }}>{km} egg</span>} value={<span className="row nowrap" style={{ gap: 8 }}><EggIconSmall km={km} />{v.total}</span>}
                  sub={<>{v.shiny} shiny-eligible{v.regional ? ` · ${v.regional} regional` : ''}</>} />
              </a>
            ))}
          </div>
          <div className="grid grid-2" style={{ marginBottom: 8, alignItems: 'start' }}>
            <Card title="🏆 Best long-term value" footer="Ranked by the highest max CP (level 50) in the hatch’s evolution family.">
              <ol className="cc-list">
                {topValue.map((h, i) => (
                  <li key={h.e.name + h.e.eggType} className="cc-row">
                    <span className="cc-rank">{i + 1}</span>
                    <span className="cc-mon"><Mon p={h.res!.pokemon} size={30} sub={h.best!.p.id !== h.res!.pokemon.id ? `→ ${displayName(h.best!.p)}` : 'Fully evolved'} /></span>
                    <span className="cc-score small"><span className="badge">{h.e.eggType}</span></span>
                  </li>
                ))}
              </ol>
            </Card>
            <Card title="💎 Rarest hatches" footer="Pokémon with a higher Leek Duck rarity tier than the rest of their egg pool (5 = rarest).">
              {rarest.length ? (
                <ol className="cc-list">
                  {rarest.map(({ h, eggs, rarity }) => (
                    <li key={h.e.name} className="cc-row" style={{ gridTemplateColumns: 'minmax(0,1fr) auto auto' }}>
                      <span className="cc-mon">{h.res ? <Mon p={h.res.pokemon} size={30} sub={h.e.canBeShiny ? '✨ Shiny available' : undefined} /> : h.e.name}</span>
                      <Rarity n={rarity} />
                      <span className="row nowrap" style={{ gap: 4 }}>{eggs.sort((a, b) => kmNum(a) - kmNum(b)).map((k) => <span key={k} className="badge">{k}</span>)}</span>
                    </li>
                  ))}
                </ol>
              ) : <div className="faint small">Every hatch in each pool currently shares the same rarity tier.</div>}
            </Card>
          </div>
        </>
      )}

      {hatches.length > 0 && (
        <div className="page-tools" style={{ marginTop: 18 }}>
          <input className="input" placeholder="Search Pokémon or type…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search hatches" />
          <Switch checked={shinyOnly} onChange={setShinyOnly} label="✨ Shiny-eligible only" />
          <JumpChips items={groups.map(([km, list]) => ({ id: `egg-${km.replace(/\s/g, '')}`, label: km, count: list.length }))} />
        </div>
      )}

      {groups.map(([km, list]) => {
        const pools = (['standard', 'adventure', 'gift'] as Pool[]).map((pl) => ({ pl, items: list.filter((h) => poolOf(h.e) === pl) })).filter((x) => x.items.length);
        return (
          <Card key={km} id={`egg-${km.replace(/\s/g, '')}`} style={{ marginBottom: 16, scrollMarginTop: 'calc(var(--header-h) + 12px)' }}
            title={<span className="egg-head"><EggIcon km={km} /><span>{km} Eggs <span className="faint small">{list.length} Pokémon</span></span></span>}>
            {pools.map(({ pl, items }) => (
              <div key={pl}>
                {(pools.length > 1 || pl !== 'standard') && <div className="subhead">{POOL_LABEL[pl]} <span className="faint">{items.length}</span></div>}
                <div className="reward-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))' }}>
                  {items.map((h) => <HatchTile key={h.e.name + pl} h={h} />)}
                </div>
              </div>
            ))}
          </Card>
        );
      })}
      {hatches.length > 0 && <p className="faint small">Hatched Pokémon are level {ENCOUNTERS.egg.level} with IVs of at least {ENCOUNTERS.egg.minIv}/{ENCOUNTERS.egg.minIv}/{ENCOUNTERS.egg.minIv}. Rarity tiers come from Leek Duck (5 = rarest).</p>}
    </div>
  );
}

function EggIconSmall({ km }: { km: string }) {
  return <span style={{ display: 'inline-flex', width: 20, height: 24 }}><EggIcon km={km} /></span>;
}

function HatchTile({ h }: { h: Hatch }) {
  const { settings } = useData();
  const { e, res } = h;
  const range = res ? cpRange(res.pokemon, settings, ENCOUNTERS.egg.level, ENCOUNTERS.egg.minIv) : e.combatPower;
  const inner = (
    <>
      <LiveSprite image={e.image} p={res?.pokemon} size={44} />
      <span className="info" style={{ flex: 1 }}>
        <span className="nm">{e.name}</span>
        <span className="sub num">CP {cpText(range)}</span>
        <span className="row" style={{ gap: 4, marginTop: 2 }}>
          {res && <Types types={res.pokemon.types} small />}
        </span>
      </span>
      <span className="col" style={{ gap: 3, alignItems: 'flex-end', flex: 'none' }}>
        {e.rarity ? <Rarity n={e.rarity} /> : null}
        {e.canBeShiny && <ShinyBadge small />}
        {e.isRegional && <span className="badge purple" title="Regional — only hatches in certain areas">Regional</span>}
      </span>
    </>
  );
  return res ? <Link to={`/dex/${res.pokemon.id}`} className="reward-tile">{inner}</Link> : <div className="reward-tile">{inner}</div>;
}

