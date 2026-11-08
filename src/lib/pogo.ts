// Core Pokémon GO formulas. Pure functions — pass in data from useData().
import type { GameData, PokeType, Pokemon, Settings, TypeChart } from './types';

export const TYPES: PokeType[] = ['normal', 'fighting', 'flying', 'poison', 'ground', 'rock', 'bug', 'ghost', 'steel', 'fire', 'water', 'grass', 'electric', 'psychic', 'ice', 'dragon', 'dark', 'fairy'];

export const WEATHERS = [
  { id: 'clear', name: 'Sunny / Clear', icon: '☀️' },
  { id: 'rainy', name: 'Rainy', icon: '🌧️' },
  { id: 'partly_cloudy', name: 'Partly Cloudy', icon: '⛅' },
  { id: 'overcast', name: 'Cloudy', icon: '☁️' },
  { id: 'windy', name: 'Windy', icon: '🌬️' },
  { id: 'snow', name: 'Snow', icon: '❄️' },
  { id: 'fog', name: 'Fog', icon: '🌫️' },
] as const;

/** Weather condition id → boosted types. Handles game master naming differences. */
export function weatherTypes(settings: Settings, weatherId: string): PokeType[] {
  const w = settings.weather;
  return w[weatherId] || w[weatherId === 'overcast' ? 'cloudy' : weatherId === 'cloudy' ? 'overcast' : weatherId] || [];
}
export function weatherFor(settings: Settings, type: PokeType): string | null {
  for (const [w, types] of Object.entries(settings.weather)) if (types.includes(type)) return w;
  return null;
}

// ---------------------------------------------------------------- levels & CP
export const LEVELS: number[] = Array.from({ length: 101 }, (_, i) => 1 + i * 0.5); // 1 … 51

export function cpmAt(settings: Settings, level: number): number {
  const v = settings.cpm[String(level)];
  if (v === undefined) throw new Error(`No CPM for level ${level}`);
  return v;
}

export interface Stats { atk: number; def: number; hp: number }

/** Effective stats (base + IV) × CPM. hp is floored like the game. */
export function stats(p: Pick<Pokemon, 'atk' | 'def' | 'sta'>, settings: Settings, level: number, ivs: [number, number, number] = [15, 15, 15]): Stats {
  const m = cpmAt(settings, level);
  return { atk: (p.atk + ivs[0]) * m, def: (p.def + ivs[1]) * m, hp: Math.max(10, Math.floor((p.sta + ivs[2]) * m)) };
}

export function cp(p: Pick<Pokemon, 'atk' | 'def' | 'sta'>, settings: Settings, level: number, ivs: [number, number, number] = [15, 15, 15]): number {
  const m = cpmAt(settings, level);
  const v = Math.floor(((p.atk + ivs[0]) * Math.sqrt(p.def + ivs[1]) * Math.sqrt(p.sta + ivs[2]) * m * m) / 10);
  return Math.max(10, v);
}

export function hp(p: Pick<Pokemon, 'sta'>, settings: Settings, level: number, ivSta = 15): number {
  return Math.max(10, Math.floor((p.sta + ivSta) * cpmAt(settings, level)));
}

/** CP range for encounters, e.g. raid catch (level 20 / 25 boosted) with IV floor 10 */
export function cpRange(p: Pokemon, settings: Settings, level: number, minIv: number) {
  return { min: cp(p, settings, level, [minIv, minIv, minIv]), max: cp(p, settings, level, [15, 15, 15]) };
}

/** Typical encounter levels */
export const ENCOUNTERS = {
  raid: { level: 20, boosted: 25, minIv: 10, label: 'Raid / Research breakthrough' },
  research: { level: 15, boosted: 15, minIv: 10, label: 'Field research' },
  egg: { level: 20, boosted: 20, minIv: 10, label: 'Egg hatch' },
  rocket: { level: 8, boosted: 13, minIv: 0, label: 'Shadow (Rocket)' },
  max: { level: 20, boosted: 25, minIv: 10, label: 'Max Battle' },
} as const;

