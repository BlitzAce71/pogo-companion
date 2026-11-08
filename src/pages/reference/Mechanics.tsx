import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Card, Field, IvInputs, NumberInput, PageHeader, PokemonPicker, Segmented, Select, StatTile, Switch, TypeBadge } from '../../components/ui';
import { displayName, useData } from '../../lib/data';
import { fmt } from '../../lib/format';
import { appraisalStars, cp, cpmAt, effectiveness, ENCOUNTERS, ivPercent, LEVELS, TRADE_DUST, TYPES, upgradeCost } from '../../lib/pogo';
import type { PokeType, Pokemon } from '../../lib/types';
import './mechanics.css';

// ---------------------------------------------------------------- helpers
/** Trim a number to at most `d` decimals without trailing zeros */
const n = (v: number, d = 4) => String(+v.toFixed(d));
const Approx = ({ children = 'Community-researched' }: { children?: ReactNode }) => <span className="approx" title="Not in the game data — widely reported by the community; treat as approximate">{children}</span>;
const FromData = () => <span className="data-src" title="Value read from the game master data">Game data</span>;

const SECTIONS = [
  { id: 'stats', label: 'CP & stat formulas' },
  { id: 'cpm', label: 'CP Multiplier table' },
  { id: 'damage', label: 'Damage formula' },
  { id: 'multipliers', label: 'Damage multipliers' },
  { id: 'types', label: 'Type effectiveness' },
  { id: 'pvp', label: 'Trainer Battle mechanics' },
  { id: 'catch', label: 'Catch mechanics' },
  { id: 'shiny', label: 'Shiny odds' },
  { id: 'ivfloors', label: 'IV floors by source' },
  { id: 'appraisal', label: 'Appraisal' },
  { id: 'powerup', label: 'Stardust, Candy & XL' },
] as const;

const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

function useActiveSection(ids: readonly string[]) {
  const [active, setActive] = useState<string>(ids[0]);
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const visible = new Map<string, boolean>();
    const obs = new IntersectionObserver((entries) => {
      for (const e of entries) visible.set(e.target.id, e.isIntersecting);
      const first = ids.find((id) => visible.get(id));
      if (first) setActive(first);
    }, { rootMargin: '-70px 0px -55% 0px' });
    ids.forEach((id) => { const el = document.getElementById(id); if (el) obs.observe(el); });
    return () => obs.disconnect();
  }, [ids]);
  return active;
}

