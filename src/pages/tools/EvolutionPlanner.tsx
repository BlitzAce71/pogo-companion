import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Card, Empty, Field, Mon, NumberInput, PageHeader, PokemonPicker, Select, StatTile, Switch } from '../../components/ui';
import { displayName, useData } from '../../lib/data';
import { fmt, plural } from '../../lib/format';
import { useStored } from '../../lib/storage';
import type { Evolution, Pokemon } from '../../lib/types';
import { clamp, num, usePokemonParam } from './toolUtils';
import './tools.css';

// Community-known XP values (not in the game data we ship):
const XP_EVOLVE = 500;           // XP per evolution
const XP_NEW_DEX_EVOLVE = 1000;  // extra XP when the evolution registers a new Pokédex entry
const LUCKY_EGG_MIN = 30;        // Lucky Egg duration (minutes), doubles XP
const CANDY_PER_TRANSFER = 1;    // candy for transferring a Pokémon
const CANDY_PER_EVOLVE = 1;      // candy refunded by each evolution

function Req({ children, tone }: { children: ReactNode; tone?: 'accent' | 'warn' | 'good' | 'purple' }) {
  return <span className={`badge ${tone ?? ''}`}>{children}</span>;
}

function requirementBadges(e: Evolution): ReactNode[] {
  const out: ReactNode[] = [];
  out.push(<Req key="c" tone="accent">🍬 {fmt(e.candy)}{e.candyPurified && e.candyPurified !== e.candy ? ` (${fmt(e.candyPurified)} purified)` : ''}</Req>);
  if (e.item) out.push(<Req key="i" tone="purple">💎 {e.item}{e.itemCost && e.itemCost > 1 ? ` ×${fmt(e.itemCost)}` : ''}</Req>);
  if (e.lure) out.push(<Req key="l" tone="warn">🧲 {e.lure}</Req>);
  if (e.buddyKm) out.push(<Req key="b">🚶 {e.buddyKm} km as buddy</Req>);
  else if (e.mustBeBuddy) out.push(<Req key="mb">🤝 Must be buddy</Req>);
  if (e.time) out.push(<Req key="t">{e.time === 'Night' ? '🌙' : e.time === 'Day' ? '☀️' : e.time === 'Dusk' ? '🌆' : '🌕'} {e.time}</Req>);
  if (e.gender) out.push(<Req key="g">{e.gender === 'Female' ? '♀' : '♂'} {e.gender} only</Req>);
  if (e.upsideDown) out.push(<Req key="u">🙃 Hold phone upside down</Req>);
  if (e.quest && !(e.buddyKm && /^Walk/.test(e.quest))) out.push(<Req key="q">📋 {e.quest}</Req>);
  if (e.move) out.push(<Req key="m">Knows {e.move}</Req>);
  if (e.tradeFree) out.push(<Req key="tf" tone="good">🔁 Free if traded</Req>);
  return out;
}

