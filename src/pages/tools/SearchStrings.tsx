import { useState } from 'react';
import { Card, Field, NumberInput, PageHeader, PokemonPicker, Segmented, Select, Switch, TypeBadge, copyText, useToast } from '../../components/ui';
import { TYPES } from '../../lib/pogo';
import { useStored } from '../../lib/storage';
import type { Pokemon } from '../../lib/types';
import { BUCKET_LABELS } from './toolUtils';
import './tools.css';

// ---------------------------------------------------------------- model
interface Term { v: string; not: boolean }
type Group = Term[]; // terms OR'd together; groups are AND'd

const termStr = (t: Term) => `${t.not ? '!' : ''}${t.v}`;
const toSearch = (groups: Group[]) => groups.filter((g) => g.length).map((g) => g.map(termStr).join(',')).join('&');
function parseSearch(s: string): Group[] {
  return s.split('&').map((part) => part.split(/[,;:]/).map((x) => x.trim()).filter(Boolean).map((x) => (x.startsWith('!') ? { v: x.slice(1).trim(), not: true } : { v: x, not: false }))).filter((g) => g.length);
}

// ---------------------------------------------------------------- catalog (in-game search terms)
const SPECIAL: [string, string][] = [
  ['shiny', 'Shiny Pokémon'], ['lucky', 'Lucky Pokémon'], ['shadow', 'Shadow Pokémon'], ['purified', 'Purified Pokémon'],
  ['legendary', 'Legendary Pokémon'], ['mythical', 'Mythical Pokémon'], ['ultra beasts', 'Ultra Beasts'], ['costume', 'Costumed / event Pokémon'],
  ['dynamax', 'Dynamax Pokémon'], ['gigantamax', 'Gigantamax Pokémon'], ['background', 'Any special or location background'],
  ['locationbackground', 'Location backgrounds'], ['specialbackground', 'Special (event) backgrounds'], ['adventureeffect', 'Pokémon with an Adventure Effect move'],
  ['favorite', 'Favorited'], ['defender', 'Currently defending a gym'], ['#', 'Has any tag'],
];
const ORIGIN: [string, string][] = [
  ['traded', 'Received in a trade'], ['hatched', 'Hatched from an egg'], ['raid', 'Caught in a raid'], ['research', 'Research reward'],
  ['rocket', 'Rescued from Team GO Rocket'], ['gbl', 'GO Battle League reward'], ['snapshot', 'GO Snapshot photobomb'],
];
const EVOLVE: [string, string][] = [
  ['evolve', 'Can evolve now (enough candy)'], ['evolvenew', 'Evolves into a new Pokédex entry'], ['megaevolve', 'Can Mega Evolve'],
  ['tradeevolve', 'Evolves for free after a trade'], ['item', 'Needs an item to evolve'], ['eggsonly', 'Baby / egg-only Pokémon'],
];
const MISC: [string, string][] = [
  ['xxs', 'XXS size'], ['xs', 'XS size'], ['xl', 'XL size'], ['xxl', 'XXL size'],
  ['male', 'Male'], ['female', 'Female'], ['genderunknown', 'Genderless'],
  ['buddy0', 'Never been a buddy'], ['buddy1', 'Buddy level 1'], ['buddy2', 'Good buddy'], ['buddy3', 'Great buddy'], ['buddy4', 'Ultra buddy'], ['buddy5', 'Best buddy'],
  ['@special', 'Knows a legacy / special move'], ['@weather', 'Has a move boosted by current weather'],
];
const REGIONS: [string, string][] = [
  ['kanto', '#1–151'], ['johto', '#152–251'], ['hoenn', '#252–386'], ['sinnoh', '#387–493'], ['unova', '#494–649'],
  ['kalos', '#650–721'], ['alola', '#722–809'], ['galar', '#810–898'], ['hisui', '#899–905'], ['paldea', '#906+'],
];

