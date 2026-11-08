// Live, frequently-changing game info (events, raids, research, eggs, Team GO Rocket)
// from Leek Duck via the ScrapedDuck project. Falls back to the snapshot bundled at build time.
import { useEffect, useState } from 'react';
import { displayName } from './data';
import type { Costume, GameData, Pokemon } from './types';

export interface LiveMon { name: string; image: string; canBeShiny?: boolean; combatPower?: { min: number; max: number } | { normal: { min: number; max: number }; boosted: { min: number; max: number } } }
export interface LiveEvent {
  eventID: string; name: string; eventType: string; heading: string; link: string; image: string;
  start: string | null; end: string | null;
  extraData?: {
    generic?: { hasSpawns?: boolean; hasFieldResearchTasks?: boolean };
    raidbattles?: { bosses: LiveMon[]; shinies: LiveMon[] };
    spotlight?: { name: string; canBeShiny: boolean; image: string; bonus: string; list: LiveMon[] };
    communityday?: { spawns: LiveMon[]; bonuses: { text: string; image: string }[]; bonusDisclaimers?: string[]; shinies?: LiveMon[]; specialresearch?: unknown[] };
    breakthrough?: LiveMon & { list?: LiveMon[] };
    promocodes?: string[];
  };
}
export interface LiveRaid {
  name: string; tier: string; canBeShiny: boolean;
  types: { name: string; image: string }[];
  combatPower: { normal: { min: number; max: number }; boosted: { min: number; max: number } };
  boostedWeather: { name: string; image: string }[];
  image: string;
}
export interface LiveResearch { text: string; type?: string; rewards: (LiveMon & { type?: string; quantity?: number })[] }
export interface LiveEgg { name: string; eggType: string; isAdventureSync: boolean; image: string; canBeShiny: boolean; combatPower: { min: number; max: number }; isRegional: boolean; isGiftExchange: boolean; rarity?: number }
export interface LiveRocketMon { name: string; image: string; types: string[]; isEncounter: boolean; canBeShiny: boolean }
export interface LiveRocket { name: string; title: string; type: string; firstPokemon: LiveRocketMon[]; secondPokemon: LiveRocketMon[]; thirdPokemon: LiveRocketMon[] }

export interface LiveFeeds { events: LiveEvent[]; raids: LiveRaid[]; research: LiveResearch[]; eggs: LiveEgg[]; rocketLineups: LiveRocket[] }
export type FeedName = keyof LiveFeeds;

const REMOTE = (f: string) => `https://raw.githubusercontent.com/bigfoott/ScrapedDuck/data/${f}.json`;
const LOCAL = (f: string) => `${import.meta.env.BASE_URL}data/live/${f}.json`;
const CACHE_KEY = (f: string) => `pogo.live.${f}`;
const MAX_AGE = 30 * 60 * 1000; // 30 minutes

interface Cached<T> { at: number; data: T; source: 'live' | 'snapshot' }

function readCache<T>(f: string): Cached<T> | null {
  try { const s = localStorage.getItem(CACHE_KEY(f)); return s ? JSON.parse(s) : null; } catch { return null; }
}
function writeCache<T>(f: string, c: Cached<T>) {
  try { localStorage.setItem(CACHE_KEY(f), JSON.stringify(c)); } catch { /* quota */ }
}

const inflight = new Map<string, Promise<Cached<unknown>>>();
export async function fetchFeed<K extends FeedName>(f: K, force = false): Promise<Cached<LiveFeeds[K]>> {
  const cached = readCache<LiveFeeds[K]>(f);
  if (!force && cached && Date.now() - cached.at < MAX_AGE) return cached;
  const key = f + force;
  if (!inflight.has(key)) {
    inflight.set(key, (async () => {
      try {
        const res = await fetch(REMOTE(f), { cache: 'no-store' });
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        const c: Cached<LiveFeeds[K]> = { at: Date.now(), data, source: 'live' };
        writeCache(f, c);
        return c;
      } catch {
        if (cached) return cached;
        const res = await fetch(LOCAL(f));
        const data = await res.json();
        return { at: 0, data, source: 'snapshot' } as Cached<LiveFeeds[K]>;
      } finally {
        setTimeout(() => inflight.delete(key), 0);
      }
    })());
  }
  return inflight.get(key) as Promise<Cached<LiveFeeds[K]>>;
}

/** React hook for a live feed. `refresh()` forces a network fetch. */
export function useLive<K extends FeedName>(f: K) {
  const [state, setState] = useState<{ data: LiveFeeds[K] | null; at: number; source: string; loading: boolean }>(() => {
    const c = readCache<LiveFeeds[K]>(f);
    return { data: c?.data ?? null, at: c?.at ?? 0, source: c?.source ?? '', loading: true };
  });
  const load = (force: boolean) => {
    setState((s) => ({ ...s, loading: true }));
    fetchFeed(f, force).then((c) => setState({ data: c.data, at: c.at, source: c.source, loading: false }), () => setState((s) => ({ ...s, loading: false })));
  };
  useEffect(() => { load(false); }, [f]); // eslint-disable-line react-hooks/exhaustive-deps
  return { ...state, refresh: () => load(true) };
}

// ---------------------------------------------------------------- name → Pokémon resolution
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/♀/g, ' female').replace(/♂/g, ' male').replace(/[^a-z0-9]+/g, ' ').trim();