export default function EvolutionPlanner() {
  const { byId, family } = useData();
  const [picked, setP] = usePokemonParam('evolve');
  const p = picked?.megaOf ? byId[picked.megaOf] ?? picked : picked;

  const members = useMemo(() => (p ? family(p.family) : []), [p, family]);
  const roots = useMemo(() => {
    if (!p) return [];
    const ids = new Set(members.map((m) => m.id));
    const r = members.filter((m) => !m.parentId || !ids.has(m.parentId));
    return r.length ? r : [p];
  }, [members, p]);

  // root → leaf paths with totals
  const paths = useMemo(() => {
    const out: { chain: Pokemon[]; evos: Evolution[] }[] = [];
    const walk = (m: Pokemon, chain: Pokemon[], evos: Evolution[], seen: Set<string>) => {
      const next = (m.evolutions || []).filter((e) => byId[e.to] && !seen.has(e.to));
      if (!next.length) { if (evos.length) out.push({ chain, evos }); return; }
      for (const e of next) walk(byId[e.to], [...chain, byId[e.to]], [...evos, e], new Set([...seen, e.to]));
    };
    roots.forEach((r) => walk(r, [r], [], new Set([r.id])));
    return out;
  }, [roots, byId]);

  return (
    <div className="stack">
      <PageHeader title="Evolution Planner" subtitle="Every branch of an evolution family with its requirements, plus candy and Lucky Egg mass-evolution planners." />
      <Card>
        <Field label="Pokémon (any family member)"><PokemonPicker value={picked} onChange={setP} autoFocus={!picked} /></Field>
      </Card>
      {!p ? <Card><Empty icon="🧬">Pick a Pokémon to see its evolution family.</Empty></Card> : (
        <>
          <div className="grid grid-2" style={{ alignItems: 'start' }}>
            <Card title="Evolution chain">
              {roots.every((r) => !(r.evolutions || []).length) && members.length <= 1 ? (
                <Empty icon="🌱">{displayName(p)} doesn't evolve.</Empty>
              ) : (
                <ul className="evo-tree">
                  {roots.map((r) => <TreeNode key={r.id} m={r} current={p.id} seen={new Set([r.id])} />)}
                </ul>
              )}
            </Card>
            <Card title="Family totals" flush footer={<span className="tool-note">Candy from the first stage to each final form. Purified costs in brackets where cheaper.</span>}>
              {!paths.length ? <Empty icon="🌱">No evolutions.</Empty> : (
                <div className="table-wrap">
                  <table className="table compact">
                    <thead><tr><th>Path</th><th className="num">Candy</th><th>Also needs</th></tr></thead>
                    <tbody>
                      {paths.map(({ chain, evos }) => {
                        const candy = evos.reduce((a, e) => a + e.candy, 0);
                        const pur = evos.reduce((a, e) => a + (e.candyPurified ?? e.candy), 0);
                        const extras = evos.flatMap((e) => [e.item && `${e.item}${e.itemCost && e.itemCost > 1 ? ` ×${e.itemCost}` : ''}`, e.lure, e.buddyKm && `${e.buddyKm} km buddy`, e.time, e.gender && `${e.gender}`, e.quest && !e.buddyKm ? e.quest : null, e.upsideDown && 'upside down'].filter(Boolean) as string[]);
                        const last = chain[chain.length - 1];
                        return (
                          <tr key={chain.map((c) => c.id).join('>')}>
                            <td><div className="row nowrap" style={{ gap: 4 }}>{chain.length > 2 && <span className="small muted">{chain.slice(0, -1).map((c) => displayName(c)).join(' → ')} →</span>}<Mon p={last} size={26} /></div></td>
                            <td className="num bold">{fmt(candy)}{pur !== candy && <span className="faint small"> ({fmt(pur)})</span>}</td>
                            <td className="small">{extras.length ? extras.join(' · ') : <span className="muted">—</span>}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>
          <CandyPlanner p={p} roots={roots} />
        </>
      )}
      <LuckyEggPlanner />
    </div>
  );
}

function TreeNode({ m, current, seen, via }: { m: Pokemon; current: string; seen: Set<string>; via?: Evolution }) {
  const { byId } = useData();
  const next = (m.evolutions || []).filter((e) => byId[e.to] && !seen.has(e.to));
  return (
    <li>
      <div className={`evo-node ${m.id === current ? 'current' : ''}`}>
        {via && <span className="evo-arrow">↳</span>}
        <Mon p={m} size={34} showTypes />
        {via && <span className="req">{requirementBadges(via)}</span>}
        {m.megas?.length ? <span className="badge purple" title="Can Mega Evolve">💠 Mega</span> : null}
      </div>
      {next.length > 0 && (
        <ul>{next.map((e) => <TreeNode key={e.to} m={byId[e.to]} current={current} via={e} seen={new Set([...seen, e.to])} />)}</ul>
      )}
    </li>
  );
}

// ---------------------------------------------------------------- candy planner
interface CandyForm { candy: number | ''; count: number | ''; cost: number | ''; catches: number | ''; perCatch: number | ''; pinap: boolean; transferBase: boolean; transferEvolved: boolean }
const CANDY_DEFAULT: CandyForm = { candy: '', count: '', cost: '', catches: '', perCatch: 3, pinap: false, transferBase: true, transferEvolved: true };

/** Greedy simulation: evolve whenever affordable, otherwise transfer a spare base Pokémon for +1 candy. */
function planEvolutions(candy0: number, count0: number, cost: number, transferBase: boolean, transferEvolved: boolean) {
  let candy = candy0, base = count0, evolved = 0, transferred = 0;
  if (cost <= 0) return { evolved: 0, transferred: 0, candy, base };
  for (let guard = 0; guard < 100000; guard++) {
    if (base > 0 && candy >= cost) {
      candy -= cost; candy += CANDY_PER_EVOLVE; base--; evolved++;
      if (transferEvolved) { candy += CANDY_PER_TRANSFER; transferred++; }
      continue;
    }
    if (transferBase && base >= 2) { base--; candy += CANDY_PER_TRANSFER; transferred++; continue; }
    break;
  }
  return { evolved, transferred, candy, base };
}

function CandyPlanner({ p, roots }: { p: Pokemon; roots: Pokemon[] }) {
  const { byId } = useData();
  const [stored, setForm] = useStored<CandyForm>('tools.evolve.candy', CANDY_DEFAULT);
  const f = { ...CANDY_DEFAULT, ...stored };
  const patch = (x: Partial<CandyForm>) => setForm((prev) => ({ ...CANDY_DEFAULT, ...prev, ...x }));

  // evolution choices: the picked Pokémon's evolutions, else the family's first stage
  const source = (p.evolutions || []).length ? p : roots.find((r) => (r.evolutions || []).length) ?? p;
  const evoOpts = (source.evolutions || []).filter((e) => byId[e.to]).map((e) => ({ id: e.to, label: `${displayName(source)} → ${displayName(byId[e.to])} (${e.candy} candy)`, candy: e.candy }));
  const [evoTo, setEvoTo] = useStored<string>('tools.evolve.target', '');
  const evo = evoOpts.find((o) => o.id === evoTo) ?? evoOpts[0];
  const cost = num(f.cost) || evo?.candy || 0;
  const pinapMult = f.pinap ? 2 : 1; // Pinap Berry doubles candy from a catch
  const catchCandy = num(f.catches) * num(f.perCatch, 3) * pinapMult;
  const startCandy = num(f.candy) + catchCandy;
  const startCount = num(f.count) + num(f.catches);
  const res = planEvolutions(startCandy, startCount, cost, f.transferBase, f.transferEvolved);
  const short = res.base > 0 && cost > 0 ? Math.max(0, cost - res.candy) : 0;

  return (
    <Card title="Candy planner" footer={<span className="tool-note">Assumes +{CANDY_PER_TRANSFER} candy per transfer and +{CANDY_PER_EVOLVE} candy back per evolution (community-known). Catch candy is usually 3 for a first-stage Pokémon (5 / 10 for later stages); a Pinap Berry doubles it.</span>}>
      <div className="split" style={{ gridTemplateColumns: 'minmax(0, 1.1fr) minmax(0, 1fr)' }}>
        <div className="col" style={{ gap: 12 }}>
          {evoOpts.length > 0 ? (
            <Field label="Evolution"><Select value={evo?.id ?? ''} onChange={setEvoTo} options={evoOpts.map((o) => ({ id: o.id, label: o.label }))} /></Field>
          ) : <div className="muted small">{displayName(p)} has no further evolutions — enter a custom candy cost.</div>}
          <div className="fields">
            <Field label="Candy on hand"><NumberInput value={f.candy} onChange={(v) => patch({ candy: v })} min={0} placeholder="0" /></Field>
            <Field label={`${displayName(source)} owned`}><NumberInput value={f.count} onChange={(v) => patch({ count: v })} min={0} placeholder="0" /></Field>
            <Field label="Custom cost" hint="Overrides the evolution"><NumberInput value={f.cost} onChange={(v) => patch({ cost: v })} min={1} placeholder={String(evo?.candy ?? '')} /></Field>
          </div>
          <div className="fields">
            <Field label="Catches planned"><NumberInput value={f.catches} onChange={(v) => patch({ catches: v })} min={0} placeholder="0" /></Field>
            <Field label="Candy per catch"><NumberInput value={f.perCatch} onChange={(v) => patch({ perCatch: v })} min={1} /></Field>
          </div>
          <div className="col" style={{ gap: 8 }}>
            <Switch checked={f.pinap} onChange={(v) => patch({ pinap: v })} label="Use Pinap Berries on planned catches (×2 candy)" />
            <Switch checked={f.transferBase} onChange={(v) => patch({ transferBase: v })} label="Transfer spare un-evolved Pokémon for candy" />
            <Switch checked={f.transferEvolved} onChange={(v) => patch({ transferEvolved: v })} label="Transfer each evolved Pokémon too" />
          </div>
        </div>
        <div className="col" style={{ gap: 12 }}>
          <div className="tool-tiles">
            <StatTile label="Evolutions" value={fmt(res.evolved)} sub={`at ${cost || '—'} candy each`} />
            <StatTile label="Transfers" value={fmt(res.transferred)} />
            <StatTile label="Candy left" value={fmt(res.candy)} />
            <StatTile label="Left un-evolved" value={fmt(res.base)} sub={short ? `${plural(short, 'candy', 'candy')} short of one more` : undefined} />
          </div>
          {catchCandy > 0 && <p className="tool-note">Includes {fmt(catchCandy)} candy from {plural(num(f.catches), 'planned catch', 'planned catches')}.</p>}
          {res.evolved > 0 && (
            <div className="callout small">
              Mass-evolving {plural(res.evolved, 'Pokémon')} = <b>{fmt(res.evolved * XP_EVOLVE * 2)} XP</b> with a Lucky Egg ({fmt(res.evolved * XP_EVOLVE)} without).
            </div>
          )}
          {evo && <Link className="small" to={`/tools/cp?id=${evo.id}`}>CP of {displayName(byId[evo.id])} →</Link>}
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- Lucky Egg planner
interface EggForm { evolutions: number | ''; newDex: number | ''; lucky: boolean; secs: number }
const EGG_DEFAULT: EggForm = { evolutions: 60, newDex: 0, lucky: true, secs: 25 };

function LuckyEggPlanner() {
  const [stored, setForm] = useStored<EggForm>('tools.evolve.egg', EGG_DEFAULT);
  const f = { ...EGG_DEFAULT, ...stored };
  const patch = (x: Partial<EggForm>) => setForm((prev) => ({ ...EGG_DEFAULT, ...prev, ...x }));
  const evos = num(f.evolutions);
  const nd = clamp(num(f.newDex), 0, evos);
  const base = evos * XP_EVOLVE + nd * XP_NEW_DEX_EVOLVE;
  const total = f.lucky ? base * 2 : base;
  const perEgg = Math.floor((LUCKY_EGG_MIN * 60) / f.secs);
  const eggs = evos > 0 ? Math.ceil(evos / perEgg) : 0;
  const minutes = (evos * f.secs) / 60;

  return (
    <Card title="Lucky Egg mass-evolve planner" footer={<span className="tool-note">Known values: {XP_EVOLVE} XP per evolution, +{fmt(XP_NEW_DEX_EVOLVE)} XP for a new Pokédex entry, a Lucky Egg doubles all XP for {LUCKY_EGG_MIN} minutes. Time per evolution (animation + tapping) is an estimate — typically 20–30 s.</span>}>
      <div className="split" style={{ gridTemplateColumns: 'minmax(0, 1.1fr) minmax(0, 1fr)' }}>
        <div className="col" style={{ gap: 12 }}>
          <div className="fields">
            <Field label="Evolutions"><NumberInput value={f.evolutions} onChange={(v) => patch({ evolutions: v })} min={0} /></Field>
            <Field label="Of which new Pokédex entries"><NumberInput value={f.newDex} onChange={(v) => patch({ newDex: v })} min={0} /></Field>
          </div>
          <Field label={`Seconds per evolution: ${f.secs}s`}>
            <input type="range" min={15} max={40} value={f.secs} onChange={(e) => patch({ secs: Number(e.target.value) })} aria-label="Seconds per evolution" />
          </Field>
          <Switch checked={f.lucky} onChange={(v) => patch({ lucky: v })} label="Lucky Egg active (×2 XP)" />
        </div>
        <div className="tool-tiles">
          <StatTile label="Total XP" value={fmt(total)} sub={f.lucky ? `${fmt(base)} without egg` : `${fmt(base * 2)} with an egg`} />
          <StatTile label="Time needed" value={`${fmt(minutes, 0)} min`} />
          <StatTile label="Evolutions / egg" value={`~${perEgg}`} sub={`at ${f.secs}s each`} />
          <StatTile label="Lucky Eggs" value={fmt(eggs)} />
        </div>
      </div>
    </Card>
  );
}
