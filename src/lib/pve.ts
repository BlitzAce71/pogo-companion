// Raid / gym (PvE) battle math: comprehensive DPS, TDO and counter rankings.
// Based on the community "comprehensive DPS" model (GamePress), which accounts for
// energy gained from damage taken and an estimated boss DPS.
import { effectiveness, pveDamage, SHADOW_ATK, SHADOW_DEF, stats, weatherTypes } from './pogo';
import type { GameData, Move, PokeType, Pokemon } from './types';
import { movePool } from './data';

export interface RaidTier { id: string; name: string; cpm: number; hp: number; timer: number; stars: string }
export const RAID_TIERS: RaidTier[] = [
  { id: '1', name: 'Tier 1', cpm: 0.5974, hp: 600, timer: 180, stars: '★' },
  { id: '3', name: 'Tier 3', cpm: 0.73, hp: 3600, timer: 180, stars: '★★★' },
  { id: '4', name: 'Tier 4', cpm: 0.79, hp: 9000, timer: 180, stars: '★★★★' },
  { id: '5', name: 'Tier 5 (Legendary)', cpm: 0.79, hp: 15000, timer: 300, stars: '★★★★★' },
  { id: 'mega', name: 'Mega', cpm: 0.79, hp: 9000, timer: 300, stars: 'Mega' },
  { id: 'mega5', name: 'Mega Legendary / Primal', cpm: 0.79, hp: 22500, timer: 300, stars: 'Mega ★★★★★' },
  { id: 'elite', name: 'Elite', cpm: 0.79, hp: 20000, timer: 300, stars: 'Elite' },
  { id: 'shadow1', name: 'Shadow Tier 1', cpm: 0.5974, hp: 1800, timer: 180, stars: 'Shadow ★' },
  { id: 'shadow3', name: 'Shadow Tier 3', cpm: 0.73, hp: 10800, timer: 180, stars: 'Shadow ★★★' },
  { id: 'shadow5', name: 'Shadow Tier 5', cpm: 0.79, hp: 22500, timer: 300, stars: 'Shadow ★★★★★' },
];

/** Guess a raid tier for a boss Pokémon */
export function defaultTier(p: Pokemon): RaidTier {
  if (p.megaOf) return RAID_TIERS.find((t) => t.id === (p.class ? 'mega5' : 'mega'))!;
  if (p.class) return RAID_TIERS.find((t) => t.id === '5')!;
  const total = p.atk + p.def + p.sta;
  return RAID_TIERS.find((t) => t.id === (total > 520 ? '3' : '1'))!;
}

export interface BattleOptions {
  attackerLevel: number;               // e.g. 40 / 50
  attackerIvs?: [number, number, number];
  weather?: string | null;             // weather id
  friendship?: number;                 // attack multiplier 1, 1.03, 1.05, 1.07, 1.1, 1.12 (best friends+)
  megaBoost?: PokeType[] | null;       // types of an active Mega in the party (1.3× same type, 1.1× other)
  includeShadow?: boolean;
  includeMega?: boolean;
  includeElite?: boolean;              // legacy / Elite TM moves
  includeUnreleased?: boolean;
}

export interface Combatant { atk: number; def: number; hp: number; types: PokeType[] }

interface MoveCycle { fDmg: number; fDur: number; fE: number; cDmg: number; cDur: number; cE: number; cDws: number }

function multFor(move: Move, attTypes: PokeType[], defTypes: PokeType[], data: GameData, o: Partial<BattleOptions>, applyBoosts: boolean): number {
  let m = effectiveness(data.types, move.type, defTypes);
  if (attTypes.includes(move.type)) m *= 1.2;
  if (o.weather && weatherTypes(data.settings, o.weather).includes(move.type)) m *= 1.2;
  if (applyBoosts) {
    if (o.friendship) m *= o.friendship;
    if (o.megaBoost?.length) m *= o.megaBoost.includes(move.type) ? 1.3 : 1.1;
  }
  return m;
}

/** Average DPS the boss deals to a given defender (all boss movesets averaged unless one is given). */
export function bossDps(boss: Combatant, bossMovesets: [Move, Move][], defender: Combatant, data: GameData, o: Partial<BattleOptions>): number {
  if (!bossMovesets.length) return 900 / defender.def;
  let total = 0;
  for (const [f, c] of bossMovesets) {
    if (!f.pve || !c.pve) continue;
    const fd = pveDamage(f.pve.power, boss.atk, defender.def, multFor(f, boss.types, defender.types, data, o, false));
    const cd = pveDamage(c.pve.power, boss.atk, defender.def, multFor(c, boss.types, defender.types, data, o, false));
    const fDur = f.pve.duration / 1000 + 2, cDur = c.pve.duration / 1000 + 2;
    const fE = Math.max(1, f.pve.energy), cE = Math.max(1, c.pve.energy);
    total += (fd * cE + cd * fE) / (cE * fDur + fE * cDur);
  }
  return total / bossMovesets.length;
}

/** Comprehensive DPS / TDO for an attacker moveset against a boss with incoming DPS y. */
export function movesetDps(cyc: MoveCycle, attackerHp: number, y: number): { dps: number; tdo: number } {
  const { fDmg, fDur, fE, cDmg, cDur, cE, cDws } = cyc;
  const FDPS = fDmg / fDur, FEPS = fE / fDur;
  const CDPS = cDmg / cDur;
  let CEPS = cE / cDur;
  if (cE >= 100) CEPS = (cE + 0.5 * fE + 0.5 * y * cDws) / cDur; // energy waste on 1-bar moves
  const x = 0.5 * cE + 0.5 * fE;
  let dps: number;
  if (CDPS <= FDPS || cE === 0) dps = FDPS;
  else {
    const dps0 = (FDPS * CEPS + CDPS * FEPS) / (CEPS + FEPS);
    dps = dps0 + ((CDPS - FDPS) / (CEPS + FEPS)) * (0.5 - x / attackerHp) * y;
    dps = Math.max(FDPS, dps);
  }
  const tdo = dps * (attackerHp / Math.max(0.01, y));
  return { dps, tdo };
}

