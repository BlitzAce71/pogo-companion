// Dex information as a file: export My Dex or a scan's results, and merge such a file into My Dex.
import { displayName } from '../../lib/data';
import type { ScanAttributes } from '../../lib/scanner';
import { DEX_FLAGS, type Collection, type DexEntry, type DexFlag } from '../../lib/storage';
import type { GameData } from '../../lib/types';

/** One entry per Pokémon (or costume) id; `name` is only there for people reading the file. */
export interface DexFile {
  app: 'pogo-companion'; kind: 'dex'; version: 1; exported: string;
  /** where it came from: the whole My Dex, or one Box Scanner run */
  source: 'my-dex' | 'scan';
  note?: string;
  entries: { id: string; name?: string; flags: DexFlag[] }[];
}

const FLAG_KEYS = new Set<string>(DEX_FLAGS.map((f) => f.key));
const FLAG_ORDER = DEX_FLAGS.map((f) => f.key);

/** Readable name and Pokédex order for a My Dex key (a Pokémon id or a costume id). */
export function dexNaming(data: GameData) {
  return {
    name: (id: string): string | undefined => {
      const p = data.byId[id];
      if (p) return displayName(p);
      const c = data.costumeById[id];
      if (!c) return undefined;
      const b = data.byId[c.base];
      return `${b ? displayName(b) : c.base} · ${c.name}`;
    },
    order: (id: string): number => data.byId[id]?.dex ?? data.costumeById[id]?.dex ?? 99999,
  };
}

/** File name with today's date (local time): pogo-dex-2026-11-11.json, or pogo-dex-scan-… for a scan. */
export function dexFileName(source: DexFile['source']): string {
  const d = new Date(), p = (n: number) => String(n).padStart(2, '0');
  return `pogo-dex-${source === 'scan' ? 'scan-' : ''}${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.json`;
}

/** The file's text for a set of dex marks, in Pokédex order. */
export function dexFileText(marks: Collection, source: DexFile['source'], naming: ReturnType<typeof dexNaming>, note?: string): string {
  const entries = Object.entries(marks)
    .map(([id, e]) => ({ id, name: naming.name(id), flags: FLAG_ORDER.filter((f) => e[f]) }))
    .filter((e) => e.flags.length)
    .sort((a, b) => naming.order(a.id) - naming.order(b.id) || a.id.localeCompare(b.id));
  const file: DexFile = { app: 'pogo-companion', kind: 'dex', version: 1, exported: new Date().toISOString(), source, note, entries };
  // one entry per line: easy to read and to compare two files
  const head = JSON.stringify({ ...file, entries: undefined }, null, 2).replace(/\n}$/, '');
  return `${head},\n  "entries": [\n${entries.map((e) => `    ${JSON.stringify(e)}`).join(',\n')}\n  ]\n}\n`;
}

/**
 * Read dex marks from a file's text. Accepts a dex file, a full backup from Settings (its My Dex part),
 * or a bare My Dex object. Entries for Pokémon this app doesn't know are skipped and counted.
 */
export function parseDexFile(text: string, known: (id: string) => boolean): { marks: Collection; skipped: number } {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error('That file isn’t a PoGo Companion file'); }
  const o = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>;
  if (o.kind === 'mons') throw new Error('That’s a My Pokémon file — import it on the My Pokémon page');
  if (o.kind === 'pogo-companion box scan log') throw new Error('That’s a scan log, not a dex file');
  // every shape becomes a list of [id, flag names]
  let raw: [unknown, unknown][];
  const backup = (o.data && typeof o.data === 'object' ? (o.data as Record<string, unknown>).collection : undefined) as Record<string, unknown> | undefined;
  if (o.kind === 'dex' && Array.isArray(o.entries)) raw = o.entries.map((e) => [(e as Record<string, unknown>)?.id, (e as Record<string, unknown>)?.flags]);
  else if (backup && typeof backup === 'object') raw = Object.entries(backup).map(([id, e]) => [id, e && typeof e === 'object' ? Object.keys(e) : []]);
  else if (!o.app && !o.kind && !Array.isArray(parsed) && Object.values(o).length && Object.values(o).every((e) => e && typeof e === 'object' && !Array.isArray(e))) raw = Object.entries(o).map(([id, e]) => [id, Object.keys(e as object)]);
  else throw new Error('No dex information found in that file');
  const marks: Collection = {};
  let skipped = 0;
  for (const [id, flags] of raw) {
    const valid = Array.isArray(flags) ? flags.filter((f): f is DexFlag => typeof f === 'string' && FLAG_KEYS.has(f)) : [];
    if (typeof id !== 'string' || !known(id) || !valid.length) { skipped++; continue; }
    const e: DexEntry = { ...(marks[id] || {}), caught: 1 }; // any mark means it was caught
    for (const f of valid) e[f] = 1;
    marks[id] = e;
  }
  return { marks, skipped };
}

/** Add marks to a dex. Only ever adds: marks already there stay, nothing is removed. */
export function mergeDex(current: Collection, incoming: Collection): { next: Collection; /** marks added */ newMarks: number; /** entries that gained a mark */ changed: number; /** of those, entries that weren't in the dex at all */ newPokemon: number } {
  const next: Collection = { ...current };
  let newMarks = 0, changed = 0, newPokemon = 0;
  for (const [id, add] of Object.entries(incoming)) {
    const had = current[id];
    const e: DexEntry = { ...(had || {}) };
    let n = 0;
    for (const f of FLAG_ORDER) if (add[f] && !e[f]) { e[f] = 1; n++; }
    if (!n) continue;
    next[id] = e;
    newMarks += n; changed++;
    if (!had) newPokemon++;
  }
  return { next, newMarks, changed, newPokemon };
}

/**
 * The dex marks a scan stands for: each Pokémon is caught, shiny as seen, plus whatever the search
 * string says about the whole scan (lucky, shadow, 4*…). A costume is marked under its own entry —
 * with only the marks that make sense for a costume — and also registers its species as caught.
 */
export function scanDexMarks(answers: { id: string; costume?: string; shiny: boolean }[], attrs: ScanAttributes): Collection {
  const marks: Collection = {};
  const mark = (key: string, flags: DexFlag[]) => {
    const e: DexEntry = { ...(marks[key] || {}), caught: 1 };
    for (const f of flags) e[f] = 1;
    marks[key] = e;
  };
  const forCostume: DexFlag[] = ['shiny', 'lucky', 'hundo', 'threestar', 'nundo'];
  for (const a of answers) {
    const flags: DexFlag[] = [];
    if (a.shiny) flags.push('shiny');
    if (attrs.lucky) flags.push('lucky');
    if (attrs.shadow) flags.push('shadow');
    if (attrs.purified) flags.push('purified');
    if (attrs.dynamax) flags.push('dynamax');
    if (attrs.gigantamax) flags.push('gigantamax');
    if (attrs.stars === 4) flags.push(a.shiny ? 'shundo' : 'hundo');
    if (attrs.stars === 3) flags.push('threestar');
    if (attrs.nundo) flags.push('nundo');
    mark(a.costume || a.id, a.costume ? flags.filter((f) => forCostume.includes(f)) : flags);
    if (a.costume) mark(a.id, []);
  }
  return marks;
}