// ---------------------------------------------------------------- type effectiveness
export function effectiveness(chart: TypeChart, atkType: PokeType, defTypes: PokeType[]): number {
  let m = 1;
  for (const t of defTypes) m *= chart[atkType]?.[t] ?? 1;
  return m;
}

/** For each attacking type, the multiplier against the given defender typing */
export function defensiveProfile(chart: TypeChart, defTypes: PokeType[]): { type: PokeType; mult: number }[] {
  return TYPES.map((t) => ({ type: t, mult: effectiveness(chart, t, defTypes) }));
}

/** Labels for multipliers like 2.56, 1.6, 0.625, 0.39, 0.244 */
export function multLabel(m: number): string {
  const r = Math.round(m * 1000) / 1000;
  if (r >= 2.5) return '×2.56';
  if (r >= 1.59) return '×1.6';
  if (r > 0.99 && r < 1.01) return '×1';
  if (r >= 0.62) return '×0.625';
  if (r >= 0.38) return '×0.39';
  return '×0.244';
}

// ---------------------------------------------------------------- damage
export const SHADOW_ATK = 1.2;
export const SHADOW_DEF = 1 / 1.2;

export function pveDamage(power: number, atk: number, def: number, mult: number): number {
  return Math.floor(0.5 * power * (atk / def) * mult) + 1;
}
export function pvpDamage(power: number, atk: number, def: number, mult: number): number {
  return Math.floor(0.5 * power * (atk / def) * mult * 1.3) + 1;
}

// ---------------------------------------------------------------- power-up costs
export interface UpgradeCost { dust: number; candy: number; xl: number; steps: number }

/** Cost to power up from level `from` to `to` (0.5 steps). */
export function upgradeCost(settings: Settings, p: Pick<Pokemon, 'speciesId'> | null, from: number, to: number, opts: { shadow?: boolean; purified?: boolean; lucky?: boolean } = {}): UpgradeCost {
  const u = settings.upgrade;
  const ov = p ? u.overrides[p.speciesId] : undefined;
  const candyArr = ov?.candy || u.candy;
  const xlArr = ov?.xl || u.xl;
  const dustArr = ov?.dust || u.dust;
  let dust = 0, candy = 0, xl = 0, steps = 0;
  for (let L = from; L < to; L += 0.5) {
    const i = Math.round((L - 1) * 2); // step index
    const lvlIdx = Math.floor(i / 2);
    let d = dustArr[lvlIdx] ?? 0;
    let c = L < 40 ? candyArr[lvlIdx] ?? 0 : 0;
    let x = L >= 40 ? xlArr[lvlIdx - 39] ?? 0 : 0;
    if (opts.shadow) { d = Math.ceil(d * u.shadowMult); c = Math.ceil(c * u.shadowCandyMult); x = Math.ceil(x * u.shadowCandyMult); }
    if (opts.purified) { d = Math.ceil(d * u.purifiedMult); c = Math.ceil(c * u.purifiedCandyMult); x = Math.ceil(x * u.purifiedCandyMult); }
    if (opts.lucky) d = Math.ceil(d * u.luckyDustMult);
    dust += d; candy += c; xl += x; steps++;
  }
  return { dust, candy, xl, steps };
}

/** Stardust cost of one power-up at a given level (used to narrow IV calc) */
export function dustAtLevel(settings: Settings, level: number): number {
  return settings.upgrade.dust[Math.floor(level - 1)] ?? 0;
}

// ---------------------------------------------------------------- IV calculator
export interface IvMatch { level: number; ivs: [number, number, number]; cp: number; hp: number; percent: number }

