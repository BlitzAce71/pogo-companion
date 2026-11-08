// Helpers shared by the Tools pages (IV / CP / power-up / evolution / trade / XP / mega / search).
import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useData } from '../../lib/data';
import { LEVELS } from '../../lib/pogo';
import { useStored } from '../../lib/storage';
import type { Pokemon, Settings } from '../../lib/types';

/**
 * Selected Pokémon for a tool page. `?id=` in the URL wins; otherwise the last Pokémon used on
 * this tool (persisted). Selecting updates both the URL (replace) and the stored value.
 */
export function usePokemonParam(tool: string, fallbackId: string | null = null): [Pokemon | null, (p: Pokemon | null) => void] {
  const { byId } = useData();
  const [params, setParams] = useSearchParams();
  const [stored, setStored] = useStored<string | null>(`tools.${tool}.id`, fallbackId);
  const urlId = params.get('id');
  const id = urlId && byId[urlId] ? urlId : stored;
  const pokemon = id ? byId[id] ?? null : null;
  const set = useCallback((p: Pokemon | null) => {
    setStored(p ? p.id : null);
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (p) next.set('id', p.id); else next.delete('id');
      return next;
    }, { replace: true });
  }, [setParams, setStored]);
  return [pokemon, set];
}

/** Levels 1 … max in 0.5 steps (optionally whole levels only) */
export const levelsUpTo = (max: number, min = 1, half = true) => LEVELS.filter((l) => l >= min && l <= max && (half || l % 1 === 0));
export const levelOptions = (max = 50, min = 1, half = true) => levelsUpTo(max, min, half).map((l) => ({ id: l, label: `Level ${l}` }));

/** Friendship levels as used in-game (settings.friendship level index 1–4). */
export const FRIEND_NAMES: Record<number, string> = { 1: 'Good', 2: 'Great', 3: 'Ultra', 4: 'Best' };
export const friendName = (level: number) => FRIEND_NAMES[level] ?? `Level ${level}`;

/**
 * Post-trade IV floor per friendship level. Community-known values (matches pogo.ts TRADE_DUST.minIv):
 * Good 1, Great 2, Ultra 3, Best 5. A Lucky trade raises the floor to 12.
 */
export const TRADE_IV_FLOOR: Record<number, number> = { 1: 1, 2: 2, 3: 3, 4: 5 };
export const LUCKY_IV_FLOOR = 12;

/** Trading stardust discount for a friendship level (settings.friendship[].tradeDiscount, e.g. 0.92 = 92% off). */
export function tradeDiscount(settings: Settings, friendLevel: number): number {
  return settings.friendship.find((f) => f.level === friendLevel)?.tradeDiscount ?? 0;
}

/**
 * Mythical Pokémon that CAN be traded (community-known: Meltan & Melmetal). The data's `tradable`
 * flag is used first; mythicals not in this set are treated as untradable.
 */
const TRADABLE_MYTHICALS = new Set(['MELTAN', 'MELMETAL']);
export function canTrade(p: Pokemon): boolean {
  if (!p.tradable) return false;
  if (p.class === 'mythical' && !TRADABLE_MYTHICALS.has(p.speciesId)) return false;
  return true;
}

/** Distinct values of an array, preserving order */
export const uniq = <T,>(xs: T[]) => [...new Set(xs)];

export const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Number input value → number with a default when empty */
export const num = (v: number | '', d = 0) => (v === '' || Number.isNaN(v) ? d : v);

/** IV "bucket" used by in-game appraisal search terms: 0 = 0, 1 = 1–5, 2 = 6–10, 3 = 11–14, 4 = 15 */
export function ivBucket(iv: number): 0 | 1 | 2 | 3 | 4 {
  if (iv === 0) return 0;
  if (iv <= 5) return 1;
  if (iv <= 10) return 2;
  if (iv <= 14) return 3;
  return 4;
}
export const BUCKET_LABELS = ['0', '1–5', '6–10', '11–14', '15'];

export const starsLabel = (n: number) => (n === 4 ? '★★★★ (hundo)' : n === 0 ? '0★' : '★'.repeat(n));
