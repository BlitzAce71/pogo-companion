import { useDeferredValue, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Card, copyText, Empty, Field, Mon, MoveTag, MultChip, PageHeader, PokeImg, PokemonPicker, Rank, Select, StatTile, Switch, TypeBadge, Types, useShowMore, useSort, useToast } from '../../components/ui';
import { displayName, movePool, moveName, useData } from '../../lib/data';
import { fmt } from '../../lib/format';
import { resolveLiveName, useLive } from '../../lib/live';
import { cpRange, defensiveProfile, weatherFor, weatherTypes, WEATHERS } from '../../lib/pogo';
import { defaultTier, estimateTrainers, RAID_TIERS, type BattleOptions, type CounterResult } from '../../lib/pve';
import { usePrefs, useStored } from '../../lib/storage';
import type { PokeType, Pokemon } from '../../lib/types';
import { cachedCounters, CompactCounters } from './counterUtils';
import { raidTierFor } from '../live/liveUtils';
import './battle.css';

const LEVELS = [40, 45, 50, 51];
const FRIEND_NAMES = ['No friend bonus', 'Good Friend', 'Great Friend', 'Ultra Friend', 'Best Friend'];
const RESULT_LIMIT = 400;

interface Opts { level: number; friend: number; weather: string; mega: string; shadow: boolean; megas: boolean; elite: boolean; unreleased: boolean; view: 'table' | 'type'; hideLegendary: boolean }

/**
 * Raid boss CP as displayed in game. Community-known formula:
 * floor((baseAtk + 15) × √(baseDef + 15) × √(tier HP) / 10)  (raid bosses have fixed 15 IVs, stamina = tier HP)
 */
function bossCp(p: Pokemon, hp: number) {
  return Math.floor(((p.atk + 15) * Math.sqrt(p.def + 15) * Math.sqrt(hp)) / 10);
}

