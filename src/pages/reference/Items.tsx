import { useMemo, useState } from 'react';
import { Card, Empty, PageHeader, Segmented, StatTile } from '../../components/ui';
import { useData } from '../../lib/data';
import { fmt } from '../../lib/format';
import type { Item } from '../../lib/types';
import './refpages.css';

type GroupId = 'balls' | 'berries' | 'medicine' | 'boosts' | 'lures' | 'incense' | 'incubators' | 'evolution' | 'candy' | 'tms' | 'raid' | 'max' | 'rocket' | 'tickets' | 'storage' | 'other';
const GROUPS: { id: GroupId; label: string; icon: string; blurb: string }[] = [
  { id: 'balls', label: 'Poké Balls', icon: '⚪', blurb: 'Thrown to catch Pokémon.' },
  { id: 'berries', label: 'Berries & Treats', icon: '🍓', blurb: 'Fed during encounters, at Gyms, or to your buddy.' },
  { id: 'medicine', label: 'Medicine', icon: '💊', blurb: 'Heal and revive Pokémon after battles.' },
  { id: 'boosts', label: 'Boosts', icon: '✨', blurb: 'Temporary XP, Stardust and battle boosts.' },
  { id: 'lures', label: 'Lure Modules', icon: '🌸', blurb: 'Attach to a PokéStop to attract Pokémon for everyone.' },
  { id: 'incense', label: 'Incense', icon: '🌀', blurb: 'Attracts Pokémon to you personally.' },
  { id: 'incubators', label: 'Incubators', icon: '🥚', blurb: 'Hatch Eggs as you walk.' },
  { id: 'evolution', label: 'Evolution & Form Items', icon: '💎', blurb: 'Required for certain evolutions and form changes.' },
  { id: 'candy', label: 'Candy & Hyper Training', icon: '🍬', blurb: 'Rare Candy and Bottle Caps.' },
  { id: 'tms', label: 'TMs & Move Items', icon: '💿', blurb: 'Change a Pokémon’s moves.' },
  { id: 'raid', label: 'Raid Passes', icon: '🎟️', blurb: 'Entry to Raid Battles.' },
  { id: 'max', label: 'Max Battle', icon: '🔴', blurb: 'Max Particles and items for Dynamax & Gigantamax.' },
  { id: 'rocket', label: 'Team GO Rocket', icon: '🚀', blurb: 'Find Leaders, Giovanni and Shadow raids.' },
  { id: 'tickets', label: 'Tickets & Passes', icon: '🎫', blurb: 'Event tickets and pass points.' },
  { id: 'storage', label: 'Storage', icon: '🎒', blurb: 'Bag, Pokémon and collection space.' },
  { id: 'other', label: 'Other', icon: '📦', blurb: 'Everything else.' },
];

const CATEGORY_GROUP: Record<string, GroupId> = {
  pokeball: 'balls',
  food: 'berries', buddy_exclusive_food: 'berries',
  medicine: 'medicine',
  boost: 'boosts', xp_boost: 'boosts', stardust_boost: 'boosts',
  disk: 'lures',
  incense: 'incense',
  incubator: 'incubators',
  evolution_requirement: 'evolution', utilites: 'evolution',
  candy: 'candy', stat_increase: 'candy',
  move_reroll: 'tms',
  raid_ticket: 'raid',
  mp: 'max', bread: 'max',
  incident_ticket: 'rocket',
  global_event_ticket: 'tickets', event_pass_point: 'tickets',
  inventory_upgrade: 'storage', postcard_inventory: 'storage', sticker: 'storage',
};
const ID_GROUP: Record<string, GroupId> = { ITEM_MAX_BOOST: 'max', ITEM_LUCKY_FRIEND_APPLICATOR: 'other' };

/** Community-known HP restored by potions (the game text uses a placeholder) */
const HEAL: Record<string, number> = { ITEM_POTION: 20, ITEM_SUPER_POTION: 50, ITEM_HYPER_POTION: 200 };

const isUndef = (s: string | null | undefined) => !s || s.trim() === '' || s.trim().toUpperCase() === 'UNDEFINED';

function cleanDesc(it: Item): { text: string | null; community: boolean } {
  if (isUndef(it.desc)) return { text: null, community: false };
  let t = it.desc;
  let community = false;
  if (HEAL[it.id] !== undefined && /\{\d\}/.test(t)) { t = t.replace(/\{\d\}/g, String(HEAL[it.id])); community = true; }
  // Remove sentences that only exist to show a placeholder value; otherwise neutralise placeholders
  t = t.replace(/[^.!?]*\{\d[^}]*\}[^.!?]*[.!?]?/g, (sentence) => (/^\s*Each|^\s*It holds/i.test(sentence) ? '' : sentence.replace(/\{\d[^}]*\}/g, 'a set number of')));
  return { text: t.trim() || null, community };
}

interface Row { key: string; name: string; group: GroupId; level: number | null; desc: string | null; community: boolean; variants: { id: string; desc: string | null }[] }

function buildRows(items: Item[]): Row[] {
  const byKey = new Map<string, Row>();
  for (const it of items) {
    if (isUndef(it.name)) continue;
    const group = ID_GROUP[it.id] ?? CATEGORY_GROUP[it.category] ?? 'other';
    const key = `${group}|${it.name}`;
    const d = cleanDesc(it);
    const level = it.level == null || it.level >= 100 ? null : it.level;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { key, name: it.name, group, level, desc: d.text, community: d.community, variants: [{ id: it.id, desc: d.text }] });
    } else {
      existing.variants.push({ id: it.id, desc: d.text });
      if (level !== null && (existing.level === null || level < existing.level)) existing.level = level;
    }
  }
  const rows = [...byKey.values()];
  for (const r of rows) {
    if (r.variants.length > 1) {
      const distinct = [...new Set(r.variants.map((v) => v.desc).filter(Boolean))] as string[];
      // one shared description → show it; event-specific descriptions → list them in a disclosure instead
      r.desc = distinct.length === 1 ? distinct[0] : null;
    }
  }
  return rows;
}

