// Helpers shared by the PvP pages (rankings, IV ranker, simulator, team builder).
// Pure functions only — React widgets live in ./pvpUi.tsx, the battle engine in ./sim.ts.
import { LEVELS, cp, stats } from '../../lib/pogo';
import type { GameData, Move, PokeType, Pokemon, RankingRow, Settings } from '../../lib/types';
import type { Combatant, SimMove } from './sim';

// ---------------------------------------------------------------- leagues / formats
export interface Format { key: string; title: string; cp: number; cup: string; main: boolean }

const MAIN_ORDER = ['great', 'ultra', 'master', 'little'];

/** All ranking sets from settings.rankings, Great/Ultra/Master/Little first, then cups. */
export function formats(settings: Settings): Format[] {
  const list = (settings.rankings || []).map((r) => ({ key: r.key, title: r.title, cp: r.cp, cup: r.cup, main: MAIN_ORDER.includes(r.key) }));
  return list.sort((a, b) => {
    const ia = MAIN_ORDER.indexOf(a.key), ib = MAIN_ORDER.indexOf(b.key);
    if (ia >= 0 || ib >= 0) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    return a.cp - b.cp || a.title.localeCompare(b.title);
  });
}

export function formatByKey(settings: Settings, key: string | null | undefined): Format | null {
  return formats(settings).find((f) => f.key === key) || null;
}

/** The open-format ranking key for a CP cap (used for rank-1 IV links and fallback movesets). */
export function mainKeyForCap(capCp: number): string {
  if (capCp <= 500) return 'little';
  if (capCp <= 1500) return 'great';
  if (capCp <= 2500) return 'ultra';
  return 'master';
}

export const isUncapped = (capCp: number) => capCp >= 10000;

export const shortLeague = (capCp: number) => (capCp <= 500 ? 'LL' : capCp <= 1500 ? 'GL' : capCp <= 2500 ? 'UL' : 'ML');

// ---------------------------------------------------------------- moves
/** Types Hidden Power can roll (every type except Normal and Fairy). */
export const HIDDEN_POWER_TYPES: PokeType[] = ['fighting', 'flying', 'poison', 'ground', 'rock', 'bug', 'ghost', 'steel', 'fire', 'water', 'grass', 'electric', 'psychic', 'ice', 'dragon', 'dark'];

// PvPoke uses a few move ids that are not separate entries in the game master.
const MOVE_ALIASES: Record<string, string> = { TECHNO_BLAST_DOUSE: 'TECHNO_BLAST_WATER' };

/** Our moves.json id that a (possibly PvPoke-specific) move id should link to. */
export function baseMoveId(id: string): string {
  if (/^HIDDEN_POWER_(?!FAST$)/.test(id)) return 'HIDDEN_POWER_FAST';
  return MOVE_ALIASES[id] || id;
}

const simMoveCache = new Map<string, SimMove | null>();
/** Resolve a move id to its Trainer Battle stats. Handles typed Hidden Power ids (HIDDEN_POWER_GRASS …). */
export function simMove(moves: Record<string, Move>, id: string | undefined | null): SimMove | null {
  if (!id || id === 'none') return null;
  if (simMoveCache.has(id)) return simMoveCache.get(id)!;
  let out: SimMove | null = null;
  const hp = /^HIDDEN_POWER_([A-Z]+)$/.exec(id);
  if (hp && hp[1] !== 'FAST') {
    const base = moves.HIDDEN_POWER_FAST;
    const t = hp[1].toLowerCase() as PokeType;
    if (base?.pvp) out = { id, baseId: base.id, name: `Hidden Power (${t[0].toUpperCase()}${t.slice(1)})`, type: t, fast: true, power: base.pvp.power, energy: base.pvp.energy, turns: base.pvp.turns || 1 };
  } else {
    const m = moves[MOVE_ALIASES[id] || id];
    if (m?.pvp) out = { id, baseId: m.id, name: m.name, type: m.type, fast: m.fast, power: m.pvp.power, energy: m.pvp.energy, turns: m.fast ? Math.max(1, m.pvp.turns || 1) : 1, buffs: m.pvp.buffs };
  }
  simMoveCache.set(id, out);
  return out;
}