interface Preset { name: string; s: string; why: string }
const PRESETS: Preset[] = [
  { name: 'Transfer-safe trash', s: '!shiny&!lucky&!legendary&!mythical&!4*&!3*&!shadow&!costume&!favorite&!traded&!xxl&!xxs&!background', why: 'Everything that isn’t special in any way. Review before mass-transferring — add !#  to keep tagged Pokémon too.' },
  { name: 'PvP IV candidates', s: '0-1attack&3-4defense&3-4hp', why: 'Low Attack, high Defense/HP — the stat-product shape that ranks well in Great and Ultra League.' },
  { name: 'Great League ready', s: 'cp1400-1500&!traded', why: 'Already in the Great League sweet spot. Untraded only so the IVs are your own.' },
  { name: 'Little Cup', s: 'cp-500', why: 'Everything at 500 CP or less.' },
  { name: 'Raid attackers', s: '3*,4*&cp2500-', why: '3★/4★ appraisal AND at least 2500 CP — your strongest high-IV attackers. (The comma binds first.)' },
  { name: 'Hundos', s: '4*', why: 'Perfect 15/15/15 Pokémon.' },
  { name: 'Nundos', s: '0attack&0defense&0hp', why: 'Perfect 0/0/0 Pokémon.' },
  { name: 'Lucky-trade fodder', s: 'age365-&!lucky&!traded&!favorite', why: 'Caught over a year ago and never traded — older Pokémon have better lucky-trade odds.' },
  { name: 'Rocket shadow cleanup', s: 'shadow&0*,1*&!legendary&!mythical&!favorite', why: 'Low-IV common shadows to purify (for the XP/Stardust) or transfer.' },
  { name: 'Long-distance trade candy', s: 'distance100-&!traded&!favorite', why: 'Caught 100 km+ away — trading these gives +3 candy.' },
  { name: 'Free trade evolutions', s: 'traded&tradeevolve', why: 'Traded Pokémon that now evolve for zero candy.' },
  { name: 'Lucky Egg session', s: 'evolvenew', why: 'Evolutions that register new Pokédex entries (+1,000 XP each).' },
  { name: 'Legacy movesets', s: '@special', why: 'Pokémon that know an event-exclusive or legacy move.' },
  { name: 'Size records', s: 'xxl,xxs', why: 'XXL or XXS Pokémon (showcases, Pikachu Libre, medals).' },
  { name: 'Caught today', s: 'age0', why: 'Everything caught in the last day.' },
  { name: 'Untagged', s: '!#', why: 'Pokémon without any tag — handy for organising a new batch.' },
];

