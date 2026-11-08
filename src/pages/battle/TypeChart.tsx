import { useMemo, useState } from 'react';
import { Card, MultChip, PageHeader, PokemonPicker, Segmented, TypeBadge, Types } from '../../components/ui';
import { displayName, useData } from '../../lib/data';
import { fmt } from '../../lib/format';
import { typeIcon } from '../../lib/images';
import { defensiveProfile, effectiveness, multLabel, TYPES } from '../../lib/pogo';
import type { PokeType, Pokemon } from '../../lib/types';
import './battle.css';

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

function cellClass(m: number) {
  if (m > 1.01) return 'se';
  if (m < 0.5) return 'imm';
  if (m < 0.99) return 'nve';
  return 'n';
}
function cellText(m: number) {
  if (m > 1.01) return '1.6';
  if (m < 0.5) return '.39';
  if (m < 0.99) return '.625';
  return '1';
}

const MULT_GROUPS = [
  { label: '×2.56', test: (m: number) => m > 2, tone: 'bad' },
  { label: '×1.6', test: (m: number) => m > 1.01 && m <= 2, tone: 'bad' },
  { label: '×1', test: (m: number) => m >= 0.99 && m <= 1.01, tone: '' },
  { label: '×0.625', test: (m: number) => m >= 0.6 && m < 0.99, tone: 'good' },
  { label: '×0.39', test: (m: number) => m >= 0.38 && m < 0.6, tone: 'good' },
  { label: '×0.244', test: (m: number) => m < 0.38, tone: 'good' },
];