/** Fast moves needed (from 0 energy) to afford a charged move. */
export const fastsPerCharged = (fast: SimMove | null, charged: SimMove | null) =>
  fast && charged && fast.energy > 0 ? Math.ceil(charged.energy / fast.energy) : null;

/** Fast + charged move ids the Pokémon can learn (incl. elite / legacy, Return/Frustration and typed Hidden Power). */
export function learnable(p: Pokemon, shadow: boolean, moves: Record<string, Move>): { fast: string[]; charged: string[] } {
  const fast = [...p.fast, ...p.eliteFast];
  const charged = [...p.charged, ...p.eliteCharged];
  const out = { fast: [] as string[], charged: [] as string[] };
  for (const f of fast) {
    if (f === 'HIDDEN_POWER_FAST') out.fast.push(...HIDDEN_POWER_TYPES.map((t) => `HIDDEN_POWER_${t.toUpperCase()}`));
    else out.fast.push(f);
  }
  out.charged = [...charged];
  if (shadow && !out.charged.includes('FRUSTRATION')) out.charged.push('FRUSTRATION');
  if (!shadow && p.shadowReleased && !out.charged.includes('RETURN')) out.charged.push('RETURN');
  out.fast = out.fast.filter((id) => simMove(moves, id));
  out.charged = out.charged.filter((id) => simMove(moves, id));
  return out;
}

/** Simple heuristic moveset when PvPoke has no recommendation. Not a game number — documented heuristic:
 *  fast = best (STAB damage/turn + energy/turn); charged = best STAB damage-per-energy, plus the best
 *  remaining move of a different type (coverage), else the next best. */
export function heuristicMoveset(p: Pokemon, shadow: boolean, moves: Record<string, Move>): string[] {
  const pool = learnable(p, shadow, moves);
  const stab = (m: SimMove) => (p.types.includes(m.type) ? 1.2 : 1);
  const fast = [...pool.fast].map((id) => simMove(moves, id)!).sort((a, b) => (b.power * stab(b) + b.energy) / b.turns - (a.power * stab(a) + a.energy) / a.turns)[0];
  const ch = pool.charged.filter((id) => id !== 'FRUSTRATION').map((id) => simMove(moves, id)!)
    .sort((a, b) => (b.power * stab(b)) / Math.max(1, b.energy) - (a.power * stab(a)) / Math.max(1, a.energy));
  const first = ch[0];
  const second = first ? ch.find((m) => m !== first && m.type !== first.type) || ch.find((m) => m !== first) : undefined;
  return [fast?.id || '', first?.id || (pool.charged[0] ?? ''), second?.id || ''];
}

// ---------------------------------------------------------------- rankings lookups
export function rowFor(rows: RankingRow[] | null | undefined, id: string, shadow: boolean): RankingRow | null {
  if (!rows) return null;
  return rows.find((r) => r.id === id && !!r.sh === shadow) || null;
}

/** Recommended moveset: rankings row (exact shadow variant, else the other variant), else heuristic. */
export function recommendedMoveset(data: GameData, rows: RankingRow[] | null | undefined, p: Pokemon, shadow: boolean): { moves: string[]; source: 'rankings' | 'heuristic' } {
  const r = rowFor(rows, p.id, shadow) || rowFor(rows, p.id, !shadow);
  if (r) {
    const ms = r.m.filter((m) => simMove(data.moves, m));
    if (ms.length >= 2) {
      let charged = ms.slice(1);
      // Frustration/Return depend on the shadow flag
      charged = charged.map((m) => (shadow && m === 'RETURN' ? 'FRUSTRATION' : !shadow && m === 'FRUSTRATION' ? 'RETURN' : m));
      return { moves: [ms[0], ...charged], source: 'rankings' };
    }
  }
  return { moves: heuristicMoveset(p, shadow, data.moves), source: 'heuristic' };
}

// ---------------------------------------------------------------- IVs & levels
export type Ivs = [number, number, number];

export interface IvPick { ivs: Ivs; level: number; cp: number; atk: number; def: number; hp: number; product: number }

