// Data shapes produced by scripts/build-data.mjs (public/data/*.json)

export type PokeType =
  | 'normal' | 'fighting' | 'flying' | 'poison' | 'ground' | 'rock' | 'bug' | 'ghost' | 'steel'
  | 'fire' | 'water' | 'grass' | 'electric' | 'psychic' | 'ice' | 'dragon' | 'dark' | 'fairy';

export interface Evolution {
  to: string;            // target Pokemon id
  candy: number;
  candyPurified?: number;
  item?: string;         // e.g. "Sun Stone"
  itemId?: string;
  itemCost?: number;
  lure?: string;         // e.g. "Mossy Lure Module"
  buddyKm?: number;
  mustBeBuddy?: boolean;
  time?: 'Day' | 'Night' | 'Dusk' | 'Full moon';
  upsideDown?: boolean;
  gender?: 'Female' | 'Male';
  tradeFree?: boolean;   // no candy cost if traded
  move?: string;
  quest?: string;        // human readable quest requirement
}

export interface Pokemon {
  id: string;            // unique key, e.g. "CHARIZARD", "RATTATA_ALOLA", "CHARIZARD_MEGA_X"
  dex: number;
  speciesId: string;     // e.g. "RATTATA"
  name: string;          // species display name, e.g. "Rattata"
  form: string | null;   // e.g. "ALOLA", "MEGA_X"
  formName: string | null; // e.g. "Alolan", "Mega X"
  types: PokeType[];
  atk: number; def: number; sta: number;
  fast: string[]; charged: string[];
  eliteFast: string[]; eliteCharged: string[];
  family: string;
  parentId?: string;     // pre-evolution id
  evolutions?: Evolution[];
  megas?: string[];      // mega/primal ids for this base form
  megaOf?: string;       // set on mega/primal entries → base id
  costumeOf?: string;    // set on costume checklist entries (built in the app) → base id
  megaEnergy?: { first: number; after: number } | null;
  buddyKm: number;
  buddySize: string | null;
  thirdMove: { dust: number; candy: number } | null;
  purify: { dust: number; candy: number } | null;
  class: 'legendary' | 'mythical' | 'ultra_beast' | null;
  height: number; weight: number;
  category: string | null;
  desc: string | null;
  gen: number;
  tradable: boolean; transferable: boolean;
  candyToEvolve: number;
  bonusCandy: number; bonusXl: number;
  captureRate: number | null; fleeRate: number | null; shadowCaptureRate: number | null;
  size: { xxs: number; xs: number; mLo: number; mHi: number; xl: number; xxl: number } | null;
  maxGroup: string | null; // Max move upgrade cost group ("1".."4", "Z")
  gmax?: boolean;        // has a Gigantamax form (in game files)
  dmax?: boolean;        // has Dynamax visual data (in game files)
  img: string;           // sprite basename e.g. "pm19.fALOLA"
  shinyImg: boolean;
  variants?: number;     // number of cosmetic variants collapsed into this entry
  released: boolean;
  shadowReleased: boolean;
  pvpoke: string | null; // PvPoke species id
  tags: string[];        // PvPoke tags: starter, legendary, mythical, ultrabeast, alolan, mega …
  candyPerXl?: number;
}

export interface Move {
  id: string;            // e.g. "FIRE_SPIN_FAST", "BLAST_BURN"
  name: string;
  type: PokeType;
  fast: boolean;
  /** Raids & gyms. power, energy (gain for fast / cost for charged), duration ms, damage window start ms */
  pve: { power: number; energy: number; duration: number; dws: number } | null;
  /** Trainer battles. energy (gain for fast / cost for charged), turns (fast moves) */
  pvp: {
    power: number; energy: number; turns: number;
    buffs?: { chance: number; selfAtk: number; selfDef: number; oppAtk: number; oppDef: number };
  } | null;
  special?: 'shadow' | 'purified';
  max?: boolean;         // Dynamax Max Move
}

export type TypeChart = Record<PokeType, Record<PokeType, number>>;

