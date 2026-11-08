import { useMemo } from 'react';
import { Card, Empty, Field, Mon, NumberInput, PageHeader, Select, StatTile, Switch, TypeBadge, Types, useShowMore, useSort } from '../../components/ui';
import { displayName, useData } from '../../lib/data';
import { duration, fmt, pct, plural } from '../../lib/format';
import { TYPES, cp } from '../../lib/pogo';
import { usePrefs, useStored } from '../../lib/storage';
import type { PokeType, Pokemon } from '../../lib/types';
import { num } from './toolUtils';
import './tools.css';

const LEVEL_NAMES: Record<number, string> = { 0: 'Not yet Mega Evolved', 1: 'Base', 2: 'High', 3: 'Max' };
// Community-known: Mega Evolutions needed to reach each Mega Level (counted at most once per day).
const LEVEL_EVOS: Record<number, string> = { 1: '1', 2: '7', 3: '30' };

export default function MegaCalculator() {
  const { pokemon, byId, settings } = useData();
  const [prefs] = usePrefs();
  const [showUnreleased, setShowUnreleased] = useStored<boolean>('tools.mega.unreleased', prefs.showUnreleased);
  const [typeFilter, setTypeFilter] = useStored<PokeType | 'all'>('tools.mega.type', 'all');

  const megas = useMemo(() => pokemon.filter((p) => p.megaOf && (showUnreleased || p.released)), [pokemon, showUnreleased]);
  const filtered = typeFilter === 'all' ? megas : megas.filter((p) => p.types.includes(typeFilter));
  const lv = settings.megaLevels;
  const same = lv[lv.length - 1]?.sameTypeAttackBoost ?? 1.3;
  const other = lv[lv.length - 1]?.differentTypeAttackBoost ?? 1.1;

  const { sorted, th } = useSort(filtered, { key: 'atk', dir: -1 }, {
    name: (p) => displayName(p), atk: (p) => p.atk, def: (p) => p.def, sta: (p) => p.sta,
    cp: (p) => cp(p, settings, 50), first: (p) => p.megaEnergy?.first ?? 0, after: (p) => p.megaEnergy?.after ?? 0,
  });
  const { visible, more } = useShowMore(sorted, 40);

  return (
    <div className="stack">
      <PageHeader title="Mega Evolution" subtitle="Every Mega and Primal form with stats, Mega Energy costs, raid boosts and Mega Level perks — plus an energy planner." />

      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        <Planner megas={megas} />
        <BestForType megas={megas} same={same} other={other} />
      </div>

      <Card title="How Mega boosts work">
        <div className="grid grid-3">
          <div className="tile"><div className="bold">Same-type attacks ×{same}</div><div className="small muted">While your Mega is active in a raid or gym battle, every trainer's attacks that match one of its types deal ×{same} damage.</div></div>
          <div className="tile"><div className="bold">Other attacks ×{other}</div><div className="small muted">All other attacks from every trainer get ×{other}.</div></div>
          <div className="tile"><div className="bold">Bonus candy</div><div className="small muted">Catching Pokémon that share a type with your active Mega gives extra candy (and Candy XL chance / XP at higher Mega Levels).</div></div>
        </div>
      </Card>

      <Card title="Mega Level progression" flush footer={<span className="tool-note">Cooldowns, boosts and bonuses from the game master. Evolutions needed per level are community-known (Mega Evolving counts towards levels at most once per day). Re-Mega Evolving costs the “subsequent” energy, reduced further as the cooldown elapses.</span>}>
        <div className="table-wrap">
          <table className="table compact">
            <thead><tr><th>Mega Level</th><th className="num">Evolutions</th><th className="num">Cooldown</th><th className="num">Same type</th><th className="num">Other types</th><th className="num">Extra candy</th><th className="num">XL chance</th><th className="num">Extra XP</th></tr></thead>
            <tbody>
              {lv.map((l) => {
                const x = l as typeof l & { sameTypeExtraCatchXp?: number; sameTypeExtraCatchCandyXlChance?: number };
                return (
                  <tr key={l.level}>
                    <td><b>{l.level}</b> <span className="muted small">{LEVEL_NAMES[l.level] ?? ''}</span></td>
                    <td className="num">{LEVEL_EVOS[l.level] ?? '—'}</td>
                    <td className="num">{duration(l.cooldownMs)}</td>
                    <td className="num">×{l.sameTypeAttackBoost}</td>
                    <td className="num">×{l.differentTypeAttackBoost}</td>
                    <td className="num">+{l.sameTypeExtraCatchCandy}</td>
                    <td className="num">{x.sameTypeExtraCatchCandyXlChance ? pct(x.sameTypeExtraCatchCandyXlChance * 100, 0) : '—'}</td>
                    <td className="num">{x.sameTypeExtraCatchXp ? `+${x.sameTypeExtraCatchXp}` : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title={`All Megas & Primals (${filtered.length})`} actions={
        <div className="row">
          <Select value={typeFilter} onChange={setTypeFilter} options={[{ id: 'all' as const, label: 'All types' }, ...TYPES.map((t) => ({ id: t, label: t[0].toUpperCase() + t.slice(1) }))]} />
          <Switch checked={showUnreleased} onChange={setShowUnreleased} label="Unreleased" />
        </div>
      } flush>
        {!filtered.length ? <Empty icon="💠">No Megas match this filter.</Empty> : (
          <div className="table-wrap">
            <table className="table compact">
              <thead><tr>{th('name', 'Mega')}<th className="hide-mobile">Base</th>{th('atk', 'Atk', { num: true })}{th('def', 'Def', { num: true })}{th('sta', 'Sta', { num: true })}{th('cp', 'Max CP', { num: true, title: '15/15/15 at level 50' })}{th('first', 'First', { num: true, title: 'Mega Energy for the first Mega Evolution' })}{th('after', 'Again', { num: true, title: 'Mega Energy for subsequent Mega Evolutions' })}</tr></thead>
              <tbody>
                {visible.map((p) => {
                  const base = p.megaOf ? byId[p.megaOf] : null;
                  return (
                    <tr key={p.id}>
                      <td><Mon p={p} size={30} showTypes />{!p.released && <span className="badge warn" style={{ marginLeft: 4 }}>Unreleased</span>}</td>
                      <td className="hide-mobile small">{base ? <span className="muted">{displayName(base)} <span className="faint">({base.atk}/{base.def}/{base.sta})</span></span> : '—'}</td>
                      <td className="num bold">{p.atk}</td><td className="num">{p.def}</td><td className="num">{p.sta}</td>
                      <td className="num">{fmt(cp(p, settings, 50))}</td>
                      <td className="num">{p.megaEnergy ? fmt(p.megaEnergy.first) : '—'}</td>
                      <td className="num">{p.megaEnergy ? fmt(p.megaEnergy.after) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {more}
          </div>
        )}
      </Card>
    </div>
  );
}

function Planner({ megas }: { megas: Pokemon[] }) {
  const { settings } = useData();
  const [id, setId] = useStored<string>('tools.mega.plan', '');
  const [energy, setEnergy] = useStored<number | ''>('tools.mega.energy', '');
  const [before, setBefore] = useStored<boolean>('tools.mega.before', false);
  const [want, setWant] = useStored<number | ''>('tools.mega.want', 5);
  const opts = megas.filter((m) => m.megaEnergy).sort((a, b) => displayName(a).localeCompare(displayName(b)));
  const p = opts.find((m) => m.id === id) ?? opts[0];
  if (!p || !p.megaEnergy) return <Card title="Energy planner"><Empty icon="💠">No Mega data.</Empty></Card>;
  const { first, after } = p.megaEnergy;
  const e = num(energy);
  const possible = before ? (after > 0 ? Math.floor(e / after) : 0) : e >= first ? 1 + (after > 0 ? Math.floor((e - first) / after) : 0) : 0;
  const n = Math.max(1, num(want, 1));
  const needed = before ? n * after : first + (n - 1) * after;
  const nextAt = before ? (possible + 1) * after : possible === 0 ? first : first + possible * after;
  const cooldown = settings.megaLevels.find((l) => l.level === 1)?.cooldownMs;
  return (
    <Card title="Energy planner">
      <div className="col" style={{ gap: 12 }}>
        <Field label="Mega"><Select value={p.id} onChange={setId} options={opts.map((m) => ({ id: m.id, label: `${displayName(m)} (${m.megaEnergy!.first} / ${m.megaEnergy!.after})` }))} /></Field>
        <div className="row"><Mon p={p} size={40} showTypes /></div>
        <div className="fields">
          <Field label="Mega Energy on hand"><NumberInput value={energy} onChange={setEnergy} min={0} placeholder="0" /></Field>
          <Field label="Target Mega Evolutions"><NumberInput value={want} onChange={setWant} min={1} /></Field>
        </div>
        <Switch checked={before} onChange={setBefore} label="Already Mega Evolved this Pokémon before" />
        <div className="tool-tiles">
          <StatTile label="Possible now" value={fmt(possible)} sub={possible ? plural(possible, 'Mega Evolution') : `need ${fmt(first)}`} />
          <StatTile label="Energy for next" value={fmt(Math.max(0, nextAt - e))} sub="more needed" />
          <StatTile label={`For ${n}`} value={fmt(needed)} sub={e >= needed ? 'You have enough' : `${fmt(needed - e)} short`} />
        </div>
        <p className="tool-note">First Mega Evolution costs {fmt(first)}; each later one costs up to {fmt(after)} (less if part of the{cooldown ? ` ${duration(cooldown)}` : ''} cooldown has passed). A Mega lasts 8 hours.</p>
      </div>
    </Card>
  );
}

function BestForType({ megas, same, other }: { megas: Pokemon[]; same: number; other: number }) {
  const [type, setType] = useStored<PokeType>('tools.mega.best', 'dragon');
  const list = megas.filter((m) => m.types.includes(type)).sort((a, b) => b.atk - a.atk);
  return (
    <Card title="Best Mega to boost a type">
      <div className="col" style={{ gap: 12 }}>
        <Field label="Attack type you want boosted">
          <div className="chips">{TYPES.map((t) => <button key={t} className={`chip ${t === type ? 'on' : ''}`} onClick={() => setType(t)} style={{ padding: 0, border: t === type ? '2px solid var(--accent)' : '2px solid transparent', background: 'none' }}><TypeBadge type={t} small /></button>)}</div>
        </Field>
        {!list.length ? <Empty icon="💠">No Mega has the {type} type — any Mega still gives ×{other} to {type} attacks.</Empty> : (
          <div className="table-wrap" style={{ maxHeight: 320 }}>
            <table className="table compact">
              <thead><tr><th>Mega</th><th className="num">Atk</th><th>Also boosts</th></tr></thead>
              <tbody>
                {list.map((m, i) => (
                  <tr key={m.id} className={i === 0 ? 'sel' : ''}>
                    <td><Mon p={m} size={28} /></td>
                    <td className="num bold">{m.atk}</td>
                    <td>{m.types.filter((t) => t !== type).length ? <Types types={m.types.filter((t) => t !== type)} small /> : <span className="muted small">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="tool-note">Any of these gives ×{same} to {type} attacks for everyone in the raid; ranked by the Mega's own Attack stat (it usually attacks with STAB too).</p>
      </div>
    </Card>
  );
}