const levelTables = new WeakMap<Settings, Map<number, { levels: number[]; cpm: number[] }>>();
/** Levels ≤ maxLevel and their CP multipliers (cached per settings object). */
function levelTable(settings: Settings, maxLevel: number) {
  let byMax = levelTables.get(settings);
  if (!byMax) { byMax = new Map(); levelTables.set(settings, byMax); }
  let t = byMax.get(maxLevel);
  if (!t) {
    const levels = LEVELS.filter((l) => l <= maxLevel && settings.cpm[String(l)] !== undefined);
    t = { levels, cpm: levels.map((l) => settings.cpm[String(l)]) };
    byMax.set(maxLevel, t);
  }
  return t;
}

/** Same arithmetic (and float order) as lib/pogo cp(), on a pre-looked-up CPM. */
const cpFast = (A: number, sqD: number, sqS: number, m: number) => Math.max(10, Math.floor((A * sqD * sqS * m * m) / 10));

function maxLevelIndex(t: { cpm: number[] }, A: number, sqD: number, sqS: number, capCp: number): number {
  let lo = 0, hi = t.cpm.length - 1, best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cpFast(A, sqD, sqS, t.cpm[mid]) <= capCp) { best = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return best;
}

/** Highest level ≤ maxLevel whose CP fits the cap, or null when even level 1 is over. */
export function maxLevelUnderCap(p: Pokemon, settings: Settings, ivs: Ivs, capCp: number, maxLevel = 50): number | null {
  const t = levelTable(settings, maxLevel);
  const i = maxLevelIndex(t, p.atk + ivs[0], Math.sqrt(p.def + ivs[1]), Math.sqrt(p.sta + ivs[2]), capCp);
  return i < 0 ? null : t.levels[i];
}

export function pickAt(p: Pokemon, settings: Settings, ivs: Ivs, level: number): IvPick {
  const s = stats(p, settings, level, ivs);
  return { ivs, level, cp: cp(p, settings, level, ivs), atk: s.atk, def: s.def, hp: s.hp, product: s.atk * s.def * s.hp };
}

const rank1Cache = new Map<string, IvPick | null>();
/**
 * Rank-1 (max stat product) IVs under a cap. Same ordering as rankPvpIvs (product, then attack)
 * but without allocating/sorting all 4096 rows — used where many Pokémon need defaults (team builder).
 */
export function rank1(p: Pokemon, settings: Settings, capCp: number, maxLevel = 50): IvPick | null {
  const key = `${p.id}|${capCp}|${maxLevel}`;
  if (rank1Cache.has(key)) return rank1Cache.get(key)!;
  let best: IvPick | null = null;
  if (isUncapped(capCp) || cp(p, settings, maxLevel, [15, 15, 15]) <= capCp) {
    best = pickAt(p, settings, [15, 15, 15], maxLevel);
  } else {
    const t = levelTable(settings, maxLevel);
    for (let a = 0; a < 16; a++) for (let d = 0; d < 16; d++) {
      const A = p.atk + a, sqD = Math.sqrt(p.def + d);
      for (let s = 0; s < 16; s++) {
        const i = maxLevelIndex(t, A, sqD, Math.sqrt(p.sta + s), capCp);
        if (i < 0) continue;
        const m = t.cpm[i];
        // identical to lib/pogo stats()
        const atk = A * m, def = (p.def + d) * m, hp = Math.max(10, Math.floor((p.sta + s) * m));
        const prod = atk * def * hp;
        if (!best || prod > best.product || (prod === best.product && atk > best.atk)) best = { ivs: [a, d, s], level: t.levels[i], cp: 0, atk, def, hp, product: prod };
      }
    }
    if (best) best.cp = cp(p, settings, best.level, best.ivs);
  }
  rank1Cache.set(key, best);
  return best;
}

/** Appraisal bar bucket used by the in-game search (0 = 0, 1 = 1–5, 2 = 6–10, 3 = 11–14, 4 = 15). */
export const ivBucket = (v: number) => (v <= 0 ? 0 : v <= 5 ? 1 : v <= 10 ? 2 : v <= 14 ? 3 : 4);

