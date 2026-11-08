// Per-individual analysis helpers for My Pokémon (PvP IV rank, raid rating, import/export).
import { cp, LEVELS, stats } from '../../lib/pogo';
import { neutralMovesetStats } from '../../lib/pve';
import type { SavedMon } from '../../lib/storage';
import type { GameData, Pokemon, Settings } from '../../lib/types';

// ---------------------------------------------------------------- PvP IV rank (memory-light)
// Same ordering as rankPvpIvs (stat product desc, then attack desc, minIv 0) but stores compact typed
// arrays per species/league instead of 4,096 row objects, so ranking a whole box stays cheap.
interface LeagueTable { prod: Float64Array; atk: Float64Array; level: Float32Array; cp: Int32Array; max: number }
const tables = new Map<string, LeagueTable>();

function leagueTable(p: Pokemon, settings: Settings, cap: number, maxLevel: number): LeagueTable {
  const key = `${p.id}|${cap}|${maxLevel}`;
  const hit = tables.get(key);
  if (hit) return hit;
  const levels = LEVELS.filter((l) => l <= maxLevel);
  const t: LeagueTable = { prod: new Float64Array(4096).fill(-1), atk: new Float64Array(4096), level: new Float32Array(4096), cp: new Int32Array(4096), max: 0 };
  for (let a = 0; a < 16; a++) for (let d = 0; d < 16; d++) for (let s = 0; s < 16; s++) {
    let lo = 0, hi = levels.length - 1, best = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (cp(p, settings, levels[mid], [a, d, s]) <= cap) { best = mid; lo = mid + 1; } else hi = mid - 1;
    }
    if (best < 0) continue;
    const L = levels[best];
    const st = stats(p, settings, L, [a, d, s]);
    const i = a * 256 + d * 16 + s;
    t.prod[i] = st.atk * st.def * st.hp;
    t.atk[i] = st.atk;
    t.level[i] = L;
    t.cp[i] = cp(p, settings, L, [a, d, s]);
    if (t.prod[i] > t.max) t.max = t.prod[i];
  }
  tables.set(key, t);
  return t;
}

export interface PvpRank { rank: number; pct: number; level: number; cp: number }

/** Rank of a specific IV spread in a league (null if it can't fit under the cap even at level 1). */
export function pvpRank(p: Pokemon, settings: Settings, ivs: [number, number, number], cap: number, maxLevel: number): PvpRank | null {
  const t = leagueTable(p, settings, cap, maxLevel);
  const i = ivs[0] * 256 + ivs[1] * 16 + ivs[2];
  const mine = t.prod[i], myAtk = t.atk[i];
  if (mine < 0) return null;
  let better = 0;
  for (let j = 0; j < 4096; j++) {
    const v = t.prod[j];
    if (v > mine || (v === mine && t.atk[j] > myAtk)) better++;
  }
  return { rank: better + 1, pct: (mine / t.max) * 100, level: t.level[i], cp: t.cp[i] };
}

// ---------------------------------------------------------------- raid rating
export interface RaidRating { dps: number; tdo: number; er: number; fast: string; charged: string; usesOwnMoves: boolean }

/** Boss-agnostic raid DPS/TDO at the Pokémon's level, using its own moves when they're set. */
export function raidRating(data: GameData, p: Pokemon, m: Pick<SavedMon, 'shadow' | 'fast' | 'charged'>, level: number): RaidRating | null {
  if (!data.settings.cpm[String(level)]) return null;
  const res = neutralMovesetStats(data, p, !!m.shadow, level);
  if (!res.length) return null;
  const charged = (m.charged || []).filter(Boolean);
  let pick = res.find((r) => (!m.fast || r.fast.id === m.fast) && (!charged.length || charged.includes(r.charged.id)));
  const own = !!pick && (!!m.fast || charged.length > 0);
  if (!pick) pick = res[0];
  return { dps: pick.dps, tdo: pick.tdo, er: pick.er, fast: pick.fast.id, charged: pick.charged.id, usesOwnMoves: own };
}

// ---------------------------------------------------------------- level inference
/** Every level at which these IVs produce the given CP. */
export function levelsForCp(p: Pokemon, settings: Settings, cpVal: number, ivs: [number, number, number], maxLevel = 51): number[] {
  return LEVELS.filter((L) => L <= maxLevel && cp(p, settings, L, ivs) === cpVal);
}

// ---------------------------------------------------------------- import / export
export function download(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const csvCell = (v: unknown): string => {
  if (v === undefined || v === null) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const num = (v: unknown, min: number, max: number): number | undefined => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max ? n : undefined;
};

/** Parse an exported JSON file (wrapped or plain array). Unknown Pokémon ids are skipped. */
export function parseMonsJson(text: string, byId: Record<string, Pokemon>): { mons: SavedMon[]; skipped: number } {
  const parsed = JSON.parse(text);
  const list: unknown[] = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.mons) ? parsed.mons : Array.isArray(parsed?.data?.mons) ? parsed.data.mons : [];
  if (!list.length && !Array.isArray(parsed) && !Array.isArray(parsed?.mons)) throw new Error('No Pokémon list found in this file');
  const mons: SavedMon[] = [];
  let skipped = 0;
  for (const raw of list) {
    const r = raw as Record<string, unknown>;
    if (!r || typeof r.id !== 'string' || !byId[r.id]) { skipped++; continue; }
    const ivs = Array.isArray(r.ivs) && r.ivs.length === 3 && r.ivs.every((x) => num(x, 0, 15) !== undefined) ? (r.ivs.map(Number) as [number, number, number]) : undefined;
    const lvl = num(r.level, 1, 51);
    mons.push({
      uid: typeof r.uid === 'string' && r.uid ? r.uid : Math.random().toString(36).slice(2, 10),
      id: r.id,
      nickname: typeof r.nickname === 'string' && r.nickname ? r.nickname : undefined,
      cp: num(r.cp, 10, 100000),
      level: lvl !== undefined && (lvl * 2) % 1 === 0 ? lvl : undefined,
      ivs,
      shadow: r.shadow === true || undefined,
      purified: r.purified === true || undefined,
      lucky: r.lucky === true || undefined,
      shiny: r.shiny === true || undefined,
      fast: typeof r.fast === 'string' && r.fast ? r.fast : undefined,
      charged: Array.isArray(r.charged) ? r.charged.filter((c): c is string => typeof c === 'string' && !!c).slice(0, 2) : undefined,
      tags: Array.isArray(r.tags) ? r.tags.filter((t): t is string => typeof t === 'string' && !!t) : undefined,
      notes: typeof r.notes === 'string' && r.notes ? r.notes : undefined,
      added: num(r.added, 0, 1e14) ?? Date.now(),
    });
  }
  return { mons, skipped };
}
