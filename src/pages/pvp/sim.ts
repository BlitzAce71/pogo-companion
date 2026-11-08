// 1v1 Trainer Battle simulator (turn based, PvPoke-style).
//
// Modelling choices (see the Simulator page "How it works" panel for the user-facing summary):
// • Time advances in turns of settings.combat.turnSeconds (0.5 s).
// • A fast move occupies `turns` turns; its damage and energy are applied at the end of its last turn.
//   Fast moves that land on the same turn are simultaneous (both can faint → tie).
// • A charged move may only be chosen by a Pokémon that is not mid fast move. Before a charged move resolves,
//   a fast move the opponent started on an earlier turn is completed immediately (damage + energy) — the
//   "fast move always leaks" behaviour (game master combatExperiment FAST_MOVE_ALWAYS_LEAK). A fast move started
//   on the same turn as the charged move keeps running and lands on its normal turn (this variant matched
//   PvPoke's published matchup ratings best in our tests).
// • If both throw a charged move on the same turn, Charge Move Priority (CMP) applies: the higher Attack
//   stat (base + IV × CPM, before shadow bonus and buffs) goes first. Exact ties alternate, starting with side A,
//   so repeated ties don't always favour the same side (the game itself resolves ties randomly).
//   If the first charged move KOs, the second is not thrown.
// • Shields reduce a charged move to 1 damage. Stat-stage effects of the move still apply when shielded.
// • Buff stages are clamped to settings.combat.minStage..maxStage (−4..+4) and use
//   settings.combat.buffMultipliers; they scale the Attack/Defense used in the damage formula.
// • Damage = pvpDamage(power, atk × shadowAtk × buff, def × shadowDef × buff, STAB × type effectiveness).
// • Energy is capped at settings.combat.maxEnergy (100).
// • Mimikyu's Disguise is modelled (see DISGUISE). Other form changes (Aegislash, Cramorant, Morpeko, Minior)
//   are not — those Pokémon battle in the form you pick.
// • Battles end on a KO or after MAX_TURNS.
// • Charged-move AI (per side): take a KO if available → bait with the cheapest move while the opponent would
//   shield it (toggle) → when about to faint, throw the strongest affordable move → otherwise wait for the move with
//   the best damage-per-energy against this opponent. No look-ahead/energy-stacking optimisation (PvPoke has more).
import { effectiveness, pvpDamage } from '../../lib/pogo';
import type { PokeType, Pokemon, Settings, TypeChart } from '../../lib/types';

export interface Buffs { chance: number; selfAtk: number; selfDef: number; oppAtk: number; oppDef: number }

export interface SimMove {
  id: string; baseId: string; name: string; type: PokeType; fast: boolean;
  power: number; energy: number; turns: number; buffs?: Buffs;
}

export interface Combatant {
  key: string;                     // stable cache key (species, shadow, IVs, level, moves)
  pokemon: Pokemon; shadow: boolean;
  level: number; ivs: [number, number, number]; cp: number;
  atk: number; def: number; hp: number; // stats before shadow multipliers
  fast: SimMove; charged: SimMove[];
}

export type ShieldMode = 'always' | 'smart' | 'never';
export interface SideOpts {
  shields: number;                 // 0–2
  energy?: number;                 // starting energy
  hp?: number;                     // starting HP (defaults to full)
  shieldMode?: ShieldMode;         // default 'always'
  bait?: boolean;                  // throw the cheaper move while the opponent has shields (default true)
}
export type BuffMode = 'guaranteed' | 'always' | 'random';
export interface SimConfig {
  chart: TypeChart;
  combat: Settings['combat'];
  buffMode?: BuffMode;             // 'guaranteed': only 100%-chance effects (PvPoke default)
  smartPct?: number;               // smart shielding: shield if the hit KOs or takes more than this % of current HP
  seed?: number;                   // RNG seed for buffMode 'random'
  log?: boolean;                   // record events + HP timeline
  /** How a fast move started on the same turn as an opposing charged move resolves (default 'after', see header). */
  sameTurnFast?: 'before' | 'after' | 'cancel';
  forms?: boolean;                 // model Mimikyu's Disguise (default true)
}

export type SimEventKind = 'fast' | 'charged' | 'buff' | 'faint' | 'timeout';
export interface SimEvent {
  turn: number;
  side: 0 | 1;
  kind: SimEventKind;
  move?: SimMove;
  damage?: number;
  shielded?: boolean;
  /** blocked by Mimikyu's Disguise */
  disguise?: boolean;
  /** charged move went first by Charge Move Priority */
  cmp?: 'atk' | 'tie';
  hp: [number, number];
  energy: [number, number];
  stages?: { side: 0 | 1; atk: number; def: number }[];
}