export default function Counters() {
  const data = useData();
  const [prefs] = usePrefs();
  const [sp, setSp] = useSearchParams();
  const toast = useToast();
  const [stored, setStored] = useStored<Partial<Opts>>('counters.opts', {});
  const defaults: Opts = {
    level: LEVELS.reduce((a, b) => (Math.abs(b - prefs.attackerLevel) < Math.abs(a - prefs.attackerLevel) ? b : a), 40),
    friend: prefs.bestFriends ? 4 : 0, weather: '', mega: '', shadow: true, megas: true, elite: true, unreleased: prefs.showUnreleased, view: 'table', hideLegendary: false,
  };
  const o: Opts = { ...defaults, ...stored };
  const set = (patch: Partial<Opts>) => setStored((prev) => ({ ...prev, ...patch }));

  const boss = data.byId[sp.get('boss') || ''] || null;
  const tier = boss ? RAID_TIERS.find((t) => t.id === sp.get('tier')) || defaultTier(boss) : null;
  const bossPool = useMemo(() => (boss ? movePool(boss, true) : { fast: [], charged: [] }), [boss]);
  const fastParam = sp.get('fast') || '';
  const chargedParam = sp.get('charged') || '';
  const fast = bossPool.fast.includes(fastParam) ? fastParam : '';
  const charged = bossPool.charged.includes(chargedParam) ? chargedParam : '';

  const setParams = (patch: Record<string, string | null>) => {
    const n = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) { if (v) n.set(k, v); else n.delete(k); }
    setSp(n, { replace: true });
  };
  const pickBoss = (p: Pokemon | null, tierId?: string) => setParams({ boss: p?.id ?? null, tier: tierId ?? null, fast: null, charged: null });

  const friendship = data.settings.friendship.find((f) => f.level === o.friend)?.attack ?? 1;
  const battle: BattleOptions = useMemo(() => ({
    attackerLevel: o.level,
    weather: o.weather || null,
    friendship,
    megaBoost: o.mega ? data.byId[o.mega]?.types ?? null : null,
    includeShadow: o.shadow, includeMega: o.megas, includeElite: o.elite, includeUnreleased: o.unreleased,
  }), [o.level, o.weather, friendship, o.mega, o.shadow, o.megas, o.elite, o.unreleased, data.byId]);

  const input = useMemo(() => ({ boss, tier, battle, fixed: { fast: fast || undefined, charged: charged || undefined } }), [boss, tier, battle, fast, charged]);
  const deferred = useDeferredValue(input);
  const stale = deferred !== input;
  const results = useMemo(() => (deferred.boss && deferred.tier ? cachedCounters(data, deferred.boss, deferred.tier, deferred.battle, deferred.fixed, RESULT_LIMIT) : []), [data, deferred]);

  const megaOptions = useMemo(() => [{ id: '', label: 'No Mega in party' }, ...data.pokemon.filter((p) => p.megaOf && (p.released || o.unreleased)).sort((a, b) => displayName(a).localeCompare(displayName(b))).map((p) => ({ id: p.id, label: `${displayName(p)} — ${p.types.map(cap).join('/')}` }))], [data.pokemon, o.unreleased]);
  const boostedByWeather = o.weather ? weatherTypes(data.settings, o.weather) : [];
  const megaTypes = o.mega ? data.byId[o.mega]?.types ?? [] : [];

  return (
    <div>
      <PageHeader title="Raid Counters" subtitle="Best attackers for any raid boss, ranked with the comprehensive DPS model — weather, friendship, Mega boosts, shadows and legacy moves included."
        actions={boss ? <button className="btn sm" onClick={async () => toast.show((await copyText(location.href)) ? 'Link copied' : 'Copy failed')}>🔗 Copy link</button> : undefined} />
      {toast.node}

      <div className="split">
        <div className="col sticky-side" style={{ gap: 16 }}>
          <Card title="Raid boss">
            <div className="col" style={{ gap: 12 }}>
              <PokemonPicker value={boss} onChange={(p) => pickBoss(p)} placeholder="Search a raid boss…" filter={o.unreleased ? ANY : undefined} />
              {boss && tier && (
                <div className="fields" style={{ gridTemplateColumns: '1fr' }}>
                  <Field label="Raid tier" hint={`${fmt(tier.hp)} HP · ${tier.timer / 60} min timer · CPM ${tier.cpm}`}>
                    <Select value={tier.id} onChange={(v) => setParams({ tier: v })} options={RAID_TIERS.map((t) => ({ id: t.id, label: `${t.name}${t.id === defaultTier(boss).id ? ' (default)' : ''}` }))} />
                  </Field>
                  <Field label="Boss fast move">
                    <Select value={fast} onChange={(v) => setParams({ fast: v || null })} options={[{ id: '', label: 'Any (average of all)' }, ...bossPool.fast.map((id) => ({ id, label: moveLabel(data.moves, boss, id) }))]} />
                  </Field>
                  <Field label="Boss charged move">
                    <Select value={charged} onChange={(v) => setParams({ charged: v || null })} options={[{ id: '', label: 'Any (average of all)' }, ...bossPool.charged.map((id) => ({ id, label: moveLabel(data.moves, boss, id) }))]} />
                  </Field>
                </div>
              )}
            </div>
          </Card>

          <Card title="Battle settings">
            <div className="col" style={{ gap: 12 }}>
              <div className="fields" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
                <Field label="Weather" hint={boostedByWeather.length ? `Boosts ${boostedByWeather.map(cap).join(', ')}` : 'No weather boost'}>
                  <Select value={o.weather} onChange={(v) => set({ weather: v })} options={[{ id: '', label: 'None / Extreme' }, ...WEATHERS.map((w) => ({ id: w.id, label: `${w.icon} ${w.name}` }))]} />
                </Field>
                <Field label="Attacker level" hint="15/15/15 IVs">
                  <Select value={o.level} onChange={(v) => set({ level: v })} options={LEVELS.map((l) => ({ id: l, label: `Level ${l}${l === 51 ? ' (Best Buddy)' : ''}` }))} />
                </Field>
                <Field label="Friendship bonus">
                  <Select value={o.friend} onChange={(v) => set({ friend: v })} options={data.settings.friendship.map((f) => ({ id: f.level, label: `${FRIEND_NAMES[f.level] ?? `Friendship level ${f.level} (game files)`}${f.attack > 1 ? ` (+${fmt((f.attack - 1) * 100)}%)` : ''}` }))} />
                </Field>
                <Field label="Mega boost" hint={megaTypes.length ? `×1.3 ${megaTypes.map(cap).join('/')} moves, ×1.1 others` : 'Active Mega in the raid'}>
                  <Select value={o.mega} onChange={(v) => set({ mega: v })} options={megaOptions} />
                </Field>
              </div>
              <div className="ctr-toggles">
                <Switch checked={o.shadow} onChange={(v) => set({ shadow: v })} label="Shadows" />
                <Switch checked={o.megas} onChange={(v) => set({ megas: v })} label="Megas & Primals" />
                <Switch checked={o.elite} onChange={(v) => set({ elite: v })} label="Elite / legacy moves" />
                <Switch checked={o.unreleased} onChange={(v) => set({ unreleased: v })} label="Unreleased" />
                <Switch checked={o.hideLegendary} onChange={(v) => set({ hideLegendary: v })} label="Hide legendaries" />
              </div>
            </div>
          </Card>
        </div>

        <div className="col" style={{ gap: 16, minWidth: 0 }}>
          {!boss || !tier ? <NoBoss onPick={pickBoss} /> : (
            <>
              <BossInfo boss={boss} tierId={tier.id} results={results} level={o.level} />
              <ResultsCard results={results} stale={stale} view={o.view} setView={(v) => set({ view: v })} hideLegendary={o.hideLegendary} />
              <p className="faint small">
                DPS/TDO use the community “comprehensive DPS” model at level {o.level} with 15/15/15 IVs against a {tier.name} {displayName(boss)}
                {fast || charged ? ` using ${[fast, charged].filter(Boolean).map((m) => moveName(data.moves, m)).join(' / ')}` : ' averaged over all of its movesets'}.
                ER (equivalent rating) = (DPS³ × TDO)^¼ — it balances damage output and bulk. Real raids vary with dodging, relobbies and team size.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const ANY = () => true;

function moveLabel(moves: ReturnType<typeof useData>['moves'], p: Pokemon, id: string) {
  const elite = p.eliteFast.includes(id) || p.eliteCharged.includes(id);
  return `${moveName(moves, id)}${elite ? ' ★' : ''} · ${moves[id]?.type ?? ''}`;
}

// ---------------------------------------------------------------- empty state with live bosses
function NoBoss({ onPick }: { onPick: (p: Pokemon, tier?: string) => void }) {
  const data = useData();
  const raids = useLive('raids');
  const current = useMemo(() => {
    const out: { p: Pokemon; tier: string; label: string; shadow: boolean }[] = [];
    for (const r of raids.data || []) {
      const res = resolveLiveName(data, r.name, r.image);
      if (!res) continue;
      const tier = raidTierFor(r, res)?.id ?? defaultTier(res.pokemon).id;
      out.push({ p: res.pokemon, tier, label: r.name, shadow: res.shadow });
    }
    return out.reverse();
  }, [raids.data, data]);
  return (
    <Card>
      <Empty icon="🛡️">
        <div className="bold" style={{ color: 'var(--text)', marginBottom: 4 }}>Pick a raid boss to see its best counters</div>
        <div className="small">Search any Pokémon on the left, or start from a current raid boss:</div>
      </Empty>
      {current.length > 0 && (
        <div className="ctr-quick" style={{ justifyContent: 'center', paddingBottom: 12 }}>
          {current.map((c) => (
            <button key={c.label + c.tier} onClick={() => onPick(c.p, c.tier)} type="button">
              <PokeImg p={c.p} size={26} />{c.label}
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- boss info
function BossInfo({ boss, tierId, results, level }: { boss: Pokemon; tierId: string; results: CounterResult[]; level: number }) {
  const data = useData();
  const tier = RAID_TIERS.find((t) => t.id === tierId)!;
  const catchAs = (boss.megaOf && data.byId[boss.megaOf]) || boss;
  const normal = cpRange(catchAs, data.settings, 20, 10);
  const boosted = cpRange(catchAs, data.settings, 25, 10);
  const profile = defensiveProfile(data.types, boss.types);
  const weak = profile.filter((x) => x.mult > 1.001).sort((a, b) => b.mult - a.mult);
  const resist = profile.filter((x) => x.mult < 0.999).sort((a, b) => a.mult - b.mult);
  const weathers = [...new Set(boss.types.map((t) => weatherFor(data.settings, t)).filter(Boolean) as string[])];
  const trainers = results.length ? estimateTrainers(results, tier) : null;
  const shadowRaid = tier.id.startsWith('shadow');
  return (
    <Card title={<span className="row" style={{ gap: 8 }}>{shadowRaid ? 'Shadow ' : ''}{displayName(boss)} <span className="badge accent">{tier.stars}</span></span>}
      actions={<Link to={`/dex/${boss.id}`} className="btn sm">Pokédex →</Link>}>
      <div className="col" style={{ gap: 14 }}>
        <div className="ctr-boss">
          <div className="ctr-boss-art" style={{ ['--tc' as string]: `var(--t-${boss.types[0]})` }}><PokeImg p={boss} size={84} /></div>
          <div className="col" style={{ gap: 6, minWidth: 0 }}>
            <Types types={boss.types} />
            <div className="small muted num">Boss CP {fmt(bossCp(boss, tier.hp))} · {fmt(tier.hp)} HP · {tier.timer / 60} min</div>
            <div className="small muted">Atk {boss.atk} · Def {boss.def} · Sta {boss.sta}{shadowRaid ? ' · Shadow (takes 1.2× damage)' : ''}</div>
          </div>
        </div>

        <div className="grid grid-4">
          <StatTile label="Catch CP" value={<span className="num">{fmt(normal.min)}–{fmt(normal.max)}</span>} sub={`Level 20 · ${displayName(catchAs)}`} />
          <StatTile label="Weather boosted" value={<span className="num">{fmt(boosted.min)}–{fmt(boosted.max)}</span>} sub={weathers.map((w) => WEATHERS.find((x) => x.id === w || (w === 'cloudy' && x.id === 'overcast'))).filter(Boolean).map((w) => `${w!.icon} ${w!.name}`).join(' · ') || 'Level 25'} />
          <StatTile label="Trainers" value={trainers == null ? '…' : trainers === Infinity ? '—' : `~${trainers}`} sub={`Top-6 counters, L${level}`} />
          <StatTile label="Top DPS" value={results[0] ? fmt(results[0].dps, 1) : '…'} sub={results[0] ? displayName(results[0].pokemon, results[0].shadow) : ''} />
        </div>
        <div className="faint tiny">Catch CP assumes the 10/10/10 IV floor for raid encounters (level 25 when weather boosted). Trainer count is a rough estimate.</div>

        <div className="ctr-mult-grid">
          <span className="field-label">Weak to</span>
          <span className="row" style={{ gap: 6 }}>{weak.length ? weak.map((x) => <span key={x.type} className="row nowrap" style={{ gap: 3 }}><TypeBadge type={x.type} small /><MultChip m={x.mult} /></span>) : <span className="faint small">Nothing</span>}</span>
          <span className="field-label">Resists</span>
          <span className="row" style={{ gap: 6 }}>{resist.length ? resist.map((x) => <span key={x.type} className="row nowrap" style={{ gap: 3 }}><TypeBadge type={x.type} small /><MultChip m={x.mult} /></span>) : <span className="faint small">Nothing</span>}</span>
          <span className="field-label">Moves</span>
          <span className="row" style={{ gap: '4px 12px' }}>
            {[...boss.fast, ...boss.eliteFast].map((m) => <MoveTag key={m} id={m} elite={boss.eliteFast.includes(m)} />)}
            <span className="faint">|</span>
            {[...boss.charged, ...boss.eliteCharged].map((m) => <MoveTag key={m} id={m} elite={boss.eliteCharged.includes(m)} />)}
          </span>
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- results
interface Row { r: CounterResult; rank: number; pct: number }

function ResultsCard({ results, stale, view, setView, hideLegendary }: { results: CounterResult[]; stale: boolean; view: 'table' | 'type'; setView: (v: 'table' | 'type') => void; hideLegendary: boolean }) {
  const [q, setQ] = useState('');
  const rows = useMemo<Row[]>(() => {
    const top = results[0]?.er || 1;
    const s = q.trim().toLowerCase();
    return results
      .map((r, i) => ({ r, rank: i + 1, pct: (r.er / top) * 100 }))
      .filter(({ r }) => (!hideLegendary || !r.pokemon.class) && (!s || displayName(r.pokemon, r.shadow).toLowerCase().includes(s) || r.pokemon.types.some((t) => t === s) || r.fast.name.toLowerCase().includes(s) || r.charged.name.toLowerCase().includes(s)));
  }, [results, q, hideLegendary]);

  return (
    <Card title="Top counters" className={stale ? 'stale' : ''}
      actions={<div className="seg" role="tablist">
        <button type="button" className={view === 'table' ? 'on' : ''} onClick={() => setView('table')}>Ranking</button>
        <button type="button" className={view === 'type' ? 'on' : ''} onClick={() => setView('type')}>Best per type</button>
      </div>} flush>
      {view === 'table' ? (
        <>
          <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border-soft)' }}>
            <input className="input sm" placeholder="Filter by name, type or move…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter counters" />
          </div>
          <RankingTable rows={rows} />
        </>
      ) : <TypeView results={results.filter((r) => !hideLegendary || !r.pokemon.class)} />}
    </Card>
  );
}

function RankingTable({ rows }: { rows: Row[] }) {
  const { sorted, th } = useSort(rows, { key: 'er', dir: -1 }, {
    rank: (x) => x.rank, name: (x) => displayName(x.r.pokemon, x.r.shadow), dps: (x) => x.r.dps, tdo: (x) => x.r.tdo, er: (x) => x.r.er,
  });
  const { visible, more } = useShowMore(sorted, 30);
  if (!rows.length) return <Empty>No attackers match.</Empty>;
  return (
    <>
      <div className="table-wrap">
        <table className="table ctr-table">
          <thead>
            <tr>
              {th('rank', '#', { num: true })}
              {th('name', 'Pokémon')}
              <th>Moveset</th>
              {th('dps', 'DPS', { num: true, title: 'Damage per second' })}
              {th('tdo', 'TDO', { num: true, title: 'Total damage output before fainting' })}
              {th('er', 'ER', { num: true, title: 'Equivalent rating: (DPS³ × TDO)^¼' })}
              <th className="num hide-mobile">% of #1</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(({ r, rank, pct }) => (
              <tr key={r.pokemon.id + (r.shadow ? '-s' : '')}>
                <td className="num"><Rank n={rank} /></td>
                <td><Mon p={r.pokemon} shadow={r.shadow} size={34} showTypes /></td>
                <td>
                  <div className="ctr-moves">
                    <MoveTag id={r.fast.id} elite={r.pokemon.eliteFast.includes(r.fast.id)} />
                    <MoveTag id={r.charged.id} elite={r.pokemon.eliteCharged.includes(r.charged.id)} />
                  </div>
                </td>
                <td className="num bold">{fmt(r.dps, 2)}</td>
                <td className="num">{fmt(r.tdo)}</td>
                <td className="num">{fmt(r.er, 2)}</td>
                <td className="num hide-mobile">
                  <div className="ctr-pct"><span>{fmt(pct, 1)}%</span><div className="progress"><div style={{ width: `${pct}%`, background: pct >= 90 ? 'var(--good)' : pct >= 75 ? 'var(--accent)' : 'var(--text-3)' }} /></div></div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {more}
    </>
  );
}

function TypeView({ results }: { results: CounterResult[] }) {
  const groups = useMemo(() => {
    const m = new Map<PokeType, CounterResult[]>();
    for (const r of results) {
      const t = r.charged.type;
      if (!m.has(t)) m.set(t, []);
      const list = m.get(t)!;
      if (list.length < 6) list.push(r);
    }
    return [...m.entries()].sort((a, b) => b[1][0].er - a[1][0].er);
  }, [results]);
  if (!groups.length) return <Empty>No attackers.</Empty>;
  const top = results[0]?.er || 1;
  return (
    <div className="card-body">
      <p className="faint small" style={{ marginTop: 0 }}>Top attackers grouped by the type of their charged move, strongest type first.</p>
      <div className="grid grid-auto" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
        {groups.map(([t, list]) => (
          <div key={t} className="tile ctr-type-group">
            <div className="ctr-type-head">
              <TypeBadge type={t} />
              <span className="spacer" />
              <span className="small faint num">best {fmt((list[0].er / top) * 100)}% of #1</span>
            </div>
            <CompactCounters rows={list} limit={6} />
          </div>
        ))}
      </div>
    </div>
  );
}
