import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, MoveTag, PageHeader, PokemonPicker, TypeBadge, Types } from '../../components/ui';
import { displayName, movePool, useData } from '../../lib/data';
import { fmt } from '../../lib/format';
import { ENCOUNTERS, TYPES, WEATHERS, weatherTypes } from '../../lib/pogo';
import type { PokeType, Pokemon } from '../../lib/types';
import './reference.css';

type WeatherId = (typeof WEATHERS)[number]['id'];
const multText = (m: number) => `×${Number(m.toFixed(3))}`;

export default function Weather() {
  const data = useData();
  const { settings } = data;
  const wb = settings.weatherBonus;
  const [sel, setSel] = useState<WeatherId | null>(null);
  const [mon, setMon] = useState<Pokemon | null>(null);

  const released = useMemo(() => data.pokemon.filter((p) => p.released && !p.megaOf), [data.pokemon]);
  const weathers = useMemo(() => WEATHERS.map((w) => {
    const types = weatherTypes(settings, w.id);
    return { ...w, types, count: released.filter((p) => p.types.some((t) => types.includes(t))).length };
  }), [settings, released]);

  const byType = useMemo(() => {
    const m = new Map<PokeType, (typeof weathers)[number]>();
    for (const w of weathers) for (const t of w.types) m.set(t, w);
    return m;
  }, [weathers]);
  const typeCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const p of released) for (const t of p.types) c[t] = (c[t] || 0) + 1;
    return c;
  }, [released]);
  const unmapped = TYPES.filter((t) => !byType.has(t));

  const wildMax = settings.maxEncounterLevel;
  const encounterRows = [
    { label: 'Wild spawn', level: `1–${wildMax}`, boosted: `${1 + wb.level}–${wildMax + wb.level}`, floor: 0, boostedFloor: wb.minIv, note: 'Weather boost raises level and IV floor' },
    ...Object.values(ENCOUNTERS).map((e) => ({
      label: e.label, level: String(e.level), boosted: String(e.boosted), floor: e.minIv,
      boostedFloor: e.minIv,
      note: e.boosted === e.level ? 'Not affected by weather' : `+${e.boosted - e.level} levels when boosted`,
    })),
  ];

  const selW = sel ? weathers.find((w) => w.id === sel)! : null;
  const monInfo = useMemo(() => {
    if (!mon) return null;
    const pool = movePool(mon, true);
    const ids = [...pool.fast, ...pool.charged];
    return {
      boosts: weathers.filter((w) => mon.types.some((t) => w.types.includes(t))),
      moves: ids.map((id) => ({ id, move: data.moves[id], w: data.moves[id] ? byType.get(data.moves[id].type) ?? null : null })).filter((x) => x.move),
    };
  }, [mon, weathers, data.moves, byType]);

  return (
    <div className="stack">
      <PageHeader
        title="Weather Boosts"
        subtitle="How in-game weather changes which Pokémon spawn, their levels and IVs, and how hard their moves hit. Values come from the game master."
      />

      <div className="ref-weather-grid">
        {weathers.map((w) => (
          <button key={w.id} className={`ref-weather ${sel === w.id ? 'on' : ''}`} onClick={() => setSel(sel === w.id ? null : w.id)} aria-pressed={sel === w.id}>
            <div className="head">
              <span className="ico" aria-hidden>{w.icon}</span>
              <div>
                <div className="nm">{w.name}</div>
                <div className="meta">{fmt(w.count)} released Pokémon boosted</div>
              </div>
            </div>
            <div className="types">{w.types.map((t) => <TypeBadge key={t} type={t} />)}</div>
          </button>
        ))}
      </div>

      {selW && (
        <div className="callout">
          <b>{selW.icon} {selW.name}</b> boosts {selW.types.map((t, i) => <span key={t}>{i > 0 && (i === selW.types.length - 1 ? ' and ' : ', ')}<b style={{ textTransform: 'capitalize' }}>{t}</b></span>)}.
          Those types spawn more often, wild catches get +{wb.level} levels and a {wb.minIv}/{wb.minIv}/{wb.minIv} IV floor, and moves of those types deal {multText(wb.attack)} damage in raids and gyms.
          {' '}<Link to="/counters">Find raid counters →</Link>
        </div>
      )}

      <Card title="What a weather boost does">
        <div className="ref-effects">
          <div className="ref-effect"><span className="big">+{wb.level}</span><div><div className="t">Wild Pokémon levels</div><div className="d">Boosted wild spawns are {wb.level} levels higher: level {1 + wb.level}–{wildMax + wb.level} instead of 1–{wildMax}, so they have higher CP.</div></div></div>
          <div className="ref-effect"><span className="big">{wb.minIv}/{wb.minIv}/{wb.minIv}</span><div><div className="t">IV floor</div><div className="d">Each IV of a boosted wild spawn is at least {wb.minIv}, up from 0.</div></div></div>
          <div className="ref-effect"><span className="big">{multText(wb.dust)}</span><div><div className="t">Catch Stardust</div><div className="d">Catching a boosted Pokémon gives {Math.round((wb.dust - 1) * 100)}% more Stardust.</div></div></div>
          <div className="ref-effect"><span className="big">{multText(wb.attack)}</span><div><div className="t">Move damage</div><div className="d">Moves whose type is boosted deal {multText(wb.attack)} damage in raids, gyms and other battles against the game. Trainer Battles (PvP) ignore weather.</div></div></div>
          <div className="ref-effect"><span className="big">Lv {ENCOUNTERS.raid.boosted}</span><div><div className="t">Raid &amp; Max Battle catches</div><div className="d">The reward encounter is level {ENCOUNTERS.raid.boosted} instead of {ENCOUNTERS.raid.level} when its type is boosted. The IV floor stays {wb.raidMinIv}.</div></div></div>
          <div className="ref-effect"><span className="big">More</span><div><div className="t">Spawns</div><div className="d">Pokémon of the boosted types appear more often in the wild.</div></div></div>
        </div>
      </Card>

      <div className="grid grid-2">
        <Card title="Type → weather lookup" flush footer={unmapped.length ? `Not boosted by any weather: ${unmapped.join(', ')}` : 'Every type is boosted by exactly one weather condition.'}>
          <div className="table-wrap">
            <table className="table compact ref-table">
              <thead><tr><th>Type</th><th>Boosted by</th><th className="num">Pokémon</th></tr></thead>
              <tbody>
                {TYPES.map((t) => {
                  const w = byType.get(t);
                  return (
                    <tr key={t} className={sel && w?.id === sel ? 'hl' : ''}>
                      <td><TypeBadge type={t} /></td>
                      <td>{w ? <button className="btn ghost sm ref-wx" onClick={() => setSel(w.id)}><span className="i">{w.icon}</span>{w.name}</button> : <span className="faint">—</span>}</td>
                      <td className="num muted">{fmt(typeCounts[t] || 0)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Encounter levels & IV floors" flush footer="Levels per source come from the app's encounter table; weather values come from the game master. Hatched eggs and Field Research rewards are never weather boosted.">
          <div className="table-wrap">
            <table className="table compact">
              <thead><tr><th>Source</th><th className="num">Level</th><th className="num">Boosted</th><th className="num">IV floor</th><th className="hide-mobile">Note</th></tr></thead>
              <tbody>
                {encounterRows.map((r) => (
                  <tr key={r.label}>
                    <td className="bold">{r.label}</td>
                    <td className="num">{r.level}</td>
                    <td className="num">{r.boosted === r.level ? <span className="faint">{r.boosted}</span> : <b className="good">{r.boosted}</b>}</td>
                    <td className="num">{r.boostedFloor !== r.floor ? <>{r.floor} → <b className="good">{r.boostedFloor}</b></> : r.floor}</td>
                    <td className="hide-mobile small muted">{r.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <Card title="Is my Pokémon boosted?">
        <div className="stack">
          <div style={{ maxWidth: 420 }}><PokemonPicker value={mon} onChange={setMon} placeholder="Pick a Pokémon…" allowClear /></div>
          {mon && monInfo && (
            <div className="grid grid-2">
              <div className="stack-sm">
                <div className="row"><b>{displayName(mon)}</b><Types types={mon.types} small /></div>
                {monInfo.boosts.length ? monInfo.boosts.map((w) => (
                  <div key={w.id} className="tile row" style={{ gap: 10 }}>
                    <span style={{ fontSize: '1.4rem' }}>{w.icon}</span>
                    <div><div className="bold">{w.name}</div><div className="small muted">Boosts its {mon.types.filter((t) => w.types.includes(t)).join(' & ')} typing: more spawns, +{wb.level} levels, IV floor {wb.minIv}</div></div>
                  </div>
                )) : <p className="muted">No weather boosts this Pokémon's typing.</p>}
              </div>
              <div>
                <div className="field-label" style={{ marginBottom: 6 }}>Its moves are boosted by</div>
                <div className="ref-moves">
                  {monInfo.moves.map(({ id, move, w }) => (
                    <div key={id} className="mv">
                      <span className="row nowrap" style={{ gap: 8 }}><MoveTag id={id} elite={mon.eliteFast.includes(id) || mon.eliteCharged.includes(id)} /><span className="faint tiny">{move.fast ? 'Fast' : 'Charged'}</span></span>
                      {w ? <span className="ref-wx small"><span className="i">{w.icon}</span>{w.name} <span className="faint">{multText(wb.attack)}</span></span> : <span className="faint small">—</span>}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