// ---------------------------------------------------------------- page
export default function Mechanics() {
  const ids = useMemo(() => SECTIONS.map((s) => s.id), []);
  const active = useActiveSection(ids);
  return (
    <>
      <PageHeader title="Game Mechanics" subtitle="How CP, stats, damage, catching, IVs and power-ups work under the hood. Numbers tagged “Game data” come straight from the game master; anything tagged “Community-researched” is widely reported but approximate." />
      <div className="mech-layout">
        <nav className="card mech-toc" aria-label="Contents">
          <div className="card-head"><h2>Contents</h2></div>
          <ol>
            {SECTIONS.map((s) => <li key={s.id}><button type="button" className={active === s.id ? 'on' : ''} onClick={() => scrollTo(s.id)}>{s.label}</button></li>)}
          </ol>
        </nav>
        <div className="mech-sections">
          <StatsSection />
          <CpmSection />
          <DamageSection />
          <MultipliersSection />
          <TypesSection />
          <PvpSection />
          <CatchSection />
          <ShinySection />
          <IvFloorSection />
          <AppraisalSection />
          <PowerUpSection />
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- 1. stats & CP
function StatsSection() {
  const { byId, pokemon, settings } = useData();
  const [p, setP] = useState<Pokemon | null>(() => byId.DRAGONITE ?? byId.MACHAMP ?? pokemon.find((x) => x.released) ?? null);
  const [level, setLevel] = useState(40);
  const [ivs, setIvs] = useState<[number, number, number]>([15, 15, 15]);
  const [shadow, setShadow] = useState(false);
  const { combat } = settings;
  const levelOpts = useMemo(() => LEVELS.map((l) => ({ id: l, label: `Level ${l}` })), []);

  const calc = useMemo(() => {
    if (!p) return null;
    const m = cpmAt(settings, level);
    const a = p.atk + ivs[0], d = p.def + ivs[1], s = p.sta + ivs[2];
    const raw = (a * Math.sqrt(d) * Math.sqrt(s) * m * m) / 10;
    const cpVal = cp(p, settings, level, ivs);
    const atk = a * m, def = d * m, hpVal = Math.max(10, Math.floor(s * m));
    return { m, a, d, s, raw, cpVal, atk, def, hpVal, matches: Math.max(10, Math.floor(raw)) === cpVal };
  }, [p, level, ivs, settings]);

  return (
    <Card id="stats" title="CP & stat formulas">
      <p>Every Pokémon has three <strong>base stats</strong> (Attack, Defense, Stamina), three <strong>IVs</strong> (0–15 each) and a <strong>level</strong>. The level maps to a <strong>CP Multiplier (CPM)</strong> that scales everything.</p>
      <pre className="formula">{`Attack  = (Base Atk + IV Atk) × CPM
Defense = (Base Def + IV Def) × CPM
HP      = max(10, ⌊(Base Sta + IV Sta) × CPM⌋)
CP      = max(10, ⌊(Base Atk + IV Atk) × √(Base Def + IV Def) × √(Base Sta + IV Sta) × CPM² / 10⌋)`}</pre>
      <p className="small">CP is a summary number only — battles use the Attack, Defense and HP values. Shadow Pokémon show the same CP as a regular one, but battle with Attack ×{n(combat.shadowAtk)} and Defense ×{n(combat.shadowDef)} <FromData />.</p>

      <h3>Live example</h3>
      <div className="mech-example">
        <div className="col">
          <Field label="Pokémon"><PokemonPicker value={p} onChange={setP} /></Field>
          <Field label="Level"><Select value={level} onChange={setLevel} options={levelOpts} /></Field>
          <Field label={`IVs (${ivPercent(ivs)}%)`}><IvInputs value={ivs} onChange={setIvs} /></Field>
          <Switch checked={shadow} onChange={setShadow} label="Shadow (battle stats)" />
        </div>
        {p && calc ? (
          <div>
            <div className="mech-tiles">
              <StatTile label="CP" value={fmt(calc.cpVal)} sub={calc.matches ? 'matches cp()' : 'mismatch!'} />
              <StatTile label="Attack" value={n(calc.atk * (shadow ? combat.shadowAtk : 1), 2)} />
              <StatTile label="Defense" value={n(calc.def * (shadow ? combat.shadowDef : 1), 2)} />
              <StatTile label="HP" value={calc.hpVal} />
              <StatTile label="CPM" value={n(calc.m, 6)} sub={`level ${level}`} />
            </div>
            <pre className="formula">{`${displayName(p)} — base ${p.atk} / ${p.def} / ${p.sta}, IVs ${ivs.join(' / ')}

Attack  = (${p.atk} + ${ivs[0]}) × ${n(calc.m, 6)} = ${n(calc.atk, 3)}${shadow ? `  × ${n(combat.shadowAtk)} (shadow) = ${n(calc.atk * combat.shadowAtk, 3)}` : ''}
Defense = (${p.def} + ${ivs[1]}) × ${n(calc.m, 6)} = ${n(calc.def, 3)}${shadow ? `  × ${n(combat.shadowDef)} (shadow) = ${n(calc.def * combat.shadowDef, 3)}` : ''}
HP      = ⌊(${p.sta} + ${ivs[2]}) × ${n(calc.m, 6)}⌋ = ⌊${n(calc.s * calc.m, 3)}⌋ = ${calc.hpVal}

CP = ⌊${calc.a} × √${calc.d} × √${calc.s} × ${n(calc.m, 6)}² / 10⌋
   = ⌊${n(calc.a, 0)} × ${n(Math.sqrt(calc.d), 4)} × ${n(Math.sqrt(calc.s), 4)} × ${n(calc.m * calc.m, 6)} / 10⌋
   = ⌊${n(calc.raw, 3)}⌋ = `}<span className="hl">{calc.cpVal}</span>{`

Stat product (PvP) = Atk × Def × HP = ${fmt(Math.round(calc.atk * calc.def * calc.hpVal))}`}</pre>
            <div className="mech-note">Try the <Link to={`/tools/cp?id=${p.id}`}>CP Calculator</Link> or <Link to={`/tools/iv?id=${p.id}`}>IV Calculator</Link> for this Pokémon.</div>
          </div>
        ) : <p className="muted">Pick a Pokémon to see the formulas with real numbers.</p>}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- 2. CPM table
function CpmSection() {
  const { settings } = useData();
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const maxL = settings.maxPokemonLevel;
  const rows = useMemo(() => {
    const levels = Object.keys(settings.cpm).map(Number).filter((l) => !Number.isNaN(l)).sort((a, b) => a - b);
    return levels.map((l) => {
      const c = settings.cpm[String(l)];
      const cost = l < maxL ? upgradeCost(settings, null, l, l + 0.5) : null;
      return { l, c, cost };
    });
  }, [settings, maxL]);
  const shown = all ? rows : rows.filter((r) => r.l <= maxL + 1);
  const ratio = (a: number, b: number) => {
    const x = settings.cpm[String(a)], y = settings.cpm[String(b)];
    return x && y ? ((x * x) / (y * y) - 1) * 100 : null;
  };
  const r4050 = ratio(maxL, 40);
  const r40_51 = ratio(maxL + 1, maxL);
  return (
    <Card id="cpm" title="CP Multiplier (CPM) table" actions={<button className="btn sm" onClick={() => setOpen((o) => !o)}>{open ? 'Hide table' : 'Show table'}</button>}>
      <p>CPM rises quickly at low levels and slowly at high levels, so the last power-ups cost the most for the smallest gains. Because CP scales with CPM², a level {maxL} Pokémon has{' '}
        {r4050 !== null && <strong>{n(r4050, 1)}% more CP</strong>} than at level 40{r40_51 !== null && <>, and a Best Buddy boost to level {maxL + 1} adds another <strong>{n(r40_51, 2)}%</strong></>}.
        Power-ups go up to level {maxL} <FromData />; level {maxL + 1} is reachable only with the Best Buddy CP boost.</p>
      {open && (
        <>
          <div className="row" style={{ marginBottom: 10 }}>
            <Switch checked={all} onChange={setAll} label={`Show all ${rows.length} levels in the game data`} />
            <span className="small faint">Levels above {maxL + 1} exist in the game files but can’t currently be reached by Pokémon.</span>
          </div>
          <div className="cpm-scroll">
            <table className="table compact">
              <thead><tr><th className="num">Level</th><th className="num">CPM</th><th className="num">CPM²</th><th className="num">Next ½ level: Stardust</th><th className="num">Candy</th><th className="num">Candy XL</th></tr></thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.l} className={r.l > maxL + 1 ? 'dim' : r.l === 40 || r.l === maxL || r.l === maxL + 1 ? 'mark' : ''}>
                    <td className="num bold">{r.l}</td>
                    <td className="num mono">{r.c.toFixed(7).replace(/0+$/, '').replace(/\.$/, '')}</td>
                    <td className="num mono">{(r.c * r.c).toFixed(5)}</td>
                    <td className="num">{r.cost ? fmt(r.cost.dust) : '—'}</td>
                    <td className="num">{r.cost && r.cost.candy ? r.cost.candy : '—'}</td>
                    <td className="num">{r.cost && r.cost.xl ? r.cost.xl : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mech-note">Costs shown are the standard curve for a regular Pokémon; a few species (e.g. those with special overrides in the game data) cost more. See the <Link to="/tools/powerup">Power-Up Cost</Link> tool.</div>
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- 3. damage
const EFF_OPTS = [
  { id: '2.56', label: 'Double super effective ×2.56' },
  { id: '1.6', label: 'Super effective ×1.6' },
  { id: '1', label: 'Neutral ×1' },
  { id: '0.625', label: 'Not very effective ×0.625' },
  { id: '0.390625', label: 'Double resist / immune ×0.39' },
  { id: '0.244140625', label: 'Triple resist ×0.244' },
];

function DamageSection() {
  const { settings } = useData();
  const { combat, weatherBonus, friendship, megaLevels } = settings;
  const [power, setPower] = useState<number | ''>(100);
  const [atk, setAtk] = useState<number | ''>(250);
  const [def, setDef] = useState<number | ''>(180);
  const [eff, setEff] = useState('1.6');
  const [stab, setStab] = useState(true);
  const [weather, setWeather] = useState(false);
  const [shAtk, setShAtk] = useState(false);
  const [shDef, setShDef] = useState(false);
  const [friend, setFriend] = useState(0);
  const [mega, setMega] = useState<'none' | 'same' | 'other'>('none');
  const mega0 = megaLevels[0];
  const friendOpts = friendship.map((f, i) => ({ id: i, label: `${FRIEND_NAMES[f.level] ?? `Level ${f.level}`} ×${n(f.attack)}` }));

  const P = Number(power) || 0, A = Number(atk) || 0, D = Number(def) || 1;
  const effA = A * (shAtk ? combat.shadowAtk : 1);
  const effD = D * (shDef ? combat.shadowDef : 1);
  const typeM = Number(eff) * (stab ? combat.stab : 1);
  const pveM = typeM * (weather ? weatherBonus.attack : 1) * (friendship[friend]?.attack ?? 1) * (mega === 'same' ? mega0?.sameTypeAttackBoost ?? 1 : mega === 'other' ? mega0?.differentTypeAttackBoost ?? 1 : 1);
  const pvpM = typeM * combat.pvpBonus;
  const pve = Math.floor(0.5 * P * (effA / effD) * pveM) + 1;
  const pvp = Math.floor(0.5 * P * (effA / effD) * pvpM) + 1;

  return (
    <Card id="damage" title="Damage formula">
      <pre className="formula">{`Damage = ⌊ ½ × Power × (Attack ÷ Defense) × Multipliers ⌋ + 1`}</pre>
      <ul className="mech-list">
        <li><strong>Attack / Defense</strong> are the attacker’s and defender’s effective stats (including Shadow ×{n(combat.shadowAtk)} / ×{n(combat.shadowDef)} and, in Trainer Battles, stat buffs).</li>
        <li><strong>Raids, Gyms & Max Battles</strong> multipliers: STAB × type effectiveness × weather × friendship × Mega boost. Moves have separate PvE power, energy and duration.</li>
        <li><strong>Trainer Battles</strong> multipliers: STAB × type effectiveness × a flat ×{n(combat.pvpBonus)} PvP bonus <FromData />. Weather, friendship and Mega boosts don’t apply; moves use their PvP power/energy values.</li>
        <li>Because of the “+1”, every hit does at least 1 damage — this is why shielded charged moves still deal 1.</li>
      </ul>
      <h3>Try it</h3>
      <div className="mech-calc">
        <Field label="Move power"><NumberInput value={power} onChange={setPower} min={0} /></Field>
        <Field label="Attacker Attack stat"><NumberInput value={atk} onChange={setAtk} min={1} /></Field>
        <Field label="Defender Defense stat"><NumberInput value={def} onChange={setDef} min={1} /></Field>
        <Field label="Type effectiveness"><Select value={eff} onChange={setEff} options={EFF_OPTS} /></Field>
        <Field label="Friendship (PvE)"><Select value={friend} onChange={setFriend} options={friendOpts} /></Field>
        <Field label="Mega boost (PvE)"><Select value={mega} onChange={setMega} options={[{ id: 'none', label: 'No Mega' }, { id: 'same', label: `Same type ×${n(mega0?.sameTypeAttackBoost ?? 1)}` }, { id: 'other', label: `Other type ×${n(mega0?.differentTypeAttackBoost ?? 1)}` }]} /></Field>
      </div>
      <div className="row" style={{ marginBottom: 12 }}>
        <Switch checked={stab} onChange={setStab} label={`STAB ×${n(combat.stab)}`} />
        <Switch checked={weather} onChange={setWeather} label={`Weather boosted ×${n(weatherBonus.attack)} (PvE)`} />
        <Switch checked={shAtk} onChange={setShAtk} label="Shadow attacker" />
        <Switch checked={shDef} onChange={setShDef} label="Shadow defender" />
      </div>
      <div className="grid grid-2">
        <div className="tile">
          <div className="small muted">Raid / Gym damage</div>
          <div className="mech-result">{fmt(pve)}</div>
          <div className="small faint mono">⌊0.5 × {P} × {n(effA, 2)}/{n(effD, 2)} × {n(pveM, 4)}⌋ + 1</div>
        </div>
        <div className="tile">
          <div className="small muted">Trainer Battle damage</div>
          <div className="mech-result">{fmt(pvp)}</div>
          <div className="small faint mono">⌊0.5 × {P} × {n(effA, 2)}/{n(effD, 2)} × {n(pvpM, 4)}⌋ + 1</div>
        </div>
      </div>
      <div className="mech-note">Use the move’s PvE power for the raid number and its PvP power for the Trainer Battle number — they usually differ.</div>
    </Card>
  );
}

// ---------------------------------------------------------------- 4. multipliers
const FRIEND_NAMES: Record<number, string> = { 0: 'Friend', 1: 'Good Friend', 2: 'Great Friend', 3: 'Ultra Friend', 4: 'Best Friend', 5: 'Level 5 (beyond Best)' };

function MultipliersSection() {
  const { settings } = useData();
  const { combat, weatherBonus, friendship, megaLevels } = settings;
  return (
    <Card id="multipliers" title="Damage multipliers">
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Bonus</th><th className="num">Multiplier</th><th>Applies</th><th>Source</th></tr></thead>
          <tbody>
            <tr><td className="bold">Same-Type Attack Bonus (STAB)</td><td className="num mono">×{n(combat.stab)}</td><td>Move type matches one of the attacker’s types. All modes.</td><td><FromData /></td></tr>
            <tr><td className="bold">Weather boost</td><td className="num mono">×{n(weatherBonus.attack)}</td><td>Move type is boosted by current weather. Raids, Gyms, Max Battles only. <Link to="/ref/weather">Weather table</Link></td><td><FromData /></td></tr>
            <tr><td className="bold">Shadow Attack</td><td className="num mono">×{n(combat.shadowAtk)}</td><td>Shadow Pokémon’s Attack stat, all modes.</td><td><FromData /></td></tr>
            <tr><td className="bold">Shadow Defense</td><td className="num mono">×{n(combat.shadowDef, 4)}</td><td>Shadow Pokémon take more damage (Defense ÷ {n(1 / combat.shadowDef, 2)}).</td><td><FromData /></td></tr>
            <tr><td className="bold">Trainer Battle bonus</td><td className="num mono">×{n(combat.pvpBonus)}</td><td>Every attack in Trainer Battles / GO Battle League.</td><td><FromData /></td></tr>
            <tr><td className="bold">Type effectiveness</td><td className="num mono">×0.244 – ×2.56</td><td>See <button className="btn ghost sm" onClick={() => scrollTo('types')}>Type effectiveness</button></td><td><FromData /></td></tr>
          </tbody>
        </table>
      </div>

      <h3>Friendship attack bonus (raids, Gyms, Max Battles)</h3>
      <p className="small">Applies when a friend of that level is in the same battle. Details on the <Link to="/ref/friendship">Friendship & Buddy</Link> page.</p>
      <div className="table-wrap">
        <table className="table compact">
          <thead><tr><th>Friendship</th><th className="num">Attack bonus</th></tr></thead>
          <tbody>{friendship.map((f) => <tr key={f.level}><td>{FRIEND_NAMES[f.level] ?? `Level ${f.level}`}</td><td className="num mono">×{n(f.attack)}</td></tr>)}</tbody>
        </table>
      </div>

      <h3>Mega & Primal boost</h3>
      <p className="small">While a Mega Evolved Pokémon is active in a raid, every trainer’s attacks are boosted — more for moves matching the Mega’s type. Higher Mega Levels shorten the re-evolve cooldown and add catch bonuses for same-type Pokémon <FromData />.</p>
      <div className="table-wrap">
        <table className="table compact">
          <thead><tr><th>Mega level</th><th className="num">Same-type attack</th><th className="num">Other-type attack</th><th className="num">Extra catch Candy</th><th className="num">Extra catch XP</th><th className="num">Catch XL chance</th><th className="num">Cooldown</th></tr></thead>
          <tbody>
            {megaLevels.map((m) => {
              const x = m as unknown as Record<string, number | undefined>;
              return (
                <tr key={m.level}>
                  <td>Level {m.level}</td>
                  <td className="num mono">×{n(m.sameTypeAttackBoost)}</td>
                  <td className="num mono">×{n(m.differentTypeAttackBoost)}</td>
                  <td className="num">+{m.sameTypeExtraCatchCandy}</td>
                  <td className="num">{x.sameTypeExtraCatchXp ? `+${x.sameTypeExtraCatchXp}` : '—'}</td>
                  <td className="num">{x.sameTypeExtraCatchCandyXlChance ? `${n(x.sameTypeExtraCatchCandyXlChance * 100)}%` : '—'}</td>
                  <td className="num">{n(m.cooldownMs / 86400000, 1)} days</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- 5. types
function TypesSection() {
  const { types } = useData();
  const single = useMemo(() => {
    const s = new Set<number>();
    for (const a of TYPES) for (const d of TYPES) s.add(types[a]?.[d] ?? 1);
    return [...s].sort((a, b) => b - a);
  }, [types]);
  const singleLabel = (v: number) => (v > 1 ? 'Super effective' : v === 1 ? 'Neutral' : v === Math.min(...single) ? 'Immune → double resist in GO' : 'Not very effective');
  const combos = useMemo(() => {
    const map = new Map<string, { mult: number; atk: PokeType; def: PokeType[]; factors: number[]; count: number }>();
    for (const a of TYPES) for (let i = 0; i < TYPES.length; i++) for (let j = i; j < TYPES.length; j++) {
      const def = i === j ? [TYPES[i]] : [TYPES[i], TYPES[j]];
      const m = effectiveness(types, a, def);
      const k = m.toFixed(8);
      const prev = map.get(k);
      if (prev) { prev.count++; continue; }
      map.set(k, { mult: m, atk: a, def, factors: def.map((t) => types[a]?.[t] ?? 1), count: 1 });
    }
    return [...map.values()].sort((x, y) => y.mult - x.mult);
  }, [types]);
  return (
    <Card id="types" title="Type effectiveness">
      <p>Pokémon GO uses gentler multipliers than the main series, and “immunities” become a stronger resistance instead of 0 damage. Values below come from the game’s type chart.</p>
      <div className="table-wrap">
        <table className="table compact">
          <thead><tr><th>Single-type matchup</th><th className="num">Multiplier</th><th>Main-series equivalent</th></tr></thead>
          <tbody>
            {single.map((v) => <tr key={v}><td>{singleLabel(v)}</td><td className="num mono bold">×{n(v, 6)}</td><td className="muted">{v > 1 ? '×2' : v === 1 ? '×1' : v === Math.min(...single) ? '×0 (immune)' : '×0.5'}</td></tr>)}
          </tbody>
        </table>
      </div>
      <h3>Dual types stack multiplicatively</h3>
      <p className="small">Against a dual-type defender, the multipliers for each of its types are multiplied together. Every distinct result in the chart:</p>
      <div className="table-wrap">
        <table className="table compact">
          <thead><tr><th className="num">Total</th><th>Made of</th><th>Example</th><th className="num hide-mobile">Matchups</th></tr></thead>
          <tbody>
            {combos.map((c) => (
              <tr key={c.mult}>
                <td className="num mono bold">×{n(c.mult, 6)}</td>
                <td className="mono small">{c.factors.map((f) => n(f, 6)).join(' × ')}</td>
                <td><span className="row nowrap" style={{ gap: 4 }}><TypeBadge type={c.atk} small /> <span className="faint">→</span> {c.def.map((t) => <TypeBadge key={t} type={t} small />)}</span></td>
                <td className="num hide-mobile faint">{fmt(c.count)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mech-note">Full interactive chart: <Link to="/types">Type Chart</Link>.</div>
    </Card>
  );
}

// ---------------------------------------------------------------- 6. pvp
function PvpSection() {
  const { settings } = useData();
  const { combat } = settings;
  const stages = combat.buffMultipliers.map((m, i) => ({ stage: combat.minStage + i, m }));
  return (
    <Card id="pvp" title="Trainer Battle (PvP) mechanics">
      <ul className="mech-list">
        <li><strong>Turns:</strong> battles run in {n(combat.turnSeconds)}-second turns <FromData />. Fast moves last a whole number of turns and generate energy; charged moves spend it.</li>
        <li><strong>Energy</strong> is capped at {combat.maxEnergy} <FromData />; energy earned above the cap is wasted.</li>
        <li><strong>Shields:</strong> each trainer has 2 Protect Shields per battle <Approx>Community-known</Approx>. A shielded charged move deals 1 damage (the formula’s “+1”), but its self-buffs/debuffs still apply.</li>
        <li><strong>Charge Move Priority (CMP):</strong> if both Pokémon throw a charged move on the same turn, the one with the higher Attack stat goes first; ties are broken randomly <Approx>Community-researched</Approx>. Attack-weighted IVs can win CMP ties.</li>
        <li><strong>Switching</strong> resets that Pokémon’s stat stages; after a manual switch there’s a cooldown before you can switch again.</li>
        <li><strong>No weather, friendship or Mega bonuses</strong> — only STAB, type effectiveness, Shadow and the ×{n(combat.pvpBonus)} PvP bonus.</li>
      </ul>
      <h3>Stat stage multipliers (buffs & debuffs)</h3>
      <p className="small">Some charged moves change Attack or Defense by stages. Stages are capped between {combat.minStage} and +{combat.maxStage} <FromData />, and multiply the stat:</p>
      <div className="table-wrap">
        <table className="table compact">
          <thead><tr>{stages.map((s) => <th key={s.stage} className="num">{s.stage > 0 ? `+${s.stage}` : s.stage}</th>)}</tr></thead>
          <tbody><tr>{stages.map((s) => <td key={s.stage} className={`num mono ${s.stage > 0 ? 'good' : s.stage < 0 ? 'bad' : ''}`}>×{n(s.m, 3)}</td>)}</tr></tbody>
        </table>
      </div>
      <div className="mech-note">Rank IVs by stat product with the <Link to="/pvp/ivs">PvP IV Ranker</Link>, or test matchups in the <Link to="/pvp/sim">Battle Simulator</Link>.</div>
    </Card>
  );
}

// ---------------------------------------------------------------- 7. catch
const BALLS = [
  { id: 'poke', label: 'Poké Ball', m: 1 },
  { id: 'great', label: 'Great Ball', m: 1.5 },
  { id: 'ultra', label: 'Ultra Ball', m: 2 },
  { id: 'premier', label: 'Premier Ball', m: 1 },
];
const BERRIES = [
  { id: 'none', label: 'None', m: 1 },
  { id: 'razz', label: 'Razz Berry', m: 1.5 },
  { id: 'golden', label: 'Golden Razz Berry', m: 2.5 },
  { id: 'silver', label: 'Silver Pinap Berry', m: 1.8 },
  { id: 'pinap', label: 'Pinap / Nanab (no catch bonus)', m: 1 },
];
const THROWS = [
  { id: 'none', label: 'No bonus', min: 1, max: 1 },
  { id: 'nice', label: 'Nice', min: 1, max: 1.3 },
  { id: 'great', label: 'Great', min: 1.3, max: 1.7 },
  { id: 'excellent', label: 'Excellent', min: 1.7, max: 2 },
];
const MEDALS = [
  { id: 'none', label: 'None', m: 1 },
  { id: 'bronze', label: 'Bronze', m: 1.1 },
  { id: 'silver', label: 'Silver', m: 1.2 },
  { id: 'gold', label: 'Gold / Platinum', m: 1.3 },
];
const BCR_PRESETS = [50, 40, 30, 20, 10, 5, 3, 2];

function CatchSection() {
  const { settings } = useData();
  const [bcr, setBcr] = useState<number | ''>(20);
  const [level, setLevel] = useState(20);
  const [ball, setBall] = useState('ultra');
  const [berry, setBerry] = useState('golden');
  const [throwId, setThrowId] = useState('great');
  const [throwM, setThrowM] = useState(1.5);
  const [curve, setCurve] = useState(true);
  const [medal1, setMedal1] = useState('gold');
  const [medal2, setMedal2] = useState('');
  const [shadowMon, setShadowMon] = useState<Pokemon | null>(null);
  const shadowFilter = useMemo(() => (p: Pokemon) => p.released && p.shadowCaptureRate != null, []);
  const levelOpts = useMemo(() => LEVELS.filter((l) => l <= settings.maxPokemonLevel).map((l) => ({ id: l, label: `Level ${l}` })), [settings.maxPokemonLevel]);

  const t = THROWS.find((x) => x.id === throwId)!;
  const tm = Math.min(t.max, Math.max(t.min, throwM));
  const m1 = MEDALS.find((x) => x.id === medal1)?.m ?? 1;
  const m2 = medal2 ? MEDALS.find((x) => x.id === medal2)?.m ?? 1 : null;
  const medalM = m2 === null ? m1 : (m1 + m2) / 2;
  const ballM = BALLS.find((x) => x.id === ball)?.m ?? 1;
  const berryM = BERRIES.find((x) => x.id === berry)?.m ?? 1;
  const curveM = curve ? 1.7 : 1;
  const M = ballM * berryM * tm * curveM * medalM;
  const cpm = cpmAt(settings, level);
  const base = Math.min(1, (Number(bcr) || 0) / 100 / (2 * cpm));
  const prob = 1 - Math.pow(1 - base, M);
  const within = (k: number) => 1 - Math.pow(1 - prob, k);
  const pctS = (v: number) => `${n(v * 100, v < 0.1 ? 2 : 1)}%`;

  return (
    <Card id="catch" title="Catch mechanics">
      <p>Each throw that lands is an independent roll. The chance depends on the species’ <strong>base catch rate (BCR)</strong>, the Pokémon’s level (via CPM) and a combined multiplier from your ball, berry, throw quality, curveball and type medals <Approx />.</p>
      <pre className="formula">{`P(catch) = 1 − (1 − BCR ÷ (2 × CPM)) ^ Multiplier
Multiplier = Ball × Berry × Throw × Curveball × Medal`}</pre>
      <div className="table-wrap">
        <table className="table compact">
          <thead><tr><th>Factor</th><th>Values</th></tr></thead>
          <tbody>
            <tr><td className="bold">Ball</td><td>Poké ×1 · Great ×1.5 · Ultra ×2 · Premier (raid/encounter rewards) ×1 · Master Ball always catches <Approx /></td></tr>
            <tr><td className="bold">Berry</td><td>Razz ×1.5 · Golden Razz ×2.5 · Silver Pinap ×1.8 (and doubles Candy) · Pinap doubles Candy only · Nanab calms movement only <Approx /></td></tr>
            <tr><td className="bold">Throw</td><td>Nice ×1–1.3 · Great ×1.3–1.7 · Excellent ×1.7–2 — smaller circle = higher bonus <Approx /></td></tr>
            <tr><td className="bold">Curveball</td><td>×1.7 <Approx /></td></tr>
            <tr><td className="bold">Type medal</td><td>Bronze ×1.1 · Silver ×1.2 · Gold ×1.3 (Platinum = Gold); dual-type Pokémon use the average of both medals <Approx /></td></tr>
          </tbody>
        </table>
      </div>

      <h3>Catch chance calculator</h3>
      <p className="small">The game data in this app doesn’t include base catch rates for wild encounters, so enter one. Typical community-reported values: ~50% for many first-stage Pokémon, ~20–30% for mid-stages, ~5–10% for final evolutions, ~2% for most legendary raid bosses <Approx>Approximate</Approx>.</p>
      <div className="mech-calc">
        <Field label="Base catch rate (%)" hint="0–100">
          <NumberInput value={bcr} onChange={setBcr} min={0} max={100} step={0.5} />
        </Field>
        <Field label="Pokémon level" hint={`CPM ${n(cpm, 4)} · raid catches are level 20 (25 boosted)`}><Select value={level} onChange={setLevel} options={levelOpts} /></Field>
        <Field label="Ball"><Select value={ball} onChange={setBall} options={BALLS.map((b) => ({ id: b.id, label: `${b.label} ×${b.m}` }))} /></Field>
        <Field label="Berry"><Select value={berry} onChange={setBerry} options={BERRIES.map((b) => ({ id: b.id, label: `${b.label} ×${b.m}` }))} /></Field>
        <Field label="Type medal"><Select value={medal1} onChange={setMedal1} options={MEDALS.map((b) => ({ id: b.id, label: `${b.label} ×${b.m}` }))} /></Field>
        <Field label="2nd type medal" hint="dual types only"><Select value={medal2} onChange={setMedal2} options={[{ id: '', label: 'Single type' }, ...MEDALS.map((b) => ({ id: b.id, label: `${b.label} ×${b.m}` }))]} /></Field>
      </div>
      <div className="chips" style={{ marginBottom: 12 }}>
        <span className="small faint" style={{ alignSelf: 'center' }}>BCR presets:</span>
        {BCR_PRESETS.map((v) => <button key={v} type="button" className={`chip ${bcr === v ? 'on' : ''}`} onClick={() => setBcr(v)}>{v}%</button>)}
      </div>
      <div className="row" style={{ marginBottom: 12, alignItems: 'flex-end' }}>
        <Field label="Throw"><Segmented options={THROWS.map((x) => ({ id: x.id, label: x.label }))} value={throwId} onChange={(id) => { setThrowId(id); const nt = THROWS.find((x) => x.id === id)!; setThrowM((nt.min + nt.max) / 2); }} size="sm" /></Field>
        {t.max > t.min && (
          <Field label={`Throw bonus ×${n(tm, 2)}`} style={{ minWidth: 180, flex: 1, maxWidth: 280 }}>
            <input type="range" min={t.min} max={t.max} step={0.01} value={tm} onChange={(e) => setThrowM(Number(e.target.value))} />
          </Field>
        )}
        <Switch checked={curve} onChange={setCurve} label="Curveball ×1.7" />
      </div>
      <div className="row" style={{ marginBottom: 12 }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <PokemonPicker value={shadowMon} onChange={(p) => { setShadowMon(p); if (p?.shadowCaptureRate != null) setBcr(+(p.shadowCaptureRate * 100).toFixed(2)); }} filter={shadowFilter} placeholder="Optional: use a Shadow Pokémon’s catch rate from game data…" allowClear />
        </div>
        {shadowMon?.shadowCaptureRate != null && <span className="small muted">Shadow (Team GO Rocket) catch rate for {displayName(shadowMon)}: <strong>{n(shadowMon.shadowCaptureRate * 100, 2)}%</strong> <FromData /></span>}
      </div>
      <div className="grid grid-3">
        <div className="tile"><div className="small muted">Per throw</div><div className="mech-result">{pctS(prob)}</div><div className="small faint mono">1 − (1 − {n(base, 4)})^{n(M, 3)}</div></div>
        <div className="tile"><div className="small muted">Within 3 throws</div><div className="mech-result">{pctS(within(3))}</div><div className="small faint">ignores fleeing</div></div>
        <div className="tile"><div className="small muted">Within 10 throws</div><div className="mech-result">{pctS(within(10))}</div><div className="small faint">e.g. raid Premier Balls</div></div>
      </div>
      <div className="mech-note">Multiplier = {n(ballM)} × {n(berryM)} × {n(tm, 2)} × {n(curveM)} × {n(medalM, 3)} = <strong>{n(M, 3)}</strong>. Higher-level Pokémon have a higher CPM and are therefore harder to catch.</div>
    </Card>
  );
}

// ---------------------------------------------------------------- 8. shiny
function ShinySection() {
  const rows = [
    ['Standard wild / most encounters', '≈ 1 in 512', 'The commonly cited base rate.'],
    ['Event-boosted & some “permaboosted” species', '≈ 1 in 64', 'Varies by event; often announced as “increased shiny chance”.'],
    ['Community Day featured Pokémon', '≈ 1 in 25', 'During the event hours.'],
    ['Legendary raid bosses', '≈ 1 in 20', 'Applies to the post-raid encounter.'],
    ['Research Breakthrough / special reward encounters', '≈ 1 in 10 (varies)', 'Often boosted; varies by reward.'],
  ];
  return (
    <Card id="shiny" title="Shiny odds">
      <p className="small">Shiny rates aren’t in the game data. These are community-researched estimates <Approx>Approximate</Approx>. Not every species has a released shiny — the presence of a shiny sprite in the game files doesn’t mean it’s obtainable.</p>
      <div className="table-wrap">
        <table className="table compact">
          <thead><tr><th>Encounter</th><th className="num">Approx. odds</th><th className="hide-mobile">Notes</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r[0]}><td>{r[0]}</td><td className="num nowrap bold">{r[1]}</td><td className="muted small hide-mobile">{r[2]}</td></tr>)}</tbody>
        </table>
      </div>
      <div className="mech-note">At 1/512, you need about {fmt(Math.ceil(Math.log(0.5) / Math.log(1 - 1 / 512)))} checks for a 50% chance and {fmt(Math.ceil(Math.log(0.1) / Math.log(1 - 1 / 512)))} for 90%. At 1/25: {Math.ceil(Math.log(0.5) / Math.log(1 - 1 / 25))} and {Math.ceil(Math.log(0.1) / Math.log(1 - 1 / 25))}.</div>
    </Card>
  );
}

// ---------------------------------------------------------------- 9. IV floors
function IvFloorSection() {
  const { settings } = useData();
  const wb = settings.weatherBonus;
  const maxWild = settings.maxEncounterLevel;
  const E = ENCOUNTERS;
  const rows: { src: ReactNode; iv: ReactNode; level: ReactNode; note?: ReactNode }[] = [
    { src: 'Wild catch', iv: 0, level: `1–${maxWild}`, note: <>Level is capped by your trainer level (up to {maxWild}) <FromData /></> },
    { src: 'Wild, weather boosted', iv: wb.minIv, level: `up to ${maxWild + wb.level}`, note: <>+{wb.level} levels, {n(wb.dust)}× Stardust on catch <FromData /></> },
    { src: E.raid.label, iv: E.raid.minIv, level: `${E.raid.level} (${E.raid.boosted} boosted)`, note: <>IV floor {wb.raidMinIv} <FromData /></> },
    { src: E.max.label, iv: E.max.minIv, level: `${E.max.level} (${E.max.boosted} boosted)` },
    { src: E.egg.label, iv: E.egg.minIv, level: `${settings.maxEggLevel}`, note: <>Hatch level {settings.maxEggLevel} <FromData />; weather doesn’t affect hatches</> },
    { src: E.research.label, iv: E.research.minIv, level: `${settings.maxQuestLevel}`, note: <>Research encounter level {settings.maxQuestLevel} <FromData /></> },
    { src: E.rocket.label, iv: E.rocket.minIv, level: `${E.rocket.level} (${E.rocket.boosted} boosted)`, note: 'Grunt/leader shadow encounters' },
    ...TRADE_DUST.levels.map((lvl, i) => ({ src: `Trade — ${lvl} Friend`, iv: TRADE_DUST.minIv[i], level: 'unchanged', note: 'Trading re-rolls IVs; level is kept' as ReactNode })),
    { src: 'Lucky trade', iv: 12, level: 'unchanged', note: <>Lucky Pokémon also cost {n((1 - settings.upgrade.luckyDustMult) * 100)}% less Stardust to power up <FromData /> · IV floor <Approx>Community-known</Approx></> },
    { src: 'Purified Shadow', iv: '+2 each', level: 'raised to 25', note: <>Each IV +2 (max 15); level raised to 25 if lower <Approx>Community-known</Approx></> },
  ];
  return (
    <Card id="ivfloors" title="IV floors by source">
      <p className="small">The IV floor is the minimum value for each of Attack, Defense and HP. A higher floor makes perfect IVs (“hundos”) more likely: with a floor of 10 the chance is 1/216, with 0 it’s 1/4096.</p>
      <div className="table-wrap">
        <table className="table compact">
          <thead><tr><th>Source</th><th className="num">Min IV</th><th className="num">Level</th><th>Notes</th></tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i}><td className="bold">{r.src}</td><td className="num mono">{r.iv}</td><td className="num nowrap">{r.level}</td><td className="small muted">{r.note}</td></tr>)}</tbody>
        </table>
      </div>
      <div className="mech-note">Probability of a hundo for a floor <em>f</em> is (1/(16−f))³. Floor {wb.minIv}: 1/{fmt(Math.pow(16 - wb.minIv, 3))} · floor 5: 1/{fmt(11 ** 3)} · floor 12: 1/64.</div>
    </Card>
  );
}

// ---------------------------------------------------------------- 10. appraisal
function AppraisalSection() {
  const buckets = useMemo(() => {
    const b: { stars: number; min: number; max: number }[] = [];
    for (let total = 0; total <= 45; total++) {
      const s = appraisalStars([Math.min(15, total), Math.min(15, Math.max(0, total - 15)), Math.max(0, total - 30)]);
      const last = b[b.length - 1];
      if (last && last.stars === s) last.max = total; else b.push({ stars: s, min: total, max: total });
    }
    return b;
  }, []);
  const pctOf = (t: number) => n((t / 45) * 100, 1);
  return (
    <Card id="appraisal" title="Appraisal">
      <p>The team leader appraisal shows a star rating for the IV total (0–45) and three bars — one per stat. Each bar has three 5-point segments; a full bar turns red at 15. Use the <Link to="/tools/iv">IV Calculator</Link> to pin down exact values.</p>
      <div className="table-wrap">
        <table className="table compact">
          <thead><tr><th>Stars</th><th className="num">IV total</th><th className="num">IV %</th></tr></thead>
          <tbody>
            {buckets.map((b) => (
              <tr key={b.stars}>
                <td className="nowrap">{b.stars === 0 ? <span className="faint">0 stars</span> : <span className="warn">{'★'.repeat(Math.min(3, b.stars))}</span>}{b.stars === 4 && <span className="badge bad" style={{ marginLeft: 6 }}>Hundo · red background</span>}</td>
                <td className="num mono">{b.min === b.max ? b.min : `${b.min}–${b.max}`}</td>
                <td className="num mono">{b.min === b.max ? `${pctOf(b.min)}%` : `${pctOf(b.min)}–${pctOf(b.max)}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mech-note">IV% = (Atk + Def + HP IVs) ÷ 45. The game rounds the display, so 44/45 shows as 98%.</div>
    </Card>
  );
}

// ---------------------------------------------------------------- 11. power-up / candy / dust
function PowerUpSection() {
  const { settings } = useData();
  const u = settings.upgrade;
  const maxL = settings.maxPokemonLevel;
  const xlLevel = settings.levelRewards.find((r) => r.unlocks.some((x) => /xl/i.test(x)))?.level;
  const bestBuddy = settings.buddyLevels.find((b) => b.traits.some((t) => /cp ?boost/i.test(t)));
  const starPiece = useData().reference.items.find((i) => i.id === 'ITEM_STAR_PIECE');
  const spans = [
    { label: '1 → 40', from: 1, to: 40 },
    { label: `40 → ${maxL}`, from: 40, to: maxL },
    { label: `1 → ${maxL}`, from: 1, to: maxL },
  ];
  const cost = (from: number, to: number, o?: { shadow?: boolean; purified?: boolean; lucky?: boolean }) => upgradeCost(settings, null, from, to, o);
  return (
    <Card id="powerup" title="Stardust, Candy & Candy XL">
      <h3>Powering up</h3>
      <ul className="mech-list">
        <li>Each power-up adds <strong>half a level</strong>. Levels 1–40 cost Stardust + Candy; levels 40–{maxL} cost Stardust + <strong>Candy XL</strong> <FromData />.</li>
        <li>Max level by power-up is <strong>{maxL}</strong>; a {bestBuddy ? 'Best Buddy' : 'buddy'} gets a CP Boost of +1 level (to {maxL + 1}) while it’s your active buddy{bestBuddy ? <> ({bestBuddy.points} hearts)</> : null} <FromData />.</li>
        <li>Multipliers <FromData />: Shadow ×{n(u.shadowMult)} Stardust / ×{n(u.shadowCandyMult)} Candy · Purified ×{n(u.purifiedMult)} / ×{n(u.purifiedCandyMult)} · Lucky ×{n(u.luckyDustMult)} Stardust.</li>
      </ul>
      <div className="table-wrap">
        <table className="table compact">
          <thead><tr><th>Levels</th><th className="num">Candy</th><th className="num">Candy XL</th><th className="num">Stardust</th><th className="num">Lucky</th><th className="num">Shadow</th><th className="num">Purified</th></tr></thead>
          <tbody>
            {spans.map((s) => {
              const c = cost(s.from, s.to), l = cost(s.from, s.to, { lucky: true }), sh = cost(s.from, s.to, { shadow: true }), pu = cost(s.from, s.to, { purified: true });
              return (
                <tr key={s.label}>
                  <td className="bold nowrap">{s.label}</td>
                  <td className="num">{fmt(c.candy)}</td>
                  <td className="num">{fmt(c.xl)}</td>
                  <td className="num">{fmt(c.dust)}</td>
                  <td className="num">{fmt(l.dust)}</td>
                  <td className="num small">{fmt(sh.dust)}<div className="faint">{fmt(sh.candy)} c · {fmt(sh.xl)} XL</div></td>
                  <td className="num small">{fmt(pu.dust)}<div className="faint">{fmt(pu.candy)} c · {fmt(pu.xl)} XL</div></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mech-note">Standard cost curve; a few species have special overrides in the game data. Plan exact costs with <Link to="/tools/powerup">Power-Up Cost</Link>.</div>

      <h3>Earning Candy & Stardust</h3>
      <ul className="mech-list">
        <li><strong>Catching</strong>: Candy for the species’ family (3 for a first-stage Pokémon, more for evolved stages) and Stardust (100 base) <Approx>Community-known</Approx>. Weather-boosted catches give {n(settings.weatherBonus.dust)}× Stardust <FromData />.</li>
        <li><strong>Pinap / Silver Pinap Berry</strong>: double the catch Candy <Approx>Community-known</Approx>.</li>
        <li><strong>Transferring</strong>: 1 Candy per Pokémon <Approx>Community-known</Approx>.</li>
        <li><strong>Buddy walking</strong>: 1 Candy every 1, 3, 5 or 20 km depending on species — see <Link to="/ref/friendship">Buddy candy distances</Link> <FromData />.</li>
        <li><strong>Mega boost</strong>: catching a Pokémon sharing the active Mega’s type gives extra Candy (and at higher Mega Levels, extra XP and a Candy XL chance) <FromData />.</li>
        {starPiece && <li><strong>{starPiece.name}</strong>: {starPiece.desc} <FromData /></li>}
      </ul>

      <h3>Candy XL</h3>
      <ul className="mech-list">
        <li>Unlocks at trainer level <strong>{xlLevel ?? '31'}</strong>{xlLevel ? <> <FromData /></> : null}. After that, catching, transferring, hatching, trading and walking with your buddy can award Candy XL.</li>
        <li>Chances scale with the Pokémon’s level — transferring higher-level Pokémon is the most reliable source; catches and walking give XL at a lower rate <Approx>Community-researched</Approx>.</li>
        <li>Rare Candy XL can be converted into any species’ Candy XL.</li>
      </ul>
    </Card>
  );
}
