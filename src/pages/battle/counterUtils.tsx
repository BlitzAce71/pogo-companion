// Shared raid-counter helpers for the battle + live pages: cached rankings, an idle work
// queue so many bosses can be ranked without freezing the UI, and a compact counters list.
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Mon, MoveTag, Spinner } from '../../components/ui';
import { fmt } from '../../lib/format';
import { RAID_TIERS, rankCounters, type BattleOptions, type CounterResult, type RaidTier } from '../../lib/pve';
import type { GameData, Pokemon } from '../../lib/types';
import './battle.css';

// ---------------------------------------------------------------- cache
const cache = new Map<string, unknown>();
const MAX_CACHE = 400;

function remember<T>(key: string, v: T): T {
  if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value as string);
  cache.set(key, v);
  return v;
}

export function optsKey(o: BattleOptions): string {
  return [o.attackerLevel, o.weather || '-', o.friendship ?? 1, (o.megaBoost || []).join('+') || '-', o.includeShadow ? 1 : 0, o.includeMega ? 1 : 0, o.includeElite === false ? 0 : 1, o.includeUnreleased ? 1 : 0].join('|');
}

/** rankCounters with a module-level cache (results are deterministic for the same inputs). */
export function cachedCounters(data: GameData, boss: Pokemon, tier: RaidTier, o: BattleOptions, fixed?: { fast?: string; charged?: string }, limit = 60): CounterResult[] {
  const key = `rc:${boss.id}:${tier.id}:${optsKey(o)}:${fixed?.fast || ''}:${fixed?.charged || ''}:${limit}`;
  const hit = cache.get(key) as CounterResult[] | undefined;
  if (hit) return hit;
  return remember(key, rankCounters(data, boss, tier, o, fixed, limit));
}

export const peekCache = <T,>(key: string) => cache.get(key) as T | undefined;

// ---------------------------------------------------------------- idle queue
// Jobs run one at a time with a macrotask gap between them, so input stays responsive.
const queue: { run: () => void; cancelled: boolean }[] = [];
let pumping = false;
function pump() {
  const job = queue.shift();
  if (!job) { pumping = false; return; }
  pumping = true;
  setTimeout(() => {
    if (!job.cancelled) { try { job.run(); } catch (e) { console.error(e); } }
    pump();
  }, 0);
}
function schedule(run: () => void) {
  const job = { run, cancelled: false };
  queue.push(job);
  if (!pumping) pump();
  return () => { job.cancelled = true; };
}

/**
 * Compute a (heavy) value lazily on the idle queue and memoise it under `key`.
 * Returns undefined while pending (or when not enabled).
 */
export function useQueued<T>(key: string, compute: () => T, enabled = true): T | undefined {
  const [state, setState] = useState<{ key: string; value: T | undefined }>(() => ({ key, value: cache.get(key) as T | undefined }));
  useEffect(() => {
    const hit = cache.get(key) as T | undefined;
    if (hit !== undefined) { setState({ key, value: hit }); return; }
    setState({ key, value: undefined });
    if (!enabled) return;
    return schedule(() => setState({ key, value: remember(key, compute()) }));
  }, [key, enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  return state.key === key ? state.value : (cache.get(key) as T | undefined);
}

export const tierById = (id: string) => RAID_TIERS.find((t) => t.id === id) || RAID_TIERS[3];

// ---------------------------------------------------------------- compact list
export function CompactCounters({ rows, loading, limit = 6, footer, showMoves = true }: { rows: CounterResult[] | undefined; loading?: boolean; limit?: number; footer?: ReactNode; showMoves?: boolean }) {
  if (!rows) return loading === false ? null : <Spinner label="Ranking counters…" />;
  if (!rows.length) return <div className="faint small" style={{ padding: 8 }}>No counters found.</div>;
  const top = rows[0].er;
  return (
    <div>
      <ol className="cc-list">
        {rows.slice(0, limit).map((r, i) => (
          <li key={r.pokemon.id + (r.shadow ? 's' : '')} className="cc-row">
            <span className="cc-rank">{i + 1}</span>
            <span className="cc-mon"><Mon p={r.pokemon} shadow={r.shadow} size={28}
              sub={showMoves ? <span className="cc-moves"><MoveTag id={r.fast.id} elite={r.pokemon.eliteFast.includes(r.fast.id)} link={false} /> <span className="faint">·</span> <MoveTag id={r.charged.id} elite={r.pokemon.eliteCharged.includes(r.charged.id)} link={false} /></span> : undefined} /></span>
            <span className="cc-score num" title={`DPS ${fmt(r.dps, 1)} · TDO ${fmt(r.tdo)} · ${fmt((r.er / top) * 100)}% of #1`}>
              <span className="bold">{fmt(r.dps, 1)}</span><span className="faint tiny"> DPS</span>
            </span>
          </li>
        ))}
      </ol>
      {footer}
    </div>
  );
}

export function countersLink(boss: Pokemon, tier: RaidTier) {
  return `/counters?boss=${encodeURIComponent(boss.id)}&tier=${encodeURIComponent(tier.id)}`;
}

export function FullCountersLink({ boss, tier }: { boss: Pokemon; tier: RaidTier }) {
  return <Link className="btn sm" to={countersLink(boss, tier)}>Full counters →</Link>;
}