/** IV floors for common sources (community-known minimums). */
export const IV_FLOORS: { id: string; label: string; min: number }[] = [
  { id: 'wild', label: 'Wild catch (0)', min: 0 },
  { id: 'good', label: 'Good Friend trade (1)', min: 1 },
  { id: 'great', label: 'Great Friend trade (2)', min: 2 },
  { id: 'ultra', label: 'Ultra Friend trade (3)', min: 3 },
  { id: 'weather', label: 'Weather boosted (4)', min: 4 },
  { id: 'best', label: 'Best Friend trade (5)', min: 5 },
  { id: 'raid', label: 'Raid / research / egg (10)', min: 10 },
  { id: 'lucky', label: 'Lucky trade (12)', min: 12 },
];

/** Parse "0/15/14", "0 15 14", "0-15-14", "Medicham 0,15,14" → IVs (last three numbers on the line). */
export function parseIvLine(line: string): Ivs | null {
  const nums = line.match(/\d{1,2}/g);
  if (!nums || nums.length < 3) return null;
  const v = nums.slice(-3).map(Number);
  if (v.some((x) => x < 0 || x > 15)) return null;
  return v as Ivs;
}

// ---------------------------------------------------------------- in-game search string
const STAT_WORDS = ['attack', 'defense', 'hp'] as const;

/** OR-literal for a set of buckets, e.g. {0,1,4} → "0-1attack,4attack". */
function bucketLiteral(stat: number, buckets: number[]): string {
  const parts: string[] = [];
  const sorted = [...buckets].sort((a, b) => a - b);
  for (let i = 0; i < sorted.length; i++) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    parts.push(`${sorted[i] === sorted[j] ? sorted[i] : `${sorted[i]}-${sorted[j]}`}${STAT_WORDS[stat]}`);
    i = j;
  }
  return parts.join(',');
}

export interface SearchStringResult { query: string; clauses: number; matches: number; targets: number; extra: number }

/**
 * Build an in-game search string matching every IV combo in `combos` (at appraisal-bucket precision).
 * Pokémon GO evaluates "," (OR) before "&" (AND), so the filter must be in conjunctive normal form:
 * we cover the *excluded* bucket triples with as few boxes as possible and emit one OR-clause per box
 * ("not inside this box"), written with positive bucket ranges only.
 */
