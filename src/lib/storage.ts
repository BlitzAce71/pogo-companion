// Local persistence (localStorage) with cross-component + cross-tab sync.
import { useCallback, useEffect, useState } from 'react';

const PREFIX = 'pogo.';
const listeners = new Map<string, Set<() => void>>();

function read<T>(key: string, fallback: T): T {
  try {
    const s = localStorage.getItem(PREFIX + key);
    return s === null ? fallback : (JSON.parse(s) as T);
  } catch { return fallback; }
}
function emit(key: string) { listeners.get(key)?.forEach((f) => f()); }

export function getStored<T>(key: string, fallback: T): T { return read(key, fallback); }
export function setStored<T>(key: string, value: T) {
  try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* quota/private mode */ }
  emit(key);
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => { if (e.key?.startsWith(PREFIX)) emit(e.key.slice(PREFIX.length)); });
}

/** useState that persists to localStorage under `pogo.<key>` and syncs everywhere it is used. */
export function useStored<T>(key: string, fallback: T): [T, (v: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => read(key, fallback));
  useEffect(() => {
    const f = () => setValue(read(key, fallback));
    if (!listeners.has(key)) listeners.set(key, new Set());
    listeners.get(key)!.add(f);
    return () => { listeners.get(key)!.delete(f); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = useCallback((v: T | ((prev: T) => T)) => {
    const next = typeof v === 'function' ? (v as (p: T) => T)(read(key, fallback)) : v;
    setStored(key, next);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return [value, set];
}

// ---------------------------------------------------------------- preferences
export interface Prefs {
  trainerLevel: number;
  team: 'mystic' | 'valor' | 'instinct' | 'none';
  theme: 'system' | 'dark' | 'light';
  attackerLevel: number;       // default level for raid counter calcs
  showUnreleased: boolean;
  bestFriends: boolean;        // assume best-friend bonus in raid calcs
}
export const DEFAULT_PREFS: Prefs = { trainerLevel: 50, team: 'none', theme: 'system', attackerLevel: 40, showUnreleased: false, bestFriends: false };
export const usePrefs = () => {
  const [p, set] = useStored<Prefs>('prefs', DEFAULT_PREFS);
  return [{ ...DEFAULT_PREFS, ...p }, (patch: Partial<Prefs>) => set((prev) => ({ ...DEFAULT_PREFS, ...prev, ...patch }))] as const;
};

// ---------------------------------------------------------------- collection (dex checklists)
/** Flags tracked per Pokémon id */
export const DEX_FLAGS = [
  { key: 'caught', label: 'Caught', short: 'C', color: '#4f8ef7' },
  { key: 'shiny', label: 'Shiny', short: '✦', color: '#f2b631' },
  { key: 'lucky', label: 'Lucky', short: 'L', color: '#e8c547' },
  { key: 'hundo', label: '100% IV', short: '💯', color: '#e5484d' },
  { key: 'shadow', label: 'Shadow', short: 'S', color: '#8e4ec6' },
  { key: 'purified', label: 'Purified', short: 'P', color: '#a3c4f3' },
  { key: 'xxl', label: 'XXL', short: 'XXL', color: '#30a46c' },
  { key: 'xxs', label: 'XXS', short: 'XXS', color: '#12a594' },
  { key: 'shundo', label: 'Shundo', short: '✦💯', color: '#ff8b3d' },
  { key: 'dynamax', label: 'Dynamax', short: 'D', color: '#e93d82' },
  { key: 'gigantamax', label: 'Gigantamax', short: 'G', color: '#d6409f' },
] as const;
export type DexFlag = (typeof DEX_FLAGS)[number]['key'];
export type DexEntry = Partial<Record<DexFlag, 1>>;
export type Collection = Record<string, DexEntry>;

export function useCollection() {
  const [col, set] = useStored<Collection>('collection', {});
  const toggle = (id: string, flag: DexFlag, value?: boolean) => set((prev) => {
    const e = { ...(prev[id] || {}) };
    const on = value ?? !e[flag];
    if (on) e[flag] = 1; else delete e[flag];
    if (on && flag !== 'caught') e.caught = 1;
    if (!on && flag === 'caught') for (const k of Object.keys(e)) delete e[k as DexFlag];
    const next = { ...prev };
    if (Object.keys(e).length) next[id] = e; else delete next[id];
    return next;
  });
  return { collection: col, toggle, setAll: set };
}

// ---------------------------------------------------------------- my Pokémon (saved individuals)
export interface SavedMon {
  uid: string;
  id: string;                 // Pokemon id
  nickname?: string;
  cp?: number;
  level?: number;
  ivs?: [number, number, number];
  shadow?: boolean; purified?: boolean; lucky?: boolean; shiny?: boolean;
  fast?: string; charged?: string[];
  tags?: string[];
  notes?: string;
  added: number;
}
export function useMyPokemon() {
  const [list, set] = useStored<SavedMon[]>('mons', []);
  return {
    mons: list,
    add: (m: Omit<SavedMon, 'uid' | 'added'>) => set((prev) => [...prev, { ...m, uid: Math.random().toString(36).slice(2, 10), added: Date.now() }]),
    update: (uid: string, patch: Partial<SavedMon>) => set((prev) => prev.map((m) => (m.uid === uid ? { ...m, ...patch } : m))),
    remove: (uid: string) => set((prev) => prev.filter((m) => m.uid !== uid)),
    setAll: set,
  };
}

// ---------------------------------------------------------------- backup
export function exportAll(): string {
  const out: Record<string, unknown> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)!;
    if (k.startsWith(PREFIX) && !k.startsWith(PREFIX + 'live.')) out[k.slice(PREFIX.length)] = JSON.parse(localStorage.getItem(k)!);
  }
  return JSON.stringify({ app: 'pogo-companion', version: 1, exported: new Date().toISOString(), data: out }, null, 2);
}
export function importAll(json: string): number {
  const parsed = JSON.parse(json);
  if (parsed?.app !== 'pogo-companion' || typeof parsed.data !== 'object') throw new Error('Not a PoGo Companion backup file');
  let n = 0;
  for (const [k, v] of Object.entries(parsed.data)) { setStored(k, v); n++; }
  return n;
}
