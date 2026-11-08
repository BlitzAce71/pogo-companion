import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, Empty, Field, IvBars, IvInputs, NumberInput, PageHeader, PokemonPicker, Segmented, Select, StatTile, Tabs, useShowMore, useToast } from '../../components/ui';
import { displayName, useData } from '../../lib/data';
import { fmt, pct } from '../../lib/format';
import { ENCOUNTERS, LEAGUES, LEVELS, appraisalStars, cp, dustAtLevel, hp, ivPercent, rankPvpIvs, solveIvs, stats, upgradeCost, type IvMatch } from '../../lib/pogo';
import { useMyPokemon, usePrefs, useStored } from '../../lib/storage';
import type { Pokemon, Settings } from '../../lib/types';
import { BUCKET_LABELS, LUCKY_IV_FLOOR, TRADE_IV_FLOOR, friendName, ivBucket, levelOptions, num, starsLabel, usePokemonParam } from './toolUtils';
import './tools.css';

type Status = 'normal' | 'shadow' | 'purified' | 'lucky';
const STATUS_OPTS: { id: Status; label: string }[] = [
  { id: 'normal', label: 'Normal' }, { id: 'shadow', label: 'Shadow' }, { id: 'purified', label: 'Purified' }, { id: 'lucky', label: 'Lucky' },
];
const flags = (s: Status) => ({ shadow: s === 'shadow', purified: s === 'purified', lucky: s === 'lucky' });

interface Origin { id: string; label: string; min: number; max: number; half: boolean; floor: number; note: string; status?: Status }

/** Encounter origins → level range + IV floor. Values from settings where available, else ENCOUNTERS / community-known. */
function origins(settings: Settings, trainerLevel: number, friend: number): Origin[] {
  const wildMax = Math.min(settings.maxEncounterLevel || 30, trainerLevel);
  const wb = settings.weatherBonus;
  const raidFloor = wb.raidMinIv ?? ENCOUNTERS.raid.minIv;
  const eggL = Math.min(settings.maxEggLevel || ENCOUNTERS.egg.level, trainerLevel);
  const questL = settings.maxQuestLevel || ENCOUNTERS.research.level;
  const tradeFloor = friend === 5 ? LUCKY_IV_FLOOR : TRADE_IV_FLOOR[friend] ?? 1;
  return [
    { id: 'any', label: 'Powered up / unknown', min: 1, max: 51, half: true, floor: 0, note: 'Any level 1–51 including half levels (51 = Best Buddy boost).' },
    { id: 'wild', label: 'Wild catch', min: 1, max: wildMax, half: false, floor: 0, note: `Whole levels 1–${wildMax} (capped at your trainer level, max ${settings.maxEncounterLevel || 30}).` },
    { id: 'wildBoost', label: 'Wild catch · weather boosted', min: 1 + wb.level, max: wildMax + wb.level, half: false, floor: wb.minIv, note: `Whole levels ${1 + wb.level}–${wildMax + wb.level}, IV floor ${wb.minIv}.` },
    { id: 'egg', label: 'Hatched from egg', min: eggL, max: eggL, half: false, floor: 10, note: `Level ${eggL}, IV floor 10.` },
    { id: 'raid', label: 'Raid catch', min: ENCOUNTERS.raid.level, max: ENCOUNTERS.raid.level, half: false, floor: raidFloor, note: `Level ${ENCOUNTERS.raid.level}, IV floor ${raidFloor}.` },
    { id: 'raidBoost', label: 'Raid catch · weather boosted', min: ENCOUNTERS.raid.boosted, max: ENCOUNTERS.raid.boosted, half: false, floor: raidFloor, note: `Level ${ENCOUNTERS.raid.boosted}, IV floor ${raidFloor}.` },
    { id: 'research', label: 'Research reward', min: questL, max: questL, half: false, floor: 10, note: `Level ${questL}, IV floor 10.` },
    { id: 'max', label: 'Max Battle catch', min: ENCOUNTERS.max.level, max: ENCOUNTERS.max.level, half: false, floor: ENCOUNTERS.max.minIv, note: `Level ${ENCOUNTERS.max.level}, IV floor ${ENCOUNTERS.max.minIv}.` },
    { id: 'maxBoost', label: 'Max Battle · weather boosted', min: ENCOUNTERS.max.boosted, max: ENCOUNTERS.max.boosted, half: false, floor: ENCOUNTERS.max.minIv, note: `Level ${ENCOUNTERS.max.boosted}, IV floor ${ENCOUNTERS.max.minIv}.` },
    { id: 'rocket', label: 'Team GO Rocket shadow', min: ENCOUNTERS.rocket.level, max: ENCOUNTERS.rocket.level, half: false, floor: ENCOUNTERS.rocket.minIv, note: `Level ${ENCOUNTERS.rocket.level}.`, status: 'shadow' },
    { id: 'rocketBoost', label: 'Team GO Rocket shadow · boosted', min: ENCOUNTERS.rocket.boosted, max: ENCOUNTERS.rocket.boosted, half: false, floor: ENCOUNTERS.rocket.minIv, note: `Level ${ENCOUNTERS.rocket.boosted}.`, status: 'shadow' },
    // Community-known: purifying raises the level to 25 (if lower) and adds +2 to each IV (max 15).
    { id: 'purifiedRocket', label: 'Purified (unpowered Rocket catch)', min: 25, max: 25, half: false, floor: 2, note: 'Purification raises level to 25 and adds +2 to each IV.', status: 'purified' },
    { id: 'traded', label: 'Received in a trade', min: 1, max: 50, half: true, floor: tradeFloor, note: `Keeps its level; IVs re-rolled with floor ${tradeFloor} (${friend === 5 ? 'Lucky' : friendName(friend) + ' Friend'}).` },
  ];
}