export interface SimResult {
  winner: 0 | 1 | null;            // null = tie / draw
  reason: 'ko' | 'double-ko' | 'timeout';
  hp: [number, number];
  maxHp: [number, number];
  energy: [number, number];
  shieldsLeft: [number, number];
  rating: [number, number];
  turns: number;
  chargedUsed: [number, number];
  events: SimEvent[];
  timeline: { turn: number; hp: [number, number] }[];
}

/** Battle timer in turns. Game master COMBAT_SETTINGS.roundDurationSeconds = 270 (not exported to settings.json);
 *  Only turn time is counted here (charged-move minigames excluded), so this is an upper bound that virtually no
 *  1v1 reaches. */
export const MAX_TURNS = 540;

/** Species with Disguise. Modelled after PvPoke (gamemaster formChange "protect"): the first charged move that
 *  would hit Mimikyu is blocked (it never shields while disguised) and it becomes Busted at −1 Defense stage. */
const DISGUISE = new Set(['MIMIKYU']);
const DISGUISE_DMG = 0;
const BUSTED_DEF_STAGE = -1;

/** PvPoke-style battle rating: 500 × damage dealt fraction + 500 × own HP remaining fraction. 500 = even. */
export function battleRating(ownHp: number, ownMax: number, oppHp: number, oppMax: number): number {
  return Math.round(500 * ((oppMax - oppHp) / oppMax) + 500 * (ownHp / ownMax));
}

/** Small deterministic RNG (mulberry32) so random-buff runs are reproducible. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface SideState { hp: number; energy: number; shields: number; atkS: number; defS: number; landsAt: number /* -1 idle */; disguise: boolean }