export interface CounterResult {
  pokemon: Pokemon;
  shadow: boolean;
  fast: Move;
  charged: Move;
  dps: number;
  tdo: number;
  er: number;          // equivalent rating: (DPS³·TDO)^¼
  elite: boolean;      // uses a legacy/Elite TM move
}

export function bossCombatant(p: Pokemon, tier: RaidTier, shadowBoss = false): Combatant {
  return { atk: (p.atk + 15) * tier.cpm, def: (p.def + 15) * tier.cpm * (shadowBoss ? SHADOW_DEF : 1), hp: tier.hp, types: p.types };
}

export function bossMovesets(data: GameData, p: Pokemon, fixed?: { fast?: string; charged?: string }): [Move, Move][] {
  const pool = movePool(p, true);
  const fasts = (fixed?.fast ? [fixed.fast] : pool.fast).map((m) => data.moves[m]).filter((m) => m?.pve);
  const charged = (fixed?.charged ? [fixed.charged] : pool.charged).map((m) => data.moves[m]).filter((m) => m?.pve);
  const out: [Move, Move][] = [];
  for (const f of fasts) for (const c of charged) out.push([f, c]);
  return out;
}

/** Evaluate one attacker (every moveset) against a boss. Returns movesets sorted best first. */
export function evaluateAttacker(data: GameData, att: Pokemon, shadow: boolean, boss: Combatant, bossSets: [Move, Move][], o: BattleOptions): CounterResult[] {
  const ivs = o.attackerIvs || [15, 15, 15];
  const st = stats(att, data.settings, o.attackerLevel, ivs);
  const atk = st.atk * (shadow ? SHADOW_ATK : 1);
  const def = st.def * (shadow ? SHADOW_DEF : 1);
  const me: Combatant = { atk, def, hp: st.hp, types: att.types };
  const y = bossDps(boss, bossSets, me, data, o);
  const pool = movePool(att, o.includeElite !== false);
  const results: CounterResult[] = [];
  for (const fid of pool.fast) {
    const f = data.moves[fid];
    if (!f?.pve) continue;
    const fDmg = pveDamage(f.pve.power, atk, boss.def, multFor(f, att.types, boss.types, data, o, true));
    for (const cid of shadow ? [...pool.charged.filter((c) => c !== 'RETURN'), 'FRUSTRATION'] : pool.charged) {
      if (shadow && cid === 'FRUSTRATION') continue; // never useful
      const c = data.moves[cid];
      if (!c?.pve) continue;
      const cDmg = pveDamage(c.pve.power, atk, boss.def, multFor(c, att.types, boss.types, data, o, true));
      const r = movesetDps({ fDmg, fDur: f.pve.duration / 1000, fE: f.pve.energy, cDmg, cDur: c.pve.duration / 1000, cE: c.pve.energy, cDws: c.pve.dws / 1000 }, st.hp, y);
      results.push({ pokemon: att, shadow, fast: f, charged: c, dps: r.dps, tdo: r.tdo, er: Math.pow(r.dps ** 3 * r.tdo, 0.25), elite: att.eliteFast.includes(fid) || att.eliteCharged.includes(cid) });
    }
  }
  return results.sort((a, b) => b.er - a.er);
}

/** Rank the best counters for a raid boss (best moveset per attacker). */
export function rankCounters(data: GameData, bossPokemon: Pokemon, tier: RaidTier, o: BattleOptions, fixed?: { fast?: string; charged?: string }, limit = 60): CounterResult[] {
  const boss = bossCombatant(bossPokemon, tier, tier.id.startsWith('shadow'));
  const sets = bossMovesets(data, bossPokemon, fixed);
  const out: CounterResult[] = [];
  for (const p of data.pokemon) {
    if (!o.includeUnreleased && !p.released) continue;
    if (p.megaOf && !o.includeMega) continue;
    if (p.tags.includes('primal') && !o.includeMega) continue;
    const variants = [false, ...(o.includeShadow && p.shadowReleased ? [true] : [])];
    for (const sh of variants) {
      const best = evaluateAttacker(data, p, sh, boss, sets, o)[0];
      if (best) out.push(best);
    }
  }
  out.sort((a, b) => b.er - a.er);
  return out.slice(0, limit);
}

/** Rough number of trainers needed: total boss HP ÷ damage one trainer deals with a team of the given counters. */
export function estimateTrainers(counters: CounterResult[], tier: RaidTier): number {
  const team = counters.slice(0, 6);
  if (!team.length) return Infinity;
  const avgDps = team.reduce((s, c) => s + c.dps, 0) / team.length;
  const fightTime = Math.max(60, tier.timer - 30); // lobby/relobby overhead
  const perTrainer = avgDps * fightTime * 0.85;   // dodge/swap inefficiency
  return Math.max(1, Math.ceil(tier.hp / perTrainer));
}

/** Simple, boss-agnostic DPS/TDO for a moveset (for Pokédex best-moveset tables). */
export function neutralMovesetStats(data: GameData, p: Pokemon, shadow: boolean, level = 40) {
  const neutralBoss: Combatant = { atk: 200 * 0.79, def: 200 * 0.79, hp: 15000, types: [] };
  const res = evaluateAttacker(data, p, shadow, neutralBoss, [], { attackerLevel: level, includeElite: true });
  return res;
}