export interface Settings {
  generatedAt: string;
  sources: Record<string, string>;
  cpm: Record<string, number>;          // level (1, 1.5 … 55) → CP multiplier
  maxPokemonLevel: number;              // 50
  upgrade: {
    candy: number[]; dust: number[]; xl: number[];   // per power-up index (level 1 → 1.5 is index 0)
    shadowMult: number; purifiedMult: number; shadowCandyMult: number; purifiedCandyMult: number;
    luckyDustMult: number;
    overrides: Record<string, { candy: number[]; xl: number[]; dust: number[] }>;
  };
  xp: number[];                         // total XP required for trainer level index+1
  levelCap: number;
  maxEncounterLevel: number; maxEggLevel: number; maxQuestLevel: number;
  weather: Record<string, PokeType[]>;  // clear, rainy, partly_cloudy, cloudy, windy, snow, fog
  weatherBonus: { level: number; minIv: number; dust: number; attack: number; raidMinIv: number };
  friendship: { level: number; points: number; xp: number; attack: number; raidBalls: number; tradeDiscount: number; luckyApplicator: boolean }[];
  levelRewards: { level: number; items: { name: string; count: number }[]; unlocks: string[] }[];
  buddyLevels: { level: number; points: number; traits: string[] }[];
  megaLevels: { level: number; differentTypeAttackBoost: number; sameTypeAttackBoost: number; sameTypeExtraCatchCandy: number; cooldownMs: number }[];
  combat: { stab: number; pvpBonus: number; shadowAtk: number; shadowDef: number; maxEnergy: number; turnSeconds: number; buffMultipliers: number[]; minStage: number; maxStage: number };
  maxMoves: { type: PokeType; id: string; name: string }[];
  maxMoveLevels: Record<string, { attack: MaxMoveCost[]; guard: MaxMoveCost[]; spirit: MaxMoveCost[] }>;
  leagues: { id: string; name: string; cp: number | null; types: PokeType[] | null; banned: number; enabled: boolean }[];
  rankings: { key: string; title: string; cp: number; cup: string; count: number }[];
  pvpIds: Record<string, string>;       // PvPoke species id → our id
}
export interface MaxMoveCost { mpCost?: number; candyCost?: number; xlCandyCost?: number; xpReward?: number }

export interface RankingRow {
  id: string;            // our Pokemon id
  sh?: 1;                // shadow variant
  pv: string;            // PvPoke species id
  s: number;             // overall score
  r: number[];           // [lead, closer, switch, charger, attacker, consistency]
  m: string[];           // recommended moveset (our move ids): [fast, charged1, charged2]
  mu: [string, number][]; // key wins   (PvPoke id, rating)
  c: [string, number][];  // key losses (PvPoke id, rating)
  sp?: number;           // stat product
}

/** A costume / event variant. Same stats and moves as its base entry. */
export interface Costume {
  id: string;            // e.g. "PIKACHU__HOLIDAY_2016" (also the My Dex collection key)
  dex: number;
  base: string;          // Pokemon id it belongs to
  code: string;          // game code, e.g. "HOLIDAY_2016", "POP_STAR"
  name: string;          // readable name derived from the code, e.g. "Holiday 2016"
  img: string;           // sprite basename, e.g. "pm25.cHOLIDAY_2016"
  shinyImg: boolean;     // a shiny sprite exists
  noEvolve?: boolean;    // event costume that can't evolve
}

export interface Medal { id: string; name: string; desc: string; targets: number[]; type: PokeType | null }
export interface Item { id: string; name: string; desc: string; category: string; level: number | null }
export interface Reference { medals: Medal[]; items: Item[] }

export interface GameData {
  pokemon: Pokemon[];
  byId: Record<string, Pokemon>;
  moves: Record<string, Move>;
  types: TypeChart;
  settings: Settings;
  reference: Reference;
  costumes: Costume[];
  costumeById: Record<string, Costume>;
  /** Costumes whose base entry is this Pokémon id */
  costumesFor: (pokemonId: string) => Costume[];
  /** All non-mega entries for a family, in evolution order */
  family: (familyId: string) => Pokemon[];
  /** Resolve a PvPoke species id (may end in _shadow) */
  fromPvpoke: (pvId: string) => { pokemon: Pokemon; shadow: boolean } | null;
}

// A specific Pokemon instance (used by calculators, collection, simulators)
export interface Instance {
  id: string;
  level: number;
  ivs: [number, number, number]; // atk, def, sta
  shadow?: boolean;
  purified?: boolean;
}
