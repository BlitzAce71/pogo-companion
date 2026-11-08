import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Card, Empty, Field, IvInputs, Mon, PageHeader, PokemonPicker, Segmented, StatTile, Switch } from '../../components/ui';
import { displayName, useData } from '../../lib/data';
import { fmt, pct } from '../../lib/format';
import { ENCOUNTERS, LEVELS, appraisalStars, cp, hp, ivPercent, stats, upgradeCost } from '../../lib/pogo';
import { useStored } from '../../lib/storage';
import type { Pokemon } from '../../lib/types';
import { starsLabel, usePokemonParam } from './toolUtils';
import './tools.css';

const LEAGUE_CAPS = [500, 1500, 2500];

export default function CpCalculator() {
  const { byId, family } = useData();
  const [p, setP] = usePokemonParam('cp');
  const [ivs, setIvs] = useStored<[number, number, number]>('tools.cp.ivs', [15, 15, 15]);
  const [level, setLevel] = useStored<number>('tools.cp.level', 40);
  const [half, setHalf] = useStored<boolean>('tools.cp.half', false);
  const [shadow, setShadow] = useStored<boolean>('tools.cp.shadow', false);

  const lvl = LEVELS.includes(level) ? level : 40;

  return (
    <div className="stack">
      <PageHeader title="CP Calculator" subtitle="CP, HP and stats at any level for any IVs — with a full level chart, catch-CP reference and evolution preview." />
      <div className="split">
        <div className="col sticky-side" style={{ gap: 16 }}>
          <Card>
            <div className="col" style={{ gap: 14 }}>
              <Field label="Pokémon"><PokemonPicker value={p} onChange={setP} autoFocus={!p} /></Field>
              <Field label="IVs">
                <IvInputs value={ivs} onChange={setIvs} />
                <div className="row" style={{ marginTop: 6 }}>
                  {([[15, 15, 15], [10, 10, 10], [0, 15, 15], [0, 0, 0]] as [number, number, number][]).map((v) => (
                    <button key={v.join('/')} className={`chip ${v.join() === ivs.join() ? 'on' : ''}`} onClick={() => setIvs(v)}>{v.join('/')}</button>
                  ))}
                </div>
              </Field>
              <Field label={<>Level <b className="num" style={{ color: 'var(--text)' }}>{lvl}</b>{lvl > 50 ? ' (Best Buddy)' : ''}</>}>
                <div className="range-row">
                  <input type="range" min={1} max={51} step={0.5} value={lvl} onChange={(e) => setLevel(Number(e.target.value))} aria-label="Level" />
                </div>
                <div className="row">
                  {[15, 20, 25, 30, 40, 50, 51].map((l) => <button key={l} className={`chip ${l === lvl ? 'on' : ''}`} onClick={() => setLevel(l)}>L{l}</button>)}
                </div>
              </Field>
              <Switch checked={shadow} onChange={setShadow} label="Shadow (show battle Atk ×1.2 / Def ×0.83)" />
            </div>
          </Card>
        </div>

        <div className="stack">
          {!p ? <Card><Empty icon="📈">Pick a Pokémon to see its CP at every level.</Empty></Card> : (
            <>
              <Summary p={p} ivs={ivs} level={lvl} shadow={shadow} />
              <CatchReference p={p} />
              <EvolutionPreview p={p} ivs={ivs} level={lvl} family={family} byId={byId} />
              <Card title="CP by level" actions={<Segmented size="sm" value={half ? 'half' : 'whole'} onChange={(v) => setHalf(v === 'half')} options={[{ id: 'whole', label: 'Whole levels' }, { id: 'half', label: 'All levels' }]} />} flush>
                <LevelTable p={p} ivs={ivs} level={lvl} half={half} onPick={setLevel} />
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Summary({ p, ivs, level, shadow }: { p: Pokemon; ivs: [number, number, number]; level: number; shadow: boolean }) {
  const { settings } = useData();
  const c = cp(p, settings, level, ivs);
  const st = stats(p, settings, level, ivs);
  const am = shadow ? settings.combat?.shadowAtk ?? 1.2 : 1;
  const dm = shadow ? settings.combat?.shadowDef ?? 1 / 1.2 : 1;
  return (
    <Card>
      <div className="stack">
        <div className="tool-hero">
          <Mon p={p} size={56} shadow={shadow} sub={`Level ${level} · ${ivs.join('/')} · ${pct(ivPercent(ivs))} · ${starsLabel(appraisalStars(ivs))}`} />
          <div className="spacer" />
          <div className="big-cp"><small>CP</small>{fmt(c)}</div>
        </div>
        <div className="tool-tiles">
          <StatTile label="HP" value={st.hp} />
          <StatTile label="Attack" value={fmt(st.atk * am, 2)} sub={`(${p.atk}+${ivs[0]}) × CPM`} />
          <StatTile label="Defense" value={fmt(st.def * dm, 2)} sub={`(${p.def}+${ivs[1]}) × CPM`} />
          <StatTile label="Stamina" value={fmt((p.sta + ivs[2]) * settings.cpm[String(level)], 2)} sub="before flooring" />
          <StatTile label="CP multiplier" value={settings.cpm[String(level)].toFixed(4)} />
        </div>
        <div className="row">
          <Link className="btn sm" to={`/tools/iv?id=${p.id}`}>🧮 IV calculator</Link>
          <Link className="btn sm" to={`/pvp/ivs?id=${p.id}&league=great`}>📊 PvP IVs</Link>
          <Link className="btn sm" to={`/tools/powerup?id=${p.id}`}>⬆️ Power-up cost</Link>
          <Link className="btn sm" to={`/dex/${p.id}`}>📖 Pokédex</Link>
        </div>
      </div>
    </Card>
  );
}

function CatchReference({ p }: { p: Pokemon }) {
  const { settings } = useData();
  const rows: { label: string; level: number; floor: number }[] = [
    { label: 'Raid', level: ENCOUNTERS.raid.level, floor: ENCOUNTERS.raid.minIv },
    { label: 'Raid · weather boosted', level: ENCOUNTERS.raid.boosted, floor: ENCOUNTERS.raid.minIv },
    { label: 'Field research', level: ENCOUNTERS.research.level, floor: ENCOUNTERS.research.minIv },
    { label: 'Egg hatch', level: ENCOUNTERS.egg.level, floor: ENCOUNTERS.egg.minIv },
    { label: 'Max Battle', level: ENCOUNTERS.max.level, floor: ENCOUNTERS.max.minIv },
    { label: 'Max Battle · weather boosted', level: ENCOUNTERS.max.boosted, floor: ENCOUNTERS.max.minIv },
    { label: 'Team GO Rocket (shadow)', level: ENCOUNTERS.rocket.level, floor: ENCOUNTERS.rocket.minIv },
    { label: 'Team GO Rocket · weather boosted', level: ENCOUNTERS.rocket.boosted, floor: ENCOUNTERS.rocket.minIv },
  ];
  const wildMax = settings.maxEncounterLevel || 30;
  return (
    <Card title="Catch CP reference" flush footer={<span className="tool-note">“Hundo” = 15/15/15. The floor column uses the encounter's minimum IVs ({ENCOUNTERS.raid.minIv}/{ENCOUNTERS.raid.minIv}/{ENCOUNTERS.raid.minIv} for raids, eggs, research and Max Battles). A CP equal to the hundo value at that level is almost always a 100%.</span>}>
      <div className="table-wrap">
        <table className="table compact">
          <thead><tr><th>Encounter</th><th className="num">Level</th><th className="num">Floor CP</th><th className="num">Hundo CP</th><th className="num">Hundo HP</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <td>{r.label}</td>
                <td className="num">{r.level}</td>
                <td className="num">{fmt(cp(p, settings, r.level, [r.floor, r.floor, r.floor]))} <span className="faint small">({r.floor}/{r.floor}/{r.floor})</span></td>
                <td className="num bold">{fmt(cp(p, settings, r.level, [15, 15, 15]))}</td>
                <td className="num">{hp(p, settings, r.level, 15)}</td>
              </tr>
            ))}
            <tr>
              <td>Wild catch (no weather)</td>
              <td className="num">1–{wildMax}</td>
              <td className="num">{fmt(cp(p, settings, 1, [0, 0, 0]))}</td>
              <td className="num bold">{fmt(cp(p, settings, wildMax, [15, 15, 15]))}</td>
              <td className="num">{hp(p, settings, wildMax, 15)}</td>
            </tr>
            <tr>
              <td>Wild catch · weather boosted</td>
              <td className="num">{1 + settings.weatherBonus.level}–{wildMax + settings.weatherBonus.level}</td>
              <td className="num">{fmt(cp(p, settings, 1 + settings.weatherBonus.level, [settings.weatherBonus.minIv, settings.weatherBonus.minIv, settings.weatherBonus.minIv]))}</td>
              <td className="num bold">{fmt(cp(p, settings, wildMax + settings.weatherBonus.level, [15, 15, 15]))}</td>
              <td className="num">{hp(p, settings, wildMax + settings.weatherBonus.level, 15)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function LevelTable({ p, ivs, level, half, onPick }: { p: Pokemon; ivs: [number, number, number]; level: number; half: boolean; onPick: (l: number) => void }) {
  const { settings } = useData();
  const rows = useMemo(() => LEVELS.filter((l) => half || l % 1 === 0 || l === level).map((L) => {
    const step = L < 51 && L < 50 ? upgradeCost(settings, p, L, L + 0.5) : null;
    return { L, cp: cp(p, settings, L, ivs), hp: hp(p, settings, L, ivs[2]), hundo: cp(p, settings, L, [15, 15, 15]), ten: cp(p, settings, L, [10, 10, 10]), step };
  }), [p, ivs, half, level]);
  return (
    <div className="table-wrap" style={{ maxHeight: 560 }}>
      <table className="table compact">
        <thead><tr><th className="num">Level</th><th className="num">CP ({ivs.join('/')})</th><th className="num">HP</th><th className="num">CP 15/15/15</th><th className="num">CP 10/10/10</th><th className="num hide-mobile">Next power-up</th></tr></thead>
        <tbody>
          {rows.map((r) => {
            const crosses = LEAGUE_CAPS.filter((c) => r.cp <= c && cp(p, settings, Math.min(51, r.L + (half ? 0.5 : 1)), ivs) > c);
            return (
              <tr key={r.L} className={`clickable ${r.L === level ? 'sel' : ''}`} onClick={() => onPick(r.L)}>
                <td className="num">{r.L}{r.L > 50 && <span className="faint small"> BB</span>}</td>
                <td className="num bold">{fmt(r.cp)} {crosses.map((c) => <span key={c} className="badge accent" title={`Highest level at or under ${c} CP`}>≤{fmt(c)}</span>)}</td>
                <td className="num">{r.hp}</td>
                <td className="num">{fmt(r.hundo)}</td>
                <td className="num">{fmt(r.ten)}</td>
                <td className="num small muted hide-mobile">{r.step ? `${fmt(r.step.dust)} · ${r.step.candy ? r.step.candy + ' candy' : r.step.xl + ' XL'}` : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function EvolutionPreview({ p, ivs, level, family, byId }: { p: Pokemon; ivs: [number, number, number]; level: number; family: (f: string) => Pokemon[]; byId: Record<string, Pokemon> }) {
  const { settings } = useData();
  const members = family(p.family);
  const base = p.megaOf ? byId[p.megaOf] : null;
  const list: Pokemon[] = [];
  for (const m of members.length ? members : [base ?? p]) {
    list.push(m);
    for (const mid of m.megas || []) if (byId[mid]) list.push(byId[mid]);
  }
  if (list.length <= 1) return null;
  return (
    <Card title="Evolution & Mega preview" flush footer={<span className="tool-note">Same IVs and level. Evolving keeps IVs and level; Mega Evolution is temporary.</span>}>
      <div className="table-wrap">
        <table className="table compact">
          <thead><tr><th>Pokémon</th><th className="num">CP</th><th className="num">HP</th><th className="num">Max CP (L50)</th></tr></thead>
          <tbody>
            {list.map((m) => (
              <tr key={m.id} className={m.id === p.id ? 'sel' : ''}>
                <td><Mon p={m} size={28} showTypes /></td>
                <td className="num bold">{fmt(cp(m, settings, level, ivs))}</td>
                <td className="num">{hp(m, settings, level, ivs[2])}</td>
                <td className="num muted">{fmt(cp(m, settings, 50, [15, 15, 15]))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card-body" style={{ paddingTop: 8 }}>
        <span className="tool-note">Viewing {displayName(p)}. <Link to={`/tools/evolve?id=${p.id}`}>Evolution requirements →</Link></span>
      </div>
    </Card>
  );
}