export default function SearchStrings() {
  const [groups, setGroups] = useStored<Group[]>('tools.search.groups', []);
  const [mode, setMode] = useState<'and' | 'or'>('and');
  const [negate, setNegate] = useState(false);
  const [active, setActive] = useState<number | null>(null);
  const [saved, setSaved] = useStored<{ name: string; s: string }[]>('tools.search.saved', []);
  const [saveName, setSaveName] = useState('');
  const [draft, setDraft] = useState<string | null>(null); // raw text while typing, so trailing , & ! aren't stripped
  const toast = useToast();
  const s = toSearch(groups);

  const add = (v: string) => {
    const t: Term = { v, not: negate };
    setGroups((prev) => {
      const g = prev.map((x) => [...x]);
      const target = active !== null && g[active] ? active : g.length - 1;
      if (mode === 'or' && g.length && target >= 0) { if (!g[target].some((x) => x.v === v && x.not === t.not)) g[target].push(t); return g; }
      return [...g, [t]];
    });
    if (mode === 'and') setActive(null);
  };
  const remove = (gi: number, ti: number) => setGroups((prev) => prev.map((g, i) => (i === gi ? g.filter((_, j) => j !== ti) : g)).filter((g) => g.length));
  const toggleNot = (gi: number, ti: number) => setGroups((prev) => prev.map((g, i) => (i === gi ? g.map((t, j) => (j === ti ? { ...t, not: !t.not } : t)) : g)));
  const copy = async (str: string) => toast.show((await copyText(str)) ? 'Copied — paste it into the in-game search' : 'Copy failed — select and copy manually');

  return (
    <div className="stack">
      <PageHeader title="Search Strings" subtitle="Build in-game Pokémon storage search strings with AND, OR and NOT — or start from a preset." />
      <Card title="Your search string" actions={<div className="row"><button className="btn sm" onClick={() => { setGroups([]); setActive(null); }} disabled={!s}>Clear</button><button className="btn primary sm" onClick={() => copy(s)} disabled={!s}>📋 Copy</button></div>}>
        <div className="col" style={{ gap: 12 }}>
          <textarea className="search-preview" rows={2} value={draft ?? s} placeholder="Tap terms below, or type a search string here…" onChange={(e) => { setDraft(e.target.value); setGroups(parseSearch(e.target.value)); }} onBlur={() => setDraft(null)} spellCheck={false} aria-label="Search string" />
          {groups.length > 0 && (
            <div className="row" style={{ gap: 6 }}>
              {groups.map((g, gi) => (
                <div key={gi} className="row" style={{ gap: 6 }}>
                  {gi > 0 && <span className="search-op" title="AND">&amp;</span>}
                  <div className={`search-group ${active === gi ? 'on' : ''}`} onClick={() => setActive(active === gi ? null : gi)} title="Tap to select this group (OR terms are added here)">
                    {g.map((t, ti) => (
                      <span key={ti} className="row" style={{ gap: 4 }}>
                        {ti > 0 && <span className="search-op" title="OR">,</span>}
                        <span className={`search-term ${t.not ? 'not' : ''}`}>
                          <span onClick={(e) => { e.stopPropagation(); toggleNot(gi, ti); }} style={{ cursor: 'pointer' }} title="Tap to toggle NOT">{termStr(t)}</span>
                          <button onClick={(e) => { e.stopPropagation(); remove(gi, ti); }} aria-label={`Remove ${t.v}`}>✕</button>
                        </span>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="row">
            <Segmented size="sm" value={mode} onChange={setMode} options={[{ id: 'and', label: '& AND (new group)' }, { id: 'or', label: ', OR (into selected group)' }]} />
            <Switch checked={negate} onChange={setNegate} label="NOT (!)" />
          </div>
          <p className="tool-note">Tap a term to toggle <code>!</code>; tap a group to select it for OR terms (otherwise OR adds to the last group).</p>
        </div>
      </Card>

      <div className="split" style={{ gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)' }}>
        <div className="stack">
          <TermCard title="Special" items={SPECIAL} add={add} />
          <TermCard title="How it was obtained" items={ORIGIN} add={add} />
          <TermCard title="Evolution" items={EVOLVE} add={add} />
          <Card title="Appraisal">
            <div className="col" style={{ gap: 12 }}>
              <div className="chips">{['0*', '1*', '2*', '3*', '4*'].map((x) => <button key={x} className="chip mono" onClick={() => add(x)}>{x}</button>)}</div>
              <StatRange add={add} />
              <table className="table compact" style={{ maxWidth: 380 }}>
                <thead><tr><th>Bucket</th>{BUCKET_LABELS.map((_, i) => <th key={i} className="num">{i}</th>)}</tr></thead>
                <tbody><tr><td className="small muted">IV</td>{BUCKET_LABELS.map((l, i) => <td key={i} className="num small">{l}</td>)}</tr></tbody>
              </table>
              <p className="tool-note">Stars: 0* = 0–22 total IV, 1* = 23–29, 2* = 30–36, 3* = 37–44, 4* = 45 (hundo).</p>
            </div>
          </Card>
          <Card title="Types & moves">
            <div className="col" style={{ gap: 12 }}>
              <div className="chips">{TYPES.map((t) => <button key={t} className="chip" style={{ padding: 0, border: 0, background: 'none' }} onClick={() => add(t)} title={`Pokémon of ${t} type`}><TypeBadge type={t} small /></button>)}</div>
              <MoveBuilder add={add} />
            </div>
          </Card>
          <TermCard title="Size, gender, buddy & moves" items={MISC} add={add} />
          <TermCard title="Regions" items={REGIONS} add={add} />
        </div>
        <div className="stack">
          <Card title="Numbers">
            <div className="col" style={{ gap: 12 }}>
              <RangeBuilder label="CP" prefix="cp" add={add} />
              <RangeBuilder label="HP" prefix="hp" add={add} />
              <RangeBuilder label="Age (days since caught)" prefix="age" add={add} />
              <RangeBuilder label="Distance (km from you)" prefix="distance" add={add} />
              <RangeBuilder label="Pokédex number" prefix="" add={add} />
              <YearPicker add={add} />
            </div>
          </Card>
          <SpeciesBuilder add={add} />
          <Card title="Operator precedence">
            <div className="small" style={{ lineHeight: 1.6 }}>
              <p style={{ marginTop: 0 }}><b>OR binds tighter than AND.</b> <code>,</code> <code>;</code> and <code>:</code> mean OR and are evaluated before <code>&amp;</code> (AND). There are no parentheses.</p>
              <p><code>fire,water&amp;shiny</code> = (fire OR water) AND shiny.</p>
              <p><code>!</code> negates only the single term it prefixes: <code>!fire,water</code> = (NOT fire) OR water — which matches almost everything. To exclude both, use <code>!fire&amp;!water</code>.</p>
              <p style={{ marginBottom: 0 }}>Ranges use a dash: <code>cp1400-1500</code>, <code>cp-500</code> (up to 500), <code>age365-</code> (365 or more).</p>
            </div>
          </Card>
          <Card title="Saved strings">
            <div className="col" style={{ gap: 10 }}>
              <div className="row nowrap">
                <input className="input" placeholder="Name this search…" value={saveName} onChange={(e) => setSaveName(e.target.value)} />
                <button className="btn sm" disabled={!s} onClick={() => { setSaved((prev) => [...prev, { name: saveName.trim() || `Search ${prev.length + 1}`, s }]); setSaveName(''); toast.show('Saved'); }}>Save</button>
              </div>
              {!saved.length ? <p className="muted small" style={{ margin: 0 }}>Nothing saved yet.</p> : saved.map((x, i) => (
                <div key={i} className="tile preset">
                  <div className="row"><b>{x.name}</b><span className="spacer" />
                    <button className="btn ghost sm" onClick={() => setGroups(parseSearch(x.s))}>Load</button>
                    <button className="btn ghost sm" onClick={() => copy(x.s)}>Copy</button>
                    <button className="btn ghost sm" onClick={() => setSaved((prev) => prev.filter((_, j) => j !== i))} aria-label="Delete">✕</button>
                  </div>
                  <code>{x.s}</code>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      <Card title="Preset library">
        <div className="grid grid-auto">
          {PRESETS.map((p) => (
            <div key={p.name} className="tile preset">
              <div className="row"><b>{p.name}</b><span className="spacer" />
                <button className="btn ghost sm" onClick={() => { setGroups(parseSearch(p.s)); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Use</button>
                <button className="btn ghost sm" onClick={() => copy(p.s)}>Copy</button>
              </div>
              <code>{p.s}</code>
              <span className="small muted">{p.why}</span>
            </div>
          ))}
        </div>
      </Card>
      {toast.node}
    </div>
  );
}

function TermCard({ title, items, add }: { title: string; items: [string, string][]; add: (v: string) => void }) {
  return (
    <Card title={title}>
      <div className="chips">{items.map(([v, d]) => <button key={v} className="chip mono" title={d} onClick={() => add(v)}>{v}</button>)}</div>
    </Card>
  );
}

function StatRange({ add }: { add: (v: string) => void }) {
  const [stat, setStat] = useState<'attack' | 'defense' | 'hp'>('attack');
  const [lo, setLo] = useState(3);
  const [hi, setHi] = useState(4);
  const a = Math.min(lo, hi), b = Math.max(lo, hi);
  const term = `${a === b ? a : `${a}-${b}`}${stat}`;
  const bucketOpts = BUCKET_LABELS.map((l, i) => ({ id: i, label: `${i} (${l})` }));
  return (
    <div className="row">
      <Select value={stat} onChange={setStat} options={[{ id: 'attack', label: 'Attack' }, { id: 'defense', label: 'Defense' }, { id: 'hp', label: 'HP' }]} />
      <Select value={lo} onChange={setLo} options={bucketOpts} />
      <span className="muted">to</span>
      <Select value={hi} onChange={setHi} options={bucketOpts} />
      <button className="btn sm" onClick={() => add(term)}>Add <code>{term}</code></button>
    </div>
  );
}

function RangeBuilder({ label, prefix, add }: { label: string; prefix: string; add: (v: string) => void }) {
  const [lo, setLo] = useState<number | ''>('');
  const [hi, setHi] = useState<number | ''>('');
  const term = lo === '' && hi === '' ? '' : lo !== '' && hi !== '' && lo === hi ? `${prefix}${lo}` : `${prefix}${lo === '' ? '' : lo}-${hi === '' ? '' : hi}`;
  return (
    <Field label={label}>
      <div className="row nowrap">
        <NumberInput value={lo} onChange={setLo} min={0} placeholder="min" style={{ width: 90 }} />
        <span className="muted">–</span>
        <NumberInput value={hi} onChange={setHi} min={0} placeholder="max" style={{ width: 90 }} />
        <button className="btn sm" disabled={!term} onClick={() => add(term)}>Add{term && <code style={{ marginLeft: 4 }}>{term}</code>}</button>
      </div>
    </Field>
  );
}

function YearPicker({ add }: { add: (v: string) => void }) {
  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: thisYear - 2016 + 1 }, (_, i) => 2016 + i);
  return (
    <Field label="Year caught">
      <div className="chips">{years.map((y) => <button key={y} className="chip mono" onClick={() => add(`year${y}`)}>year{y}</button>)}</div>
    </Field>
  );
}

function MoveBuilder({ add }: { add: (v: string) => void }) {
  const [slot, setSlot] = useState<'' | '1' | '2' | '3'>('');
  const [type, setType] = useState<string>('fire');
  const [moveName, setMoveName] = useState('');
  const term = `@${slot}${moveName.trim() ? moveName.trim().toLowerCase() : type}`;
  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="row">
        <Select value={slot} onChange={setSlot} options={[{ id: '', label: 'Any move' }, { id: '1', label: '@1 Fast move' }, { id: '2', label: '@2 Charged move' }, { id: '3', label: '@3 2nd charged' }]} />
        <Select value={type} onChange={setType} options={TYPES.map((t) => ({ id: t, label: `${t} type` }))} />
        <input className="input" style={{ flex: 1, minWidth: 120 }} placeholder="…or move name" value={moveName} onChange={(e) => setMoveName(e.target.value)} />
        <button className="btn sm" onClick={() => add(term)}>Add <code>{term}</code></button>
      </div>
      <p className="tool-note"><code>@fire</code> = knows any Fire move, <code>@1fire</code> = Fire fast move, <code>@3fire</code> = Fire second charged move, <code>@hydro cannon</code> = knows Hydro Cannon.</p>
    </div>
  );
}

function SpeciesBuilder({ add }: { add: (v: string) => void }) {
  const [p, setP] = useState<Pokemon | null>(null);
  const [tag, setTag] = useState('');
  const name = p ? p.name.toLowerCase() : '';
  return (
    <Card title="Species, family & tags">
      <div className="col" style={{ gap: 10 }}>
        <PokemonPicker value={p} onChange={setP} allowClear placeholder="Pick a species…" />
        {p && (
          <div className="row">
            <button className="btn sm" onClick={() => add(name)}>Species <code>{name}</code></button>
            <button className="btn sm" onClick={() => add(`+${name}`)}>Whole family <code>+{name}</code></button>
            <button className="btn sm" onClick={() => add(String(p.dex))}>Dex <code>{p.dex}</code></button>
          </div>
        )}
        <div className="row nowrap">
          <input className="input" placeholder="Tag name" value={tag} onChange={(e) => setTag(e.target.value)} />
          <button className="btn sm" disabled={!tag.trim()} onClick={() => add(`#${tag.trim()}`)}>Add tag</button>
        </div>
        <p className="tool-note"><code>+name</code> matches every member of the family. Species names follow your game language.</p>
      </div>
    </Card>
  );
}