let nameIndex: { data: GameData; map: Map<string, Pokemon> } | null = null;
function index(data: GameData) {
  if (nameIndex?.data === data) return nameIndex.map;
  const map = new Map<string, Pokemon>();
  const add = (k: string, p: Pokemon) => { const n = norm(k); if (n && !map.has(n)) map.set(n, p); };
  // base forms first so they win ties
  const ordered = [...data.pokemon].sort((a, b) => (a.form ? 1 : 0) - (b.form ? 1 : 0));
  for (const p of ordered) {
    add(displayName(p), p);
    if (!p.form) add(p.name, p);
    if (p.formName) { add(`${p.formName} ${p.name}`, p); add(`${p.name} ${p.formName}`, p); add(`${p.name} (${p.formName})`, p); }
  }
  nameIndex = { data, map };
  return map;
}

export interface Resolved { pokemon: Pokemon; shadow: boolean; dynamax: boolean; gigantamax: boolean; costume?: Costume }

/** Map a Leek Duck Pokémon name (e.g. "Shadow Alolan Raichu", "Mega Charizard Y", "Gigantamax Snorlax") to our data. */
export function resolveLiveName(data: GameData, rawName: string, image?: string): Resolved | null {
  const map = index(data);
  let n = norm(rawName);
  const flags = { shadow: false, dynamax: false, gigantamax: false };
  const strip = (re: RegExp, k?: keyof typeof flags) => { if (re.test(n)) { n = n.replace(re, ' ').replace(/\s+/g, ' ').trim(); if (k) flags[k] = true; } };
  strip(/\bshadow\b/, 'shadow');
  strip(/\bgigantamax\b/, 'gigantamax');
  strip(/\bdynamax\b/, 'dynamax');
  strip(/\b(forme?|style|mode|cloak|plumage|size)\b/);
  // Costume / event sprite (pm25.cHOLIDAY_2016.icon.png, pm25.fPOP_STAR.icon.png)
  const cm = image?.match(/\/(pm\d+\.[cf][A-Z0-9_]+)(?:\.s)?\.icon\.png/);
  const costume = cm ? data.costumes?.find((c) => c.img === cm[1]) : undefined;
  if (costume && data.byId[costume.base]) return { pokemon: data.byId[costume.base], ...flags, costume };
  if (map.has(n)) return { pokemon: map.get(n)!, ...flags };
  // Image-based (pmNNN.fFORM.icon.png or pokemon_icon_NNN_FF.png)
  if (image) {
    const m = image.match(/\/(pm\d+(?:\.[cf][A-Z0-9_]+)?)(?:\.s)?\.icon\.png/);
    if (m) { const p = data.pokemon.find((x) => x.img === m[1]); if (p) return { pokemon: p, ...flags }; }
    const d = image.match(/pokemon_icon_(\d+)_(\d+)/) || image.match(/\/pm(\d+)\./);
    if (d) {
      const dex = Number(d[1]);
      const cands = data.pokemon.filter((x) => x.dex === dex);
      const words = n.split(' ');
      const best = cands.find((c) => c.formName && words.some((w) => norm(c.formName!).split(' ').includes(w))) || cands.find((c) => !c.form && !c.megaOf) || cands[0];
      if (best) return { pokemon: best, ...flags };
    }
  }
  // Word-subset fallback
  const words = n.split(' ');
  for (const [k, p] of map) if (words.every((w) => k.split(' ').includes(w))) return { pokemon: p, ...flags };
  return null;
}

// ---------------------------------------------------------------- event helpers
export const EVENT_TYPE_LABEL: Record<string, string> = {
  'community-day': 'Community Day', 'pokemon-spotlight-hour': 'Spotlight Hour', 'raid-hour': 'Raid Hour', 'raid-day': 'Raid Day',
  'raid-battles': 'Raid Battles', 'raid-weekend': 'Raid Weekend', 'go-battle-league': 'GO Battle League', event: 'Event',
  'timed-research': 'Timed Research', 'special-research': 'Special Research', research: 'Research', 'max-mondays': 'Max Monday',
  'max-battles': 'Max Battles', season: 'Season', 'go-pass': 'GO Pass', 'pokemon-go-tour': 'GO Tour', 'pokemon-go-fest': 'GO Fest',
  'wild-area': 'Wild Area', 'research-day': 'Research Day', 'live-event': 'Live Event', 'go-rocket-takeover': 'Rocket Takeover',
  'team-go-rocket': 'Team GO Rocket', 'elite-raids': 'Elite Raids', 'safari-zone': 'Safari Zone', 'ticketed-event': 'Ticketed',
  update: 'Update', 'location-specific': 'Local', 'city-safari': 'City Safari', 'potential-ultra-unlock': 'Ultra Unlock', 'bonus-hour': 'Bonus Hour',
};

/** Leek Duck dates are local-time ISO strings without a zone for most events (they start at local time everywhere). */
export function eventDate(s: string | null): Date | null {
  if (!s) return null;
  return new Date(s);
}

export function eventStatus(e: LiveEvent, now = Date.now()): 'live' | 'upcoming' | 'ended' {
  const st = eventDate(e.start)?.getTime() ?? 0;
  const en = eventDate(e.end)?.getTime() ?? Infinity;
  if (now < st) return 'upcoming';
  if (now > en) return 'ended';
  return 'live';
}
