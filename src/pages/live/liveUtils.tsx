// Helpers shared by the Live pages (raids, events, research, eggs, rocket, max battles).
import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { MultChip, PokeImg, TypeBadge } from '../../components/ui';
import { displayName, useData } from '../../lib/data';
import { timeAgo } from '../../lib/format';
import { resolveLiveName, type LiveRaid, type Resolved } from '../../lib/live';
import { defaultTier, RAID_TIERS, type RaidTier } from '../../lib/pve';
import { defensiveProfile, WEATHERS } from '../../lib/pogo';
import type { PokeType, Pokemon, TypeChart } from '../../lib/types';
import './live.css';

// ---------------------------------------------------------------- feed freshness
export function FeedStatus({ at, source, loading, refresh, what = 'data' }: { at: number; source: string; loading: boolean; refresh: () => void; what?: string }) {
  let label: ReactNode;
  if (!source && loading) label = 'Loading…';
  else if (source === 'live') label = <>Live {what} from Leek Duck · updated {timeAgo(at)}</>;
  else if (source === 'snapshot') label = <>Showing the bundled snapshot (couldn’t reach the live feed)</>;
  else label = 'No data yet';
  return (
    <div className="feed-status">
      <span className={`feed-dot ${source === 'live' ? 'ok' : source === 'snapshot' ? 'warn' : ''}`} aria-hidden />
      <span className="small muted" title={at ? new Date(at).toLocaleString() : undefined}>{label}</span>
      <button className="btn sm" onClick={refresh} disabled={loading} aria-label={`Refresh ${what}`}>
        {loading ? <span className="spinner sm-spin" aria-hidden /> : '↻'} Refresh
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- name resolution
/** Memoised resolver for a list of Leek Duck names → our Pokémon */
export function useResolver() {
  const data = useData();
  return useMemo(() => {
    const memo = new Map<string, Resolved | null>();
    return (name: string, image?: string): Resolved | null => {
      const k = name + '|' + (image || '');
      if (!memo.has(k)) memo.set(k, resolveLiveName(data, name, image));
      return memo.get(k)!;
    };
  }, [data]);
}

/** Sprite from the feed (form-accurate) with a fallback to our own sprite set. */
export function LiveSprite({ image, p, size = 48, shiny, shadow }: { image?: string; p?: Pokemon | null; size?: number; shiny?: boolean; shadow?: boolean }) {
  const [failed, setFailed] = useState(false);
  const img = !image || failed
    ? (p ? <PokeImg p={p} size={size} shiny={shiny} /> : <span className="poke-img missing" style={{ width: size, height: size, display: 'inline-block' }} />)
    : <img className="poke-img" src={image} width={size} height={size} alt="" loading="lazy" onError={() => setFailed(true)} />;
  if (!shadow) return img;
  return <span className="live-sprite shadow" style={{ width: size, height: size }}>{img}</span>;
}

/** Name of a live Pokémon, linked to the Pokédex when resolved */
export function LiveName({ name, r }: { name: string; r: Resolved | null }) {
  if (!r) return <span className="bold">{name}</span>;
  return <Link to={`/dex/${r.pokemon.id}`} className="bold live-name">{r.shadow ? `Shadow ${displayName(r.pokemon)}` : name.replace(/^Shadow /, 'Shadow ')}</Link>;
}

// ---------------------------------------------------------------- badges
export const ShinyBadge = ({ small }: { small?: boolean }) => <span className="badge warn" title="Shiny can be encountered">✨{small ? '' : ' Shiny'}</span>;

export function Rarity({ n, max = 5 }: { n: number; max?: number }) {
  return (
    <span className="rarity" title={`Rarity tier ${n} of ${max} (Leek Duck) — higher is rarer`} aria-label={`Rarity ${n} of ${max}`}>
      {Array.from({ length: max }, (_, i) => <i key={i} className={i < n ? 'on' : ''} />)}
    </span>
  );
}

// ---------------------------------------------------------------- type helpers
export function weaknesses(chart: TypeChart, types: PokeType[]) {
  return defensiveProfile(chart, types).filter((x) => x.mult > 1.001).sort((a, b) => b.mult - a.mult);
}
export function resistances(chart: TypeChart, types: PokeType[]) {
  return defensiveProfile(chart, types).filter((x) => x.mult < 0.999).sort((a, b) => a.mult - b.mult);
}

export function WeaknessList({ types, limit, small = true }: { types: PokeType[]; limit?: number; small?: boolean }) {
  const { types: chart } = useData();
  const w = weaknesses(chart, types);
  if (!w.length) return <span className="faint small">No weaknesses</span>;
  return (
    <span className="weak-list">
      {w.slice(0, limit ?? w.length).map((x) => (
        <span key={x.type} className="weak-item">
          <TypeBadge type={x.type} small={small} />
          {x.mult > 2 && <span className="mult x256 tiny-mult">×2.56</span>}
        </span>
      ))}
    </span>
  );
}

export function MultRow({ items }: { items: { type: PokeType; mult: number }[] }) {
  return <span className="weak-list">{items.map((x) => <span key={x.type} className="weak-item"><TypeBadge type={x.type} small /><MultChip m={x.mult} /></span>)}</span>;
}

// ---------------------------------------------------------------- weather
const WEATHER_ALIASES: Record<string, string> = {
  sunny: 'clear', clear: 'clear', rainy: 'rainy', rain: 'rainy', 'partly cloudy': 'partly_cloudy', partly_cloudy: 'partly_cloudy',
  cloudy: 'overcast', overcast: 'overcast', windy: 'windy', snow: 'snow', snowy: 'snow', fog: 'fog', foggy: 'fog',
};
export function weatherInfo(name: string) {
  const id = WEATHER_ALIASES[name.toLowerCase().replace(/_/g, ' ')] || WEATHER_ALIASES[name.toLowerCase()] || name;
  return WEATHERS.find((w) => w.id === id) || { id, name, icon: '🌡️' };
}
export function WeatherChips({ names }: { names: string[] }) {
  if (!names.length) return <span className="faint small">—</span>;
  return <span className="weak-list">{names.map((n) => { const w = weatherInfo(n); return <span key={n} className="chip weather-chip" style={{ cursor: 'default' }} title={`${w.name} weather boost`}>{w.icon} {w.name}</span>; })}</span>;
}

// ---------------------------------------------------------------- misc
export type CpRange = { min: number; max: number };
export function normCp(cp: unknown): { normal?: CpRange; boosted?: CpRange } {
  if (!cp || typeof cp !== 'object') return {};
  const c = cp as Record<string, unknown>;
  if ('normal' in c) return { normal: c.normal as CpRange, boosted: c.boosted as CpRange };
  if ('min' in c) return { normal: c as unknown as CpRange };
  return {};
}
export const cpText = (r?: CpRange) => (!r ? '—' : r.min === r.max ? `${r.max.toLocaleString()}` : `${r.min.toLocaleString()}–${r.max.toLocaleString()}`);

export const stripTags = (s: string) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').trim();

export function JumpChips({ items }: { items: { id: string; label: ReactNode; count?: number }[] }) {
  return (
    <nav className="chips jump-chips" aria-label="Jump to section">
      {items.map((i) => (
        <a key={i.id} className="chip" href={`#${i.id}`} onClick={(e) => { e.preventDefault(); document.getElementById(i.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>
          {i.label}{i.count !== undefined && <span className="faint">{i.count}</span>}
        </a>
      ))}
    </nav>
  );
}

// ---------------------------------------------------------------- raid tiers
/** Map a Leek Duck raid entry to one of our raid tiers. */
export function raidTierFor(r: LiveRaid, res: Resolved | null): RaidTier | null {
  const stars = r.tier.match(/(\d)/)?.[1];
  const shadow = res?.shadow || /^shadow\s/i.test(r.name) || /shadow/i.test(r.tier);
  const byId = (id: string) => RAID_TIERS.find((t) => t.id === id) || null;
  if (shadow) return byId(stars === '1' ? 'shadow1' : stars === '3' ? 'shadow3' : 'shadow5');
  if (/elite/i.test(r.tier)) return byId('elite');
  if (/mega|primal/i.test(r.tier) || res?.pokemon.megaOf) return byId(res?.pokemon.class || /legendary|primal/i.test(r.tier) ? 'mega5' : 'mega');
  if (stars && byId(stars)) return byId(stars);
  if (stars === '6') return byId('5');
  return res ? defaultTier(res.pokemon) : null;
}