type Sort = 'group' | 'level' | 'name';

export default function Items() {
  const { reference } = useData();
  const rows = useMemo(() => buildRows(reference.items), [reference.items]);
  const [q, setQ] = useState('');
  const [group, setGroup] = useState<GroupId | 'all'>('all');
  const [sort, setSort] = useState<Sort>('group');

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (group !== 'all' && r.group !== group) return false;
      if (!s) return true;
      return r.name.toLowerCase().includes(s) || r.variants.some((v) => v.desc?.toLowerCase().includes(s));
    });
  }, [rows, q, group]);

  const byLevel = (a: Row, b: Row) => (a.level ?? 999) - (b.level ?? 999) || a.name.localeCompare(b.name);
  const counts = useMemo(() => {
    const c: Partial<Record<GroupId, number>> = {};
    for (const r of rows) c[r.group] = (c[r.group] || 0) + 1;
    return c;
  }, [rows]);
  const gated = rows.filter((r) => r.level !== null && r.level > 1).length;

  const renderItem = (r: Row, showGroup = false) => {
    const g = GROUPS.find((x) => x.id === r.group)!;
    const distinct = r.variants.length > 1 ? [...new Set(r.variants.map((v) => v.desc).filter(Boolean))] as string[] : [];
    return (
      <li key={r.key} className="rp-item">
        <div className="nm">
          {showGroup && <span aria-hidden title={g.label}>{g.icon}</span>}
          {r.name}
          {r.variants.length > 1 && <span className="badge" title="Separate entries with this name in the game data">×{r.variants.length} variants</span>}
        </div>
        <div className="lv">{r.level === null ? <span title="Not unlocked by trainer level in the game data">—</span> : r.level <= 1 ? <span>From start</span> : <>Level <b>{r.level}</b></>}</div>
        <div className="ds">
          {r.desc ?? (distinct.length ? <span className="faint">Event-specific variants — see below.</span> : <span className="faint">No description in game data.</span>)}
          {r.community && <span className="faint"> (HP value community-known)</span>}
        </div>
        {r.desc === null && distinct.length > 0 && (
          <details>
            <summary>Show {distinct.length} variant description{distinct.length === 1 ? '' : 's'}</summary>
            <ul>{distinct.map((d) => <li key={d}>{d}</li>)}</ul>
          </details>
        )}
      </li>
    );
  };

  const visibleGroups = GROUPS.filter((g) => filtered.some((r) => r.group === g.id));

  return (
    <div className="stack">
      <PageHeader title="Items" subtitle="Every item in the game data, grouped by category, with its description and the trainer level that unlocks it." />

      <div className="grid grid-4">
        <StatTile label="Items" value={fmt(rows.length)} sub={`${fmt(reference.items.length)} game-data entries`} />
        <StatTile label="Categories" value={fmt(Object.keys(counts).length)} />
        <StatTile label="Level-gated" value={fmt(gated)} sub="unlock after level 1" />
        <StatTile label="Showing" value={fmt(filtered.length)} sub={group === 'all' ? 'all categories' : GROUPS.find((g) => g.id === group)?.label} />
      </div>

      <div className="rp-toolbar">
        <input className="input" placeholder="Search items or descriptions…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Segmented<Sort> size="sm" value={sort} onChange={setSort} options={[{ id: 'group', label: 'By category' }, { id: 'level', label: 'By unlock level' }, { id: 'name', label: 'A–Z' }]} />
      </div>
      <div className="chips">
        <button className={`chip ${group === 'all' ? 'on' : ''}`} onClick={() => setGroup('all')}>All <span className="faint">{rows.length}</span></button>
        {GROUPS.filter((g) => counts[g.id]).map((g) => (
          <button key={g.id} className={`chip ${group === g.id ? 'on' : ''}`} onClick={() => setGroup(group === g.id ? 'all' : g.id)}>
            <span aria-hidden>{g.icon}</span>{g.label} <span className="faint">{counts[g.id]}</span>
          </button>
        ))}
      </div>

      {filtered.length === 0 ? <Card><Empty icon="🎒">No items match{q ? ` “${q}”` : ''}.</Empty></Card> : sort === 'group' ? (
        <div className="rp-groups">
          {visibleGroups.map((g) => {
            const list = filtered.filter((r) => r.group === g.id).sort(byLevel);
            return (
              <Card key={g.id} id={`items-${g.id}`} title={<>{g.icon} {g.label}</>} actions={<span className="faint small">{list.length}</span>} flush>
                <div className="small faint" style={{ padding: '8px 18px 0' }}>{g.blurb}</div>
                <ul className="rp-item-list">{list.map((r) => renderItem(r))}</ul>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card flush>
          <ul className="rp-item-list">{[...filtered].sort(sort === 'level' ? byLevel : (a, b) => a.name.localeCompare(b.name)).map((r) => renderItem(r, true))}</ul>
        </Card>
      )}

      <p className="rp-note">Unlock levels come from the game master. “—” means the item isn't unlocked by trainer level (it's granted by events, purchases, research or other features). Items without a name in the game data are hidden.</p>
    </div>
  );
}