export interface IvQuery {
  cp: number;
  hp?: number;
  dust?: number;            // power-up stardust cost shown in game
  minLevel?: number; maxLevel?: number;
  halfLevels?: boolean;     // allow x.5 levels (false for wild catches with no power-up)
  appraisal?: { stars?: 0 | 1 | 2 | 3 | 4; best?: ('atk' | 'def' | 'sta')[]; minIv?: number };
  shadow?: boolean; purified?: boolean; lucky?: boolean;
}

/** Brute-force IV/level search. Returns every (level, IV) consistent with the inputs. */
export function solveIvs(p: Pokemon, settings: Settings, q: IvQuery): IvMatch[] {
  const res: IvMatch[] = [];
  const minL = q.minLevel ?? 1, maxL = q.maxLevel ?? 51;
  for (const L of LEVELS) {
    if (L < minL || L > maxL) continue;
    if (q.halfLevels === false && L % 1 !== 0) continue;
    if (q.dust) {
      let d = dustAtLevel(settings, L);
      if (q.shadow) d = Math.ceil(d * settings.upgrade.shadowMult);
      if (q.purified) d = Math.ceil(d * settings.upgrade.purifiedMult);
      if (q.lucky) d = Math.ceil(d * settings.upgrade.luckyDustMult);
      if (d !== q.dust) continue;
    }
    const m = cpmAt(settings, L);
    for (let s = 0; s < 16; s++) {
      const h = Math.max(10, Math.floor((p.sta + s) * m));
      if (q.hp && h !== q.hp) continue;
      for (let a = 0; a < 16; a++) for (let d = 0; d < 16; d++) {
        const c = Math.max(10, Math.floor(((p.atk + a) * Math.sqrt(p.def + d) * Math.sqrt(p.sta + s) * m * m) / 10));
        if (c !== q.cp) continue;
        const ivs: [number, number, number] = [a, d, s];
        if (q.appraisal && !appraisalMatches(ivs, q.appraisal)) continue;
        if (q.appraisal?.minIv !== undefined && (a < q.appraisal.minIv || d < q.appraisal.minIv || s < q.appraisal.minIv)) continue;
        res.push({ level: L, ivs, cp: c, hp: h, percent: ivPercent(ivs) });
      }
    }
  }
  return res.sort((x, y) => y.percent - x.percent || x.level - y.level);
}

export const ivPercent = (ivs: [number, number, number]) => Math.round(((ivs[0] + ivs[1] + ivs[2]) / 45) * 1000) / 10;

/** In-game appraisal stars: 0★ 0-22, 1★ 23-29, 2★ 30-36, 3★ 37-44, 4★ (hundo) 45 */
export function appraisalStars(ivs: [number, number, number]): 0 | 1 | 2 | 3 | 4 {
  const t = ivs[0] + ivs[1] + ivs[2];
  if (t === 45) return 4;
  if (t >= 37) return 3;
  if (t >= 30) return 2;
  if (t >= 23) return 1;
  return 0;
}