export function buildSearchString(prefix: string, combos: Ivs[]): SearchStringResult {
  const inT = new Set<number>();
  const code = (a: number, d: number, h: number) => a * 25 + d * 5 + h;
  for (const iv of combos) inT.add(code(ivBucket(iv[0]), ivBucket(iv[1]), ivBucket(iv[2])));
  const excluded: number[] = [];
  for (let c = 0; c < 125; c++) if (!inT.has(c)) excluded.push(c);
  // clause = OR of literals "stat bucket ∈ set"
  type Lit = { stat: number; set: number[] };
  const raw: Lit[][] = [];
  if (inT.size && excluded.length) {
    // all contiguous boxes that lie fully inside the excluded set
    const ranges: [number, number][] = [];
    for (let i = 0; i < 5; i++) for (let j = i; j < 5; j++) ranges.push([i, j]);
    const boxes: { r: [number, number][]; cells: number[] }[] = [];
    for (const ra of ranges) for (const rd of ranges) for (const rh of ranges) {
      const cells: number[] = [];
      let ok = true;
      for (let a = ra[0]; a <= ra[1] && ok; a++) for (let d = rd[0]; d <= rd[1] && ok; d++) for (let h = rh[0]; h <= rh[1]; h++) {
        const c = code(a, d, h);
        if (inT.has(c)) { ok = false; break; }
        cells.push(c);
      }
      if (ok) boxes.push({ r: [ra, rd, rh], cells });
    }
    const uncovered = new Set(excluded);
    while (uncovered.size) {
      let best = boxes[0], bestGain = -1;
      for (const b of boxes) {
        let g = 0;
        for (const c of b.cells) if (uncovered.has(c)) g++;
        if (g > bestGain || (g === bestGain && b.cells.length > best.cells.length)) { best = b; bestGain = g; }
      }
      if (bestGain <= 0) break;
      for (const c of best.cells) uncovered.delete(c);
      // clause = NOT(in box) = OR over stats of "bucket outside the box range"
      const lits: Lit[] = [];
      best.r.forEach(([lo, hi], stat) => {
        const outside = [0, 1, 2, 3, 4].filter((x) => x < lo || x > hi);
        if (outside.length) lits.push({ stat, set: outside });
      });
      raw.push(lits);
    }
  }
  // simplify: single-stat clauses become per-stat ranges; other clauses are intersected with them
  const allowed = [[0, 1, 2, 3, 4], [0, 1, 2, 3, 4], [0, 1, 2, 3, 4]];
  for (const c of raw) if (c.length === 1) allowed[c[0].stat] = allowed[c[0].stat].filter((x) => c[0].set.includes(x));
  const clauses: string[] = [];
  allowed.forEach((set, stat) => { if (set.length < 5) clauses.push(bucketLiteral(stat, set)); });
  for (const c of raw) {
    if (c.length === 1) continue;
    const lits = c.map((l) => ({ stat: l.stat, set: l.set.filter((x) => allowed[l.stat].includes(x)) })).filter((l) => l.set.length);
    if (lits.some((l) => l.set.length === allowed[l.stat].length)) continue; // always true given the ranges
    const s = lits.map((l) => bucketLiteral(l.stat, l.set)).join(',');
    if (s && !clauses.includes(s)) clauses.push(s);
  }
  const query = [prefix, ...clauses].filter(Boolean).join('&');
  // precision: how many of the 4096 IV combos pass the filter
  let matches = 0;
  for (let a = 0; a < 16; a++) for (let d = 0; d < 16; d++) for (let h = 0; h < 16; h++) if (inT.has(code(ivBucket(a), ivBucket(d), ivBucket(h)))) matches++;
  return { query, clauses: clauses.length, matches, targets: combos.length, extra: Math.max(0, matches - combos.length) };
}

/** Species search term: lowercase English name; "+" prefix matches the whole evolution family in game. */
export const searchName = (p: Pokemon, family: boolean) => `${family ? '+' : ''}${p.name.toLowerCase()}`;

// ---------------------------------------------------------------- combatants
export interface BuildOpts { cap: number; maxLevel?: number; ivs?: Ivs; level?: number | null; moves: string[] }

/** Build a battle-ready combatant. Default IVs: rank-1 for the cap (15/15/15 at max level when uncapped). */
export function makeCombatant(data: GameData, p: Pokemon, shadow: boolean, o: BuildOpts): Combatant | null {
  const maxLevel = o.maxLevel ?? 50;
  let pick: IvPick | null;
  if (o.ivs) {
    const L = o.level ?? maxLevelUnderCap(p, data.settings, o.ivs, o.cap, maxLevel) ?? 1;
    pick = pickAt(p, data.settings, o.ivs, L);
  } else pick = rank1(p, data.settings, o.cap, maxLevel) || pickAt(p, data.settings, [0, 0, 0], 1);
  const fast = simMove(data.moves, o.moves[0]);
  const charged = o.moves.slice(1).map((m) => simMove(data.moves, m)).filter((m): m is SimMove => !!m && !m.fast);
  if (!fast || !fast.fast) return null;
  return {
    key: `${p.id}${shadow ? '*' : ''}|${pick.ivs.join('/')}@${pick.level}|${o.moves.join(',')}`,
    pokemon: p, shadow, level: pick.level, ivs: pick.ivs, cp: pick.cp,
    atk: pick.atk, def: pick.def, hp: pick.hp, fast, charged,
  };
}

/** Rating → CSS class bucket used for win/loss colouring. */
export function ratingClass(r: number): string {
  if (r >= 700) return 'r-win3';
  if (r >= 600) return 'r-win2';
  if (r > 500) return 'r-win1';
  if (r === 500) return 'r-tie';
  if (r >= 400) return 'r-loss1';
  if (r >= 300) return 'r-loss2';
  return 'r-loss3';
}

export const fmtStat = (n: number) => n.toFixed(1);