export default function TypeChart() {
  const data = useData();
  const chart = data.types;
  const [hover, setHover] = useState<{ r: number; c: number } | null>(null);
  const [defTypes, setDefTypes] = useState<PokeType[]>(['dragon', 'flying']);
  const [defMon, setDefMon] = useState<Pokemon | null>(null);
  const [atkType, setAtkType] = useState<PokeType>('fire');
  const [mode, setMode] = useState<'types' | 'pokemon'>('types');

  const toggleDef = (t: PokeType) => {
    setDefMon(null);
    setDefTypes((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : cur.length >= 2 ? [cur[1], t] : [...cur, t]));
  };
  const activeDef = mode === 'pokemon' ? defMon?.types ?? [] : defTypes;

  return (
    <div>
      <PageHeader title="Type Chart" subtitle="Pokémon GO type effectiveness: the full 18 × 18 matrix, a defensive weakness calculator for any typing or Pokémon, and an offensive coverage view." />

      <Card title="Effectiveness matrix" actions={<span className="small faint hide-mobile">Rows attack · columns defend · click a header to analyse it</span>}>
        <div className="tc-legend" style={{ marginBottom: 10 }}>
          <span><span className="sw" style={{ background: '#e2584d' }} />Super effective ×1.6</span>
          <span><span className="sw" style={{ background: '#2f8f5b' }} />Not very effective ×0.625</span>
          <span><span className="sw" style={{ background: '#134d31' }} />“Immune” ×0.390625</span>
          <span className="faint">Blank = neutral ×1</span>
        </div>
        <div className="tc-wrap" onMouseLeave={() => setHover(null)}>
          <table className="tc" aria-label="Type effectiveness: attacking type rows by defending type columns">
            <thead>
              <tr>
                <th className="corner" scope="col">ATK ↓ <br />DEF →</th>
                {TYPES.map((t, c) => (
                  <th key={t} scope="col" className={hover?.c === c ? 'hl' : ''}>
                    <button type="button" className="tc-colhead" title={`Defending ${cap(t)} — show weaknesses`} onClick={() => { setMode('types'); setDefMon(null); setDefTypes([t]); document.getElementById('tc-def')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>
                      <img src={typeIcon(t)} alt="" loading="lazy" />{t.slice(0, 4)}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {TYPES.map((a, r) => (
                <tr key={a} className={hover?.r === r ? 'hl' : ''}>
                  <th scope="row" className={hover?.r === r ? 'hl' : ''}>
                    <button type="button" className="tc-rowhead" title={`${cap(a)} moves — show coverage`} onClick={() => { setAtkType(a); document.getElementById('tc-off')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>
                      <img src={typeIcon(a)} alt="" loading="lazy" /><span style={{ color: `var(--t-${a})` }}>{a}</span>
                    </button>
                  </th>
                  {TYPES.map((d, c) => {
                    const m = chart[a]?.[d] ?? 1;
                    return (
                      <td key={d} className={`tc-cell ${cellClass(m)} ${hover?.c === c ? 'hl' : ''} ${hover?.r === r && hover?.c === c ? 'focus' : ''}`}
                        title={`${cap(a)} → ${cap(d)}: ×${m === 0.390625 ? '0.390625' : m}`}
                        onMouseEnter={() => setHover({ r, c })}>
                        {cellText(m)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid grid-2" style={{ marginTop: 16, alignItems: 'start' }}>
        <Card id="tc-def" title="Defensive calculator" actions={<Segmented size="sm" value={mode} onChange={setMode} options={[{ id: 'types', label: 'Types' }, { id: 'pokemon', label: 'Pokémon' }]} />}>
          <div className="col" style={{ gap: 12 }}>
            {mode === 'types' ? (
              <>
                <div className="small muted">Pick one or two defending types.</div>
                <div className="type-pick" role="group" aria-label="Defending types">
                  {TYPES.map((t) => (
                    <button key={t} type="button" className={defTypes.includes(t) ? 'on' : ''} aria-pressed={defTypes.includes(t)} onClick={() => toggleDef(t)}>
                      <TypeBadge type={t} small />
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <PokemonPicker value={defMon} onChange={setDefMon} placeholder="Search a Pokémon…" />
            )}
            {activeDef.length > 0 ? (
              <>
                <div className="row" style={{ gap: 8 }}>
                  <span className="field-label">Defender</span>
                  {mode === 'pokemon' && defMon && <span className="bold">{displayName(defMon)}</span>}
                  <Types types={activeDef} />
                </div>
                <DefensiveBreakdown types={activeDef} />
              </>
            ) : <div className="faint small">{mode === 'pokemon' ? 'Pick a Pokémon to see its weaknesses and resistances.' : 'Select a type to see its weaknesses and resistances.'}</div>}
          </div>
        </Card>

        <Card id="tc-off" title="Offensive coverage">
          <div className="col" style={{ gap: 12 }}>
            <div className="small muted">Pick a move type.</div>
            <div className="type-pick" role="group" aria-label="Attacking type">
              {TYPES.map((t) => (
                <button key={t} type="button" className={atkType === t ? 'on' : ''} aria-pressed={atkType === t} onClick={() => setAtkType(t)}>
                  <TypeBadge type={t} small />
                </button>
              ))}
            </div>
            <OffensiveBreakdown type={atkType} />
          </div>
        </Card>
      </div>

      <Explainer />
    </div>
  );
}

function DefensiveBreakdown({ types }: { types: PokeType[] }) {
  const { types: chart } = useData();
  const profile = defensiveProfile(chart, types);
  return (
    <div>
      {MULT_GROUPS.map((g) => {
        const list = profile.filter((x) => g.test(x.mult));
        if (!list.length) return null;
        const isNeutral = g.label === '×1';
        return (
          <div key={g.label} className="mult-group">
            <span><MultChip m={list[0].mult} /><div className="tiny faint" style={{ marginTop: 2 }}>{g.tone === 'bad' ? 'weak' : g.tone === 'good' ? 'resists' : 'neutral'}</div></span>
            <span className="types" style={{ gap: 5 }}>{list.map((x) => <TypeBadge key={x.type} type={x.type} small noIcon={isNeutral} />)}</span>
          </div>
        );
      })}
    </div>
  );
}

function OffensiveBreakdown({ type }: { type: PokeType }) {
  const data = useData();
  const row = data.types[type];
  const se = TYPES.filter((t) => (row[t] ?? 1) > 1.01);
  const nve = TYPES.filter((t) => (row[t] ?? 1) < 0.99 && (row[t] ?? 1) >= 0.5);
  const imm = TYPES.filter((t) => (row[t] ?? 1) < 0.5);
  // How many released Pokémon (excluding Megas) this type hits super effectively / for ×2.56 / resisted
  const counts = useMemo(() => {
    let x256 = 0, x16 = 0, resisted = 0, total = 0;
    for (const p of data.pokemon) {
      if (!p.released || p.megaOf) continue;
      total++;
      const m = effectiveness(data.types, type, p.types);
      if (m > 2) x256++; else if (m > 1.01) x16++; else if (m < 0.99) resisted++;
    }
    return { x256, x16, resisted, total };
  }, [data, type]);
  const resistedBy = TYPES.filter((t) => (data.types[t]?.[type] ?? 1) < 0.99);
  const weakTo = TYPES.filter((t) => (data.types[t]?.[type] ?? 1) > 1.01);
  return (
    <div>
      <div className="mult-group">
        <span><MultChip m={1.6} /><div className="tiny faint">strong vs</div></span>
        <span className="types">{se.length ? se.map((t) => <TypeBadge key={t} type={t} small />) : <span className="faint small">Nothing</span>}</span>
      </div>
      <div className="mult-group">
        <span><MultChip m={0.625} /><div className="tiny faint">weak vs</div></span>
        <span className="types">{nve.length ? nve.map((t) => <TypeBadge key={t} type={t} small />) : <span className="faint small">Nothing</span>}</span>
      </div>
      {imm.length > 0 && (
        <div className="mult-group">
          <span><MultChip m={0.390625} /><div className="tiny faint">“immune”</div></span>
          <span className="types">{imm.map((t) => <TypeBadge key={t} type={t} small />)}</span>
        </div>
      )}
      <div className="divider" />
      <div className="small muted">
        Against the {fmt(counts.total)} released Pokémon (Megas excluded), {cap(type)} moves hit <b className="bad">{fmt(counts.x256)}</b> for ×2.56,{' '}
        <b className="bad">{fmt(counts.x16)}</b> for ×1.6 and are resisted by <b className="good">{fmt(counts.resisted)}</b>.
      </div>
      <div className="divider" />
      <div className="kv">
        <span>{cap(type)}-type Pokémon resist</span>
        <span className="types">{resistedBy.length ? resistedBy.map((t) => <TypeBadge key={t} type={t} small />) : <span className="faint small">Nothing</span>}</span>
        <span>{cap(type)}-type Pokémon are weak to</span>
        <span className="types">{weakTo.map((t) => <TypeBadge key={t} type={t} small />)}</span>
      </div>
    </div>
  );
}

function Explainer() {
  const { settings } = useData();
  const stab = settings.combat?.stab ?? 1.2;
  const wb = settings.weatherBonus?.attack ?? 1.2;
  const examples: { label: string; m: number; how: string }[] = [
    { label: 'Double weakness', m: 1.6 * 1.6, how: '1.6 × 1.6' },
    { label: 'Weak + resist', m: 1.6 * 0.625, how: '1.6 × 0.625' },
    { label: 'Double resistance', m: 0.625 * 0.625, how: '0.625 × 0.625' },
    { label: '“Immune” + resist', m: 0.390625 * 0.625, how: '0.390625 × 0.625' },
    { label: 'Weak + “immune”', m: 1.6 * 0.390625, how: '1.6 × 0.390625' },
  ];
  return (
    <Card title="How type effectiveness works in Pokémon GO" style={{ marginTop: 16 }}>
      <div className="grid grid-2">
        <div className="stack-sm small">
          <p>Pokémon GO uses gentler multipliers than the main series games:</p>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li><b>Super effective:</b> <span className="formula">×1.6</span> (main series ×2)</li>
            <li><b>Not very effective:</b> <span className="formula">×0.625</span> (main series ×0.5)</li>
            <li><b>No effect:</b> <span className="formula">×0.390625</span> = 0.625² — in GO, “immunities” still deal damage, they are treated as a double resistance.</li>
          </ul>
          <p>For dual-type defenders the two multipliers are <b>multiplied together</b>, so a move can land anywhere from ×0.244 to ×2.56.</p>
          <p>On top of type effectiveness, a move gets <span className="formula">×{stab}</span> STAB when it matches one of the attacker’s types, and <span className="formula">×{wb}</span> when its type is boosted by the current weather. All bonuses stack multiplicatively.</p>
        </div>
        <div>
          <table className="table compact">
            <thead><tr><th>Case</th><th>Math</th><th className="num">Result</th></tr></thead>
            <tbody>
              {examples.map((e) => (
                <tr key={e.label}><td>{e.label}</td><td className="mono small">{e.how}</td><td className="num"><span title={String(e.m)}><MultChip m={e.m} /></span> <span className="faint tiny">{multLabel(e.m) === '×1' ? '(neutral)' : ''}</span></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Card>
  );
}