function appraisalMatches(ivs: [number, number, number], a: NonNullable<IvQuery['appraisal']>): boolean {
  if (a.stars !== undefined && appraisalStars(ivs) !== a.stars) return false;
  if (a.best && a.best.length) {
    const max = Math.max(...ivs);
    const keys = ['atk', 'def', 'sta'] as const;
    for (let i = 0; i < 3; i++) {
      const isBest = ivs[i] === max;
      if (a.best.includes(keys[i]) !== isBest) return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------- PvP IV ranking
export interface PvpIvRow { rank: number; ivs: [number, number, number]; level: number; cp: number; atk: number; def: number; hp: number; product: number; pct: number }

export interface PvpRankOptions { cap: number; maxLevel?: number; minIv?: number; shadow?: boolean }

const pvpCache = new Map<string, PvpIvRow[]>();
/**
 * Rank all IV combinations by stat product under a CP cap.
 * maxLevel 50 (51 with best buddy). minIv for trade/raid floors (e.g. 1 for good friend, 10 for raids).
 */
export function rankPvpIvs(p: Pokemon, settings: Settings, o: PvpRankOptions): PvpIvRow[] {
  const maxLevel = o.maxLevel ?? 50;
  const minIv = o.minIv ?? 0;
  const key = `${p.id}|${o.cap}|${maxLevel}|${minIv}`;
  const cached = pvpCache.get(key);
  if (cached) return cached;
  const levels = LEVELS.filter((l) => l <= maxLevel);
  const rows: PvpIvRow[] = [];
  for (let a = minIv; a < 16; a++) for (let d = minIv; d < 16; d++) for (let s = minIv; s < 16; s++) {
    // highest level under cap (binary search: CP monotonic in level)
    let lo = 0, hi = levels.length - 1, best = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (cp(p, settings, levels[mid], [a, d, s]) <= o.cap) { best = mid; lo = mid + 1; } else hi = mid - 1;
    }
    if (best < 0) continue;
    const L = levels[best];
    const st = stats(p, settings, L, [a, d, s]);
    rows.push({ rank: 0, ivs: [a, d, s], level: L, cp: cp(p, settings, L, [a, d, s]), atk: st.atk, def: st.def, hp: st.hp, product: st.atk * st.def * st.hp, pct: 0 });
  }
  rows.sort((x, y) => y.product - x.product || y.atk - x.atk || (y.ivs[0] + y.ivs[1] + y.ivs[2]) - (x.ivs[0] + x.ivs[1] + x.ivs[2]));
  const top = rows[0]?.product || 1;
  rows.forEach((r, i) => { r.rank = i + 1; r.pct = (r.product / top) * 100; });
  if (pvpCache.size > 150) pvpCache.delete(pvpCache.keys().next().value!); // bound memory
  pvpCache.set(key, rows);
  return rows;
}

export const LEAGUES = [
  { key: 'little', name: 'Little League', cap: 500 },
  { key: 'great', name: 'Great League', cap: 1500 },
  { key: 'ultra', name: 'Ultra League', cap: 2500 },
  { key: 'master', name: 'Master League', cap: 10000 },
] as const;

// ---------------------------------------------------------------- trading
export const TRADE_DUST = {
  // Stardust by friendship level [Good, Great, Ultra, Best]. Regular trades cost a flat 100;
  // the friendship discounts (Great 20%, Ultra 92%, Best 96%) apply to the 20k / 1M base costs.
  levels: ['Good', 'Great', 'Ultra', 'Best'],
  regular: [100, 100, 100, 100],
  newDex: [20000, 16000, 1600, 800],
  special: [20000, 16000, 1600, 800],
  specialNew: [1000000, 800000, 80000, 40000],
  minIv: [1, 2, 3, 5],
};

// ---------------------------------------------------------------- misc
export function trainerLevelFromXp(settings: Settings, totalXp: number): number {
  let lvl = 1;
  settings.xp.forEach((req, i) => { if (totalXp >= req) lvl = i + 1; });
  return lvl;
}

export const SPECIAL_TAGS = (p: Pokemon) => {
  const t: string[] = [];
  if (p.class === 'legendary') t.push('Legendary');
  if (p.class === 'mythical') t.push('Mythical');
  if (p.class === 'ultra_beast') t.push('Ultra Beast');
  if (p.megaOf) t.push(p.form === 'PRIMAL' ? 'Primal' : 'Mega');
  return t;
};

/** All Pokémon usable as attackers (released, optionally including shadow + mega variants) */
export function attackerPool(data: GameData, opts: { shadow?: boolean; mega?: boolean; unreleased?: boolean } = {}) {
  const out: { pokemon: Pokemon; shadow: boolean }[] = [];
  for (const p of data.pokemon) {
    if (!opts.unreleased && !p.released) continue;
    if (p.megaOf && !opts.mega) continue;
    out.push({ pokemon: p, shadow: false });
    if (opts.shadow && p.shadowReleased) out.push({ pokemon: p, shadow: true });
  }
  return out;
}
