import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { GameData, Move, Pokemon, RankingRow, Reference, Settings, TypeChart } from './types';

const BASE = import.meta.env.BASE_URL + 'data/';

async function getJson<T>(file: string): Promise<T> {
  const res = await fetch(BASE + file);
  if (!res.ok) throw new Error(`Failed to load ${file}: ${res.status}`);
  return res.json();
}

function build(pokemon: Pokemon[], moves: Record<string, Move>, types: TypeChart, settings: Settings, reference: Reference): GameData {
  const byId: Record<string, Pokemon> = {};
  for (const p of pokemon) byId[p.id] = p;
  const families: Record<string, Pokemon[]> = {};
  for (const p of pokemon) if (!p.megaOf) (families[p.family] ||= []).push(p);
  // order a family by evolution depth
  for (const list of Object.values(families)) {
    const depth = (p: Pokemon): number => (p.parentId && byId[p.parentId] ? 1 + depth(byId[p.parentId]) : 0);
    list.sort((a, b) => depth(a) - depth(b) || a.dex - b.dex);
  }
  const pv: Record<string, Pokemon> = {};
  for (const p of pokemon) if (p.pvpoke && !pv[p.pvpoke]) pv[p.pvpoke] = p;
  return {
    pokemon, byId, moves, types, settings, reference,
    family: (f) => families[f] || [],
    fromPvpoke: (id) => {
      if (pv[id]) return { pokemon: pv[id], shadow: false };
      if (id.endsWith('_shadow') && pv[id.slice(0, -7)]) return { pokemon: pv[id.slice(0, -7)], shadow: true };
      return null;
    },
  };
}

const Ctx = createContext<GameData | null>(null);

export function DataProvider({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const [data, setData] = useState<GameData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    Promise.all([
      getJson<Pokemon[]>('pokemon.json'),
      getJson<Record<string, Move>>('moves.json'),
      getJson<TypeChart>('types.json'),
      getJson<Settings>('settings.json'),
      getJson<Reference>('reference.json'),
    ])
      .then(([p, m, t, s, r]) => setData(build(p, m, t, s, r)))
      .catch((e) => setError(String(e)));
  }, []);
  if (error) return <div className="boot-error"><h2>Couldn’t load game data</h2><p>{error}</p><button className="btn" onClick={() => location.reload()}>Retry</button></div>;
  if (!data) return <>{fallback}</>;
  return <Ctx.Provider value={data}>{children}</Ctx.Provider>;
}

/** Access the static game data. Only usable below <DataProvider>. */
export function useData(): GameData {
  const d = useContext(Ctx);
  if (!d) throw new Error('useData outside DataProvider');
  return d;
}

// ---------------------------------------------------------------- rankings
const rankingCache = new Map<string, Promise<RankingRow[]>>();
export function loadRankings(key: string): Promise<RankingRow[]> {
  if (!rankingCache.has(key)) rankingCache.set(key, getJson<RankingRow[]>(`rankings/${key}.json`));
  return rankingCache.get(key)!;
}

/** Load a PvPoke ranking set by key ("great", "ultra", "master", "little", or a cup key). */
export function useRankings(key: string | null): { rows: RankingRow[] | null; loading: boolean; error: string | null } {
  const [state, setState] = useState<{ rows: RankingRow[] | null; loading: boolean; error: string | null }>({ rows: null, loading: !!key, error: null });
  useEffect(() => {
    if (!key) return;
    let live = true;
    setState({ rows: null, loading: true, error: null });
    loadRankings(key).then(
      (rows) => live && setState({ rows, loading: false, error: null }),
      (e) => live && setState({ rows: null, loading: false, error: String(e) }),
    );
    return () => { live = false; };
  }, [key]);
  return state;
}

// ---------------------------------------------------------------- helpers
/** Display name including form, e.g. "Alolan Rattata", "Mega Charizard X", "Giratina (Origin Forme)" */
export function displayName(p: Pokemon, shadow = false): string {
  let n = p.name;
  if (p.formName) {
    const f = p.formName;
    if (/^Mega [XY]$/.test(f)) n = `Mega ${p.name} ${f.slice(-1)}`;
    else if (f === 'Mega' || f === 'Primal') n = `${f} ${p.name}`;
    else if (/^(Alolan|Galarian|Hisuian|Paldean)/.test(f)) n = `${f} ${p.name}`;
    else if (f.toLowerCase().includes(p.name.toLowerCase())) n = f;
    else n = `${p.name} (${f})`;
  }
  return shadow ? `Shadow ${n}` : n;
}

export function moveName(moves: Record<string, Move>, id: string): string {
  return moves[id]?.name ?? id.replace(/_FAST$/, '').toLowerCase().replace(/(^|_)(\w)/g, (_, a, b) => (a ? ' ' : '') + b.toUpperCase());
}

/** All moves a Pokémon can know, optionally including elite (legacy/Elite TM) moves */
export function movePool(p: Pokemon, includeElite = true): { fast: string[]; charged: string[] } {
  return {
    fast: [...p.fast, ...(includeElite ? p.eliteFast : [])],
    charged: [...p.charged, ...(includeElite ? p.eliteCharged : [])],
  };
}

export const isElite = (p: Pokemon, moveId: string) => p.eliteFast.includes(moveId) || p.eliteCharged.includes(moveId);