interface IvForm { cp: number | ''; hp: number | ''; dust: number; status: Status; origin: string; friend: number; stars: number; bars: [number, number, number] }
const DEFAULT_FORM: IvForm = { cp: '', hp: '', dust: 0, status: 'normal', origin: 'any', friend: 1, stars: -1, bars: [-1, -1, -1] };

export default function IvCalculator() {
  const [mode, setMode] = useStored<'find' | 'know'>('tools.iv.mode', 'find');
  const [p, setP] = usePokemonParam('iv');
  return (
    <div className="stack">
      <PageHeader title="IV Calculator" subtitle="Work out a Pokémon's hidden IVs and level from its CP, HP, power-up cost and appraisal — then see its PvP ranks." />
      <Card>
        <div className="col">
          <Field label="Pokémon"><PokemonPicker value={p} onChange={setP} autoFocus={!p} /></Field>
          <Tabs tabs={[{ id: 'find', label: '🔍 Find my IVs' }, { id: 'know', label: '✅ I know my IVs' }]} value={mode} onChange={setMode} />
          {!p && <Empty icon="🧮">Pick a Pokémon to start.</Empty>}
        </div>
        {p && mode === 'find' && <FindIvs p={p} />}
        {p && mode === 'know' && <KnownIvs p={p} />}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- find mode
function FindIvs({ p }: { p: Pokemon }) {
  const { settings } = useData();
  const [prefs] = usePrefs();
  const [stored, setForm] = useStored<IvForm>('tools.iv.form', DEFAULT_FORM);
  const f: IvForm = { ...DEFAULT_FORM, ...stored };
  const patch = (x: Partial<IvForm>) => setForm((prev) => ({ ...DEFAULT_FORM, ...prev, ...x }));
  const fl = flags(f.status);

  const originList = useMemo(() => origins(settings, prefs.trainerLevel, f.friend), [settings, prefs.trainerLevel, f.friend]);
  const origin = originList.find((o) => o.id === f.origin) ?? originList[0];

  // Distinct power-up stardust values (adjusted for status) with the level range each applies to
  const dustOpts = useMemo(() => {
    const m = new Map<number, number[]>();
    for (const L of LEVELS) {
      if (L >= 50) continue;
      let d = dustAtLevel(settings, L);
      if (!d) continue;
      if (fl.shadow) d = Math.ceil(d * settings.upgrade.shadowMult);
      if (fl.purified) d = Math.ceil(d * settings.upgrade.purifiedMult);
      if (fl.lucky) d = Math.ceil(d * settings.upgrade.luckyDustMult);
      if (!m.has(d)) m.set(d, []);
      m.get(d)!.push(L);
    }
    return [{ id: 0, label: 'Any / not sure' }, ...[...m.entries()].sort((a, b) => a[0] - b[0]).map(([d, ls]) => ({ id: d, label: `${fmt(d)} · L${ls[0]}–${ls[ls.length - 1]}` }))];
  }, [settings, fl.shadow, fl.purified, fl.lucky]);
  useEffect(() => { if (f.dust && !dustOpts.some((o) => o.id === f.dust)) patch({ dust: 0 }); }, [dustOpts]); // eslint-disable-line react-hooks/exhaustive-deps

  const cpVal = num(f.cp);
  const results: IvMatch[] = useMemo(() => {
    if (cpVal < 10) return [];
    const res = solveIvs(p, settings, {
      cp: cpVal, hp: num(f.hp) || undefined, dust: f.dust || undefined,
      minLevel: origin.min, maxLevel: origin.max, halfLevels: origin.half,
      appraisal: { stars: f.stars >= 0 ? (f.stars as 0 | 1 | 2 | 3 | 4) : undefined, minIv: origin.floor },
      ...fl,
    });
    return res.filter((r) => r.ivs.every((v, i) => f.bars[i] < 0 || ivBucket(v) === f.bars[i]));
  }, [p, settings, cpVal, f.hp, f.dust, origin, f.stars, f.bars, fl.shadow, fl.purified, fl.lucky]); // eslint-disable-line react-hooks/exhaustive-deps

  const [chosen, setChosen] = useState<string | null>(null);
  const keyOf = (r: IvMatch) => `${r.level}|${r.ivs.join('/')}`;
  useEffect(() => setChosen(null), [results]);
  const selected = results.length === 1 ? results[0] : results.find((r) => keyOf(r) === chosen) ?? null;
  const { visible, more } = useShowMore(results, 60);

  const summary = useMemo(() => {
    if (!results.length) return null;
    const pcts = results.map((r) => r.percent);
    const lv = new Map<number, number>();
    results.forEach((r) => lv.set(r.level, (lv.get(r.level) || 0) + 1));
    const levels = [...lv.entries()].sort((a, b) => b[1] - a[1]);
    const range = (i: number) => { const v = results.map((r) => r.ivs[i]); return [Math.min(...v), Math.max(...v)]; };
    return { min: Math.min(...pcts), max: Math.max(...pcts), levels, atk: range(0), def: range(1), sta: range(2), avg: pcts.reduce((a, b) => a + b, 0) / pcts.length };
  }, [results]);

  const maxHp = hp(p, settings, 51, 15);
  return (
    <div className="stack" style={{ marginTop: 16 }}>
      <div className="split">
        <div className="col" style={{ gap: 14 }}>
          <div className="fields">
            <Field label="CP"><NumberInput value={f.cp} onChange={(v) => patch({ cp: v })} min={10} placeholder="e.g. 1834" /></Field>
            <Field label="HP" hint="Optional but narrows a lot"><NumberInput value={f.hp} onChange={(v) => patch({ hp: v })} min={10} max={maxHp} placeholder="e.g. 142" /></Field>
          </div>
          <Field label="Status">
            <Segmented options={STATUS_OPTS} value={f.status} onChange={(s) => patch({ status: s })} size="sm" />
          </Field>
          <Field label="Power-up Stardust cost" hint="Shown on the Power Up button. Changes with status (shadow ×1.2, purified ×0.9, lucky ×0.5).">
            <Select value={f.dust} onChange={(v) => patch({ dust: v })} options={dustOpts} />
          </Field>
          <Field label="Where did it come from?" hint={origin.note}>
            <Select value={origin.id} onChange={(id) => { const o = originList.find((x) => x.id === id); patch({ origin: id, ...(o?.status ? { status: o.status } : {}) }); }} options={originList.map((o) => ({ id: o.id, label: o.label }))} />
          </Field>
          {origin.id === 'traded' && (
            <Field label="Friendship level at trade">
              <Segmented size="sm" value={f.friend} onChange={(v) => patch({ friend: v })} options={[1, 2, 3, 4].map((l) => ({ id: l, label: friendName(l) })).concat([{ id: 5, label: 'Lucky' }])} />
            </Field>
          )}
          <Field label="Appraisal stars" hint="0★ 0–48% · 1★ 51–64% · 2★ 67–80% · 3★ 82–98% · 4★ 100%">
            <Segmented size="sm" value={f.stars} onChange={(v) => patch({ stars: v })} options={[{ id: -1, label: 'Any' }, { id: 0, label: '0★' }, { id: 1, label: '1★' }, { id: 2, label: '2★' }, { id: 3, label: '3★' }, { id: 4, label: '4★' }]} />
          </Field>
          <Field label="Appraisal bars (optional)" hint="Each bar has 3 segments of 5. A full red bar = 15.">
            <div className="col" style={{ gap: 6 }}>
              {(['Attack', 'Defense', 'HP'] as const).map((l, i) => (
                <div key={l} className="row nowrap" style={{ gap: 8 }}>
                  <span className="small muted" style={{ width: 56 }}>{l}</span>
                  <Select style={{ flex: 1 }} value={f.bars[i]} onChange={(v) => { const b = [...f.bars] as [number, number, number]; b[i] = v; patch({ bars: b }); }}
                    options={[{ id: -1, label: 'Any' }, ...BUCKET_LABELS.map((lab, j) => ({ id: j, label: j === 0 ? 'Empty (0)' : j === 4 ? 'Full red (15)' : `${lab} (${j === 1 ? '1 segment' : j === 2 ? '2 segments' : '3 segments, not full'})` }))]} />
                </div>
              ))}
            </div>
          </Field>
          <div className="row">
            <button className="btn ghost sm" onClick={() => setForm(DEFAULT_FORM)}>Reset inputs</button>
          </div>
        </div>

        <div className="col" style={{ gap: 14 }}>
          {cpVal < 10 ? (
            <Empty icon="⌨️">Enter the CP shown in game (and HP if you can) to find matching IVs.</Empty>
          ) : !results.length ? (
            <div className="callout warn">
              <b>No IV combination matches.</b>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                <li>Check you picked the right form (e.g. Alolan / Galarian) and status (shadow / purified / lucky change the dust cost).</li>
                <li>A weather-boosted or powered-up Pokémon can be above the wild level cap — try “Powered up / unknown”.</li>
                <li>Double-check the CP, HP and power-up Stardust (the CP shown with a Best Buddy boost is one level higher).</li>
              </ul>
            </div>
          ) : (
            <>
              {summary && (
                <div className="tool-tiles">
                  <StatTile label="Matches" value={fmt(results.length)} sub={results.length === 1 ? 'Unique result' : 'Tap a row to choose'} />
                  <StatTile label="IV %" value={summary.min === summary.max ? pct(summary.min) : `${fmt(summary.min, 0)}–${fmt(summary.max, 0)}%`} sub={`avg ${pct(summary.avg)}`} />
                  <StatTile label="Likely level" value={summary.levels[0][0]} sub={summary.levels.length > 1 ? `${summary.levels.length} possible levels` : 'Only level'} />
                  <StatTile label="Atk / Def / HP" value={<span style={{ fontSize: '1rem' }}>{summary.atk.join('–')} / {summary.def.join('–')} / {summary.sta.join('–')}</span>} sub="IV ranges" />
                </div>
              )}
              <div className="table-wrap" style={{ maxHeight: 520 }}>
                <table className="table compact">
                  <thead><tr><th className="num">Level</th><th className="num">Atk</th><th className="num">Def</th><th className="num">HP</th><th>Bars</th><th className="num">IV%</th><th>★</th><th className="num">CP</th><th className="num">HP</th></tr></thead>
                  <tbody>
                    {visible.map((r) => (
                      <tr key={keyOf(r)} className={`clickable ${selected && keyOf(selected) === keyOf(r) ? 'sel' : ''}`} onClick={() => setChosen(keyOf(r))}>
                        <td className="num">{r.level}</td>
                        <td className="num">{r.ivs[0]}</td><td className="num">{r.ivs[1]}</td><td className="num">{r.ivs[2]}</td>
                        <td><IvBars ivs={r.ivs} /></td>
                        <td className={`num ${r.percent === 100 ? 'good bold' : ''}`}>{pct(r.percent)}</td>
                        <td className="small">{appraisalStars(r.ivs)}★</td>
                        <td className="num">{r.cp}</td><td className="num">{r.hp}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {more}
              </div>
            </>
          )}
        </div>
      </div>
      {selected && <InstancePanel p={p} level={selected.level} ivs={selected.ivs} status={f.status} cpShown={selected.cp} title={results.length === 1 ? 'Your Pokémon (unique match)' : 'Selected match'} />}
    </div>
  );
}

// ---------------------------------------------------------------- known-IV mode
function KnownIvs({ p }: { p: Pokemon }) {
  const [ivs, setIvs] = useStored<[number, number, number]>('tools.iv.known.ivs', [15, 15, 15]);
  const [level, setLevel] = useStored<number>('tools.iv.known.level', 20);
  const [status, setStatus] = useStored<Status>('tools.iv.known.status', 'normal');
  return (
    <div className="stack" style={{ marginTop: 16 }}>
      <div className="grid grid-2">
        <Field label="IVs"><IvInputs value={ivs} onChange={setIvs} /></Field>
        <div className="col">
          <Field label="Level"><Select value={level} onChange={setLevel} options={levelOptions(51)} /></Field>
          <Field label="Status"><Segmented size="sm" options={STATUS_OPTS} value={status} onChange={setStatus} /></Field>
        </div>
      </div>
      <InstancePanel p={p} level={level} ivs={ivs} status={status} title="Stats" />
    </div>
  );
}

// ---------------------------------------------------------------- details + PvP ranks for one instance
function InstancePanel({ p, level, ivs, status, title, cpShown }: { p: Pokemon; level: number; ivs: [number, number, number]; status: Status; title: string; cpShown?: number }) {
  const { settings } = useData();
  const { add } = useMyPokemon();
  const toast = useToast();
  const fl = flags(status);
  const c = cpShown ?? cp(p, settings, level, ivs);
  const st = stats(p, settings, level, ivs);
  const per = ivPercent(ivs);
  const atkMult = fl.shadow ? settings.combat?.shadowAtk ?? 1.2 : 1;
  const defMult = fl.shadow ? settings.combat?.shadowDef ?? 1 / 1.2 : 1;

  const ranks = useMemo(() => LEAGUES.map((lg) => {
    const rows = rankPvpIvs(p, settings, { cap: lg.cap, maxLevel: 50 });
    const row = rows.find((r) => r.ivs[0] === ivs[0] && r.ivs[1] === ivs[1] && r.ivs[2] === ivs[2]);
    return { lg, row, total: rows.length, best: rows[0] };
  }), [p, settings, ivs]);

  const save = () => {
    add({ id: p.id, cp: c, level, ivs, ...fl });
    toast.show(`Saved ${displayName(p, fl.shadow)} to My Pokémon`);
  };

  return (
    <Card title={title} actions={<button className="btn primary sm" onClick={save}>💾 Save to My Pokémon</button>}>
      <div className="stack">
        <div className="tool-hero">
          <div>
            <div className="big-cp"><small>CP</small>{fmt(c)}</div>
            <div className="small muted" style={{ marginTop: 4 }}>{displayName(p, fl.shadow)} · Level {level}{status !== 'normal' ? ` · ${status}` : ''}</div>
          </div>
          <div className="spacer" />
          <div className="col" style={{ gap: 4, alignItems: 'flex-end' }}>
            <IvBars ivs={ivs} />
            <span className="small"><b>{ivs.join(' / ')}</b> · {pct(per)} · {starsLabel(appraisalStars(ivs))}</span>
          </div>
        </div>
        <div className="tool-tiles">
          <StatTile label="HP" value={st.hp} />
          <StatTile label="Attack" value={fmt(st.atk * atkMult, 1)} sub={fl.shadow ? 'incl. shadow ×1.2' : `base ${p.atk} + ${ivs[0]}`} />
          <StatTile label="Defense" value={fmt(st.def * defMult, 1)} sub={fl.shadow ? 'incl. shadow ×0.83' : `base ${p.def} + ${ivs[1]}`} />
          <StatTile label="Stamina" value={p.sta + ivs[2]} sub={`base ${p.sta} + ${ivs[2]}`} />
          <StatTile label="Stat product" value={fmt((st.atk * st.def * st.hp) / 1000, 1) + 'k'} />
        </div>
        <div>
          <h3 style={{ margin: '4px 0 8px', fontSize: '1rem' }}>PvP IV rank</h3>
          <div className="table-wrap">
            <table className="table compact">
              <thead><tr><th>League</th><th className="num">Rank</th><th className="num">% of #1</th><th className="num">Best level</th><th className="num">CP</th><th>To reach it</th><th></th></tr></thead>
              <tbody>
                {ranks.map(({ lg, row, total }) => {
                  const lgKey = lg.key;
                  if (!row) return <tr key={lgKey}><td>{lg.name}</td><td colSpan={6} className="muted small">Not eligible — CP is above {fmt(lg.cap)} even at level 1.</td></tr>;
                  const over = c > lg.cap;
                  const cost = !over && row.level > level ? upgradeCost(settings, p, level, row.level, fl) : null;
                  return (
                    <tr key={lgKey}>
                      <td>{lg.name}</td>
                      <td className="num"><b>#{fmt(row.rank)}</b> <span className="faint small">/ {fmt(total)}</span></td>
                      <td className={`num ${row.pct >= 99 ? 'good' : row.pct < 95 ? 'warn' : ''}`}>{pct(row.pct, 2)}</td>
                      <td className="num">{row.level}</td>
                      <td className="num">{fmt(row.cp)}</td>
                      <td className="small">
                        {over ? <span className="bad">Already over {fmt(lg.cap)} CP</span>
                          : cost ? <span>{fmt(cost.dust)} dust · {fmt(cost.candy)} candy{cost.xl ? ` · ${fmt(cost.xl)} XL` : ''}</span>
                            : <span className="muted">Already there</span>}
                      </td>
                      <td><Link className="btn ghost sm" to={`/pvp/ivs?id=${p.id}&league=${lgKey}`}>Ranks →</Link></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="tool-note" style={{ marginTop: 8 }}>Ranked by stat product among all 4,096 IV combinations, max level 50 (no Best Buddy). Master League ranks by stat product at level 50.</p>
        </div>
        <div className="row">
          <Link className="btn sm" to={`/dex/${p.id}`}>📖 Pokédex entry</Link>
          <Link className="btn sm" to={`/tools/cp?id=${p.id}`}>📈 CP by level</Link>
          <Link className="btn sm" to={`/tools/powerup?id=${p.id}`}>⬆️ Power-up cost</Link>
        </div>
      </div>
      {toast.node}
    </Card>
  );
}