export function simulate(A: Combatant, B: Combatant, oa: SideOpts, ob: SideOpts, cfg: SimConfig): SimResult {
  const cs = [A, B] as const;
  const os = [oa, ob] as const;
  const { combat, chart } = cfg;
  const maxE = combat.maxEnergy || 100;
  const bm = combat.buffMultipliers;
  const minS = combat.minStage ?? -4, maxS = combat.maxStage ?? 4;
  const stageMult = (s: number) => bm[s - minS] ?? 1;
  const buffMode = cfg.buffMode ?? 'guaranteed';
  const smart = (cfg.smartPct ?? 40) / 100;
  const rand = rng(cfg.seed ?? 1);
  const log = !!cfg.log;

  const S: SideState[] = cs.map((c, i) => ({
    hp: Math.max(1, Math.min(c.hp, os[i].hp ?? c.hp)),
    energy: Math.max(0, Math.min(maxE, os[i].energy ?? 0)),
    shields: Math.max(0, Math.min(2, os[i].shields)),
    atkS: 0, defS: 0, landsAt: -1,
    disguise: cfg.forms !== false && DISGUISE.has(c.pokemon.speciesId),
  }));
  const atkBase = cs.map((c) => c.atk * (c.shadow ? combat.shadowAtk : 1));
  const defBase = cs.map((c) => c.def * (c.shadow ? combat.shadowDef : 1));
  // STAB × effectiveness per move, per attacking side (constant through the battle)
  const multCache = new Map<SimMove, number>();
  const moveMult = (i: number, m: SimMove) => {
    let v = multCache.get(m);
    if (v === undefined) {
      v = (cs[i].pokemon.types.includes(m.type) ? combat.stab : 1) * effectiveness(chart, m.type, cs[1 - i].pokemon.types);
      multCache.set(m, v);
    }
    return v;
  };
  const dmg = (i: number, m: SimMove) => {
    const j = 1 - i;
    return pvpDamage(m.power, atkBase[i] * stageMult(S[i].atkS), defBase[j] * stageMult(S[j].defS), moveMult(i, m));
  };
  const wouldShield = (def: number, d: number) => {
    const s = S[def];
    if (s.shields <= 0 || s.disguise) return false;
    const mode = os[def].shieldMode ?? 'always';
    if (mode === 'never') return false;
    if (mode === 'always') return true;
    return d >= s.hp || d > smart * s.hp;
  };

  const events: SimEvent[] = [];
  const timeline: { turn: number; hp: [number, number] }[] = [];
  const hpPair = (): [number, number] => [S[0].hp, S[1].hp];
  const ePair = (): [number, number] => [S[0].energy, S[1].energy];
  if (log) timeline.push({ turn: 0, hp: hpPair() });
  const chargedUsed: [number, number] = [0, 0];

  const cheapest = (i: number, ks: number[]) => ks.reduce((b, k) => {
    const m = cs[i].charged[k], mb = cs[i].charged[b];
    return m.energy < mb.energy || (m.energy === mb.energy && dmg(i, m) > dmg(i, mb)) ? k : b;
  }, ks[0]);
  const strongest = (i: number, ks: number[]) => ks.reduce((b, k) => (dmg(i, cs[i].charged[k]) > dmg(i, cs[i].charged[b]) ? k : b), ks[0]);

  /** -1 = fast move, otherwise index of the charged move to throw */
  const decide = (i: number): number => {
    const me = S[i], op = S[1 - i], c = cs[i], oc = cs[1 - i];
    if (!c.charged.length) return -1;
    const aff: number[] = [];
    c.charged.forEach((m, k) => { if (m.energy <= me.energy) aff.push(k); });
    if (!aff.length) return -1;
    // 1. Take a KO if one is available (and the opponent wouldn't shield it)
    const ko = aff.filter((k) => { const d = dmg(i, c.charged[k]); return !op.disguise && d >= op.hp && !wouldShield(1 - i, d); });
    if (ko.length) return cheapest(i, ko);
    // 2. Bait shields with the cheapest move
    if ((os[i].bait ?? true) && op.shields > 0 && wouldShield(1 - i, dmg(i, c.charged[cheapest(i, aff)]))) {
      const cheapAll = cheapest(i, c.charged.map((_, k) => k));
      if (aff.includes(cheapAll)) return cheapAll;
    }
    // 3. About to faint: don't die holding energy
    const fastIn = dmg(1 - i, oc.fast);
    const lethalCharged = oc.charged.some((m) => m.energy <= op.energy && (() => { const d = dmg(1 - i, m); return !me.disguise && d >= me.hp && !wouldShield(i, d); })());
    if (me.hp <= fastIn || lethalCharged) return strongest(i, aff);
    // 4. Otherwise wait for the most efficient move (damage per energy vs this opponent; ties → more damage)
    let pref = 0, best = -1;
    c.charged.forEach((m, k) => {
      const d = dmg(i, m), v = d / Math.max(1, m.energy);
      if (v > best + 1e-9 || (Math.abs(v - best) <= 1e-9 && d > dmg(i, c.charged[pref]))) { best = v; pref = k; }
    });
    return aff.includes(pref) ? pref : -1;
  };

  const applyFast = (i: number, turn: number) => {
    const m = cs[i].fast;
    const d = dmg(i, m);
    S[1 - i].hp = Math.max(0, S[1 - i].hp - d);
    S[i].energy = Math.min(maxE, S[i].energy + m.energy);
    S[i].landsAt = -1;
    if (log) events.push({ turn, side: i as 0 | 1, kind: 'fast', move: m, damage: d, hp: hpPair(), energy: ePair() });
  };

  const applyCharged = (i: number, k: number, turn: number, cmp?: 'atk' | 'tie') => {
    const m = cs[i].charged[k];
    const j = 1 - i;
    S[i].energy -= m.energy;
    chargedUsed[i]++;
    let d = dmg(i, m);
    const shielded = wouldShield(j, d);
    let disguise = false;
    if (shielded) { S[j].shields--; d = 1; }
    else if (S[j].disguise) {
      disguise = true; d = DISGUISE_DMG; S[j].disguise = false;
      S[j].defS = Math.max(minS, S[j].defS + BUSTED_DEF_STAGE);
    }
    S[j].hp = Math.max(0, S[j].hp - d);
    if (log) events.push({ turn, side: i as 0 | 1, kind: 'charged', move: m, damage: d, shielded, disguise, cmp, hp: hpPair(), energy: ePair() });
    const b = m.buffs;
    if (b && (b.selfAtk || b.selfDef || b.oppAtk || b.oppDef)) {
      const fire = buffMode === 'always' || b.chance >= 1 || (buffMode === 'random' && rand() < b.chance);
      if (fire) {
        const clamp = (v: number) => Math.max(minS, Math.min(maxS, v));
        S[i].atkS = clamp(S[i].atkS + b.selfAtk); S[i].defS = clamp(S[i].defS + b.selfDef);
        S[j].atkS = clamp(S[j].atkS + b.oppAtk); S[j].defS = clamp(S[j].defS + b.oppDef);
        if (log) {
          const stages: { side: 0 | 1; atk: number; def: number }[] = [];
          if (b.selfAtk || b.selfDef) stages.push({ side: i as 0 | 1, atk: S[i].atkS, def: S[i].defS });
          if (b.oppAtk || b.oppDef) stages.push({ side: j as 0 | 1, atk: S[j].atkS, def: S[j].defS });
          events.push({ turn, side: i as 0 | 1, kind: 'buff', move: m, hp: hpPair(), energy: ePair(), stages });
        }
      }
    }
  };

  let turn = 0;
  let tieToggle = 0;
  let reason: SimResult['reason'] = 'timeout';
  while (turn < MAX_TURNS) {
    // 1. decisions for idle Pokémon
    const act = [-2, -2];
    for (let i = 0; i < 2; i++) if (S[i].landsAt < 0) act[i] = decide(i);
    for (let i = 0; i < 2; i++) if (act[i] === -1) S[i].landsAt = turn + cs[i].fast.turns - 1;
    // 2. charged moves
    const throwers = [0, 1].filter((i) => act[i] >= 0);
    if (throwers.length) {
      // opponent fast moves in progress complete before the charged move
      const stf = cfg.sameTurnFast ?? 'after';
      const late: number[] = [];
      for (let i = 0; i < 2; i++) if (act[i] < 0 && S[i].landsAt >= 0) {
        if (act[i] === -1 && stf !== 'before') { if (stf === 'after') late.push(i); else S[i].landsAt = -1; }
        else applyFast(i, turn);
      }
      let order = throwers;
      let cmp: 'atk' | 'tie' | undefined;
      if (throwers.length === 2) {
        if (A.atk !== B.atk) { order = A.atk > B.atk ? [0, 1] : [1, 0]; cmp = 'atk'; }
        else { order = tieToggle === 0 ? [0, 1] : [1, 0]; tieToggle ^= 1; cmp = 'tie'; }
      }
      for (let n = 0; n < order.length; n++) {
        const i = order[n];
        if (S[0].hp <= 0 || S[1].hp <= 0) break;
        applyCharged(i, act[i], turn, n === 0 ? cmp : undefined);
      }
      for (const i of late) {
        if (S[0].hp <= 0 || S[1].hp <= 0) S[i].landsAt = -1;
        else if (S[i].landsAt === turn) applyFast(i, turn);
      }
    } else {
      // 3. fast moves landing this turn (simultaneous)
      const landing = [0, 1].filter((i) => S[i].landsAt === turn);
      if (landing.length === 2) {
        const d0 = dmg(0, A.fast), d1 = dmg(1, B.fast);
        S[1].hp = Math.max(0, S[1].hp - d0); S[0].hp = Math.max(0, S[0].hp - d1);
        S[0].energy = Math.min(maxE, S[0].energy + A.fast.energy);
        S[1].energy = Math.min(maxE, S[1].energy + B.fast.energy);
        S[0].landsAt = S[1].landsAt = -1;
        if (log) {
          events.push({ turn, side: 0, kind: 'fast', move: A.fast, damage: d0, hp: hpPair(), energy: ePair() });
          events.push({ turn, side: 1, kind: 'fast', move: B.fast, damage: d1, hp: hpPair(), energy: ePair() });
        }
      } else if (landing.length === 1) applyFast(landing[0], turn);
    }
    if (log && (timeline[timeline.length - 1].hp[0] !== S[0].hp || timeline[timeline.length - 1].hp[1] !== S[1].hp)) timeline.push({ turn: turn + 1, hp: hpPair() });
    turn++;
    if (S[0].hp <= 0 || S[1].hp <= 0) {
      reason = S[0].hp <= 0 && S[1].hp <= 0 ? 'double-ko' : 'ko';
      if (log) for (let i = 0; i < 2; i++) if (S[i].hp <= 0) events.push({ turn: turn - 1, side: i as 0 | 1, kind: 'faint', hp: hpPair(), energy: ePair() });
      break;
    }
  }
  if (reason === 'timeout' && log) events.push({ turn, side: 0, kind: 'timeout', hp: hpPair(), energy: ePair() });

  const maxHp: [number, number] = [A.hp, B.hp];
  const rating: [number, number] = [battleRating(S[0].hp, A.hp, S[1].hp, B.hp), battleRating(S[1].hp, B.hp, S[0].hp, A.hp)];
  let winner: 0 | 1 | null = null;
  if (S[0].hp > 0 && S[1].hp <= 0) winner = 0;
  else if (S[1].hp > 0 && S[0].hp <= 0) winner = 1;
  else if (reason === 'timeout' && rating[0] !== rating[1]) winner = rating[0] > rating[1] ? 0 : 1;
  return {
    winner, reason, hp: hpPair(), maxHp, energy: ePair(), shieldsLeft: [S[0].shields, S[1].shields],
    rating, turns: turn, chargedUsed, events, timeline,
  };
}

// ---------------------------------------------------------------- cached quick sims (team builder)
const quickCache = new Map<string, number>();
/** Rating for side A of A vs B with equal shields, no logging. Cached by combatant keys. */
export function quickRating(A: Combatant, B: Combatant, shields: number, cfg: SimConfig): number {
  const key = `${A.key}#${B.key}#${shields}#${cfg.buffMode ?? 'guaranteed'}`;
  const hit = quickCache.get(key);
  if (hit !== undefined) return hit;
  const res = simulate(A, B, { shields }, { shields }, { ...cfg, log: false });
  quickCache.set(key, res.rating[0]);
  // the same battle seen from B (only CMP-tie alternation order differs, which is negligible here)
  quickCache.set(`${B.key}#${A.key}#${shields}#${cfg.buffMode ?? 'guaranteed'}`, res.rating[1]);
  return res.rating[0];
}
