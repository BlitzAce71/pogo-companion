import { useMemo } from 'react';
import { Card, Field, NumberInput, PageHeader, Segmented, Select, StatTile } from '../../components/ui';
import { useData } from '../../lib/data';
import { fmt, pct, plural } from '../../lib/format';
import { trainerLevelFromXp } from '../../lib/pogo';
import { usePrefs, useStored } from '../../lib/storage';
import { clamp, friendName, num } from './toolUtils';
import './tools.css';

interface XpForm { mode: 'level' | 'total'; level: number; into: number | ''; total: number | ''; target: number; perDay: number | ''; eggBase: number | '' }
const DEFAULT: XpForm = { mode: 'level', level: 30, into: '', total: '', target: 40, perDay: 50000, eggBase: 30000 };

/**
 * XP sources — community-known / approximate values (Niantic changes these over time and during events).
 * Friendship XP comes from settings.friendship instead.
 */
const XP_SOURCES: { group: string; rows: [string, string, string?][] }[] = [
  { group: 'Catching', rows: [
    ['Catch a Pokémon', '100'], ['First throw bonus', '+50'], ['Curveball bonus', '+10'],
    ['Nice / Great / Excellent throw', '+10 / +50 / +100'], ['New Pokédex entry', '+500'],
    ['First catch of the day', '+500', 'daily streak bonus'], ['7-day catch streak', '+2,000', 'approx.'],
  ] },
  { group: 'Evolving & eggs', rows: [
    ['Evolve a Pokémon', '500'], ['Evolve into a new Pokédex entry', '+1,000'],
    ['Hatch an egg', '≈200 – 1,000+', 'more for longer eggs; varies'],
  ] },
  { group: 'PokéStops', rows: [
    ['Spin a PokéStop', '50'], ['First spin of a new PokéStop', '+250'], ['First PokéStop of the day', '+500'],
    ['Every 10th unique PokéStop', '+100', 'approx.'], ['7-day spin streak', '+2,000', 'approx.'],
  ] },
  { group: 'Battles', rows: [
    ['Win a raid', '≈3,000 – 10,000', 'scales with raid tier; Legendary ≈10,000'],
    ['Defeat a gym Pokémon', '100', 'approx.'], ['Max Battles', 'varies', 'scales with battle tier'],
    ['Team GO Rocket battles', 'varies', 'more for Leaders / Giovanni'],
  ] },
];

export default function XpCalculator() {
  const { settings } = useData();
  const [prefs] = usePrefs();
  const [stored, setForm] = useStored<XpForm>('tools.xp.form', { ...DEFAULT, level: prefs.trainerLevel || DEFAULT.level });
  const f = { ...DEFAULT, ...stored };
  const patch = (x: Partial<XpForm>) => setForm((prev) => ({ ...DEFAULT, ...prev, ...x }));
  const xp = settings.xp;
  const maxLevel = xp.length;
  const levelOpts = Array.from({ length: maxLevel }, (_, i) => ({ id: i + 1, label: `Level ${i + 1}` }));

  // Normalise to total XP
  const total = f.mode === 'total'
    ? clamp(num(f.total), 0, xp[maxLevel - 1])
    : clamp(xp[clamp(f.level, 1, maxLevel) - 1] + num(f.into), 0, xp[maxLevel - 1]);
  const level = f.mode === 'total' ? trainerLevelFromXp(settings, total) : clamp(f.level, 1, maxLevel);
  const into = total - xp[level - 1];
  const nextReq = level < maxLevel ? xp[level] - xp[level - 1] : 0;
  const toNext = level < maxLevel ? xp[level] - total : 0;
  const target = clamp(Math.max(f.target, level + 1), 2, maxLevel);
  const toTarget = Math.max(0, xp[target - 1] - total);
  const perDay = num(f.perDay);
  const days = perDay > 0 ? Math.ceil(toTarget / perDay) : null;
  const eta = days !== null ? new Date(Date.now() + days * 86400000) : null;

  const eggBase = num(f.eggBase);
  const eggsToTarget = eggBase > 0 ? Math.ceil(toTarget / (eggBase * 2)) : null;

  // Merge level rewards that appear more than once for the same level (the data lists level 70 twice; keep the larger count)
  const rewards = useMemo(() => {
    const m = new Map<number, { items: Map<string, number>; unlocks: string[] }>();
    for (const r of settings.levelRewards) {
      const e: { items: Map<string, number>; unlocks: string[] } = m.get(r.level) ?? { items: new Map(), unlocks: [] };
      r.items.forEach((it) => e.items.set(it.name, Math.max(e.items.get(it.name) || 0, it.count)));
      r.unlocks.forEach((u) => { if (!e.unlocks.includes(u)) e.unlocks.push(u); });
      m.set(r.level, e);
    }
    return m;
  }, [settings.levelRewards]);
  const upcoming = Array.from({ length: Math.min(target, maxLevel) - level }, (_, i) => level + 1 + i).filter((l) => rewards.has(l));

  return (
    <div className="stack">
      <PageHeader title="XP & Leveling" subtitle={`Progress to your next trainer level and any target up to level ${maxLevel}, with Lucky Egg and daily-XP projections.`} />
      <div className="split">
        <div className="col sticky-side" style={{ gap: 16 }}>
          <Card>
            <div className="col" style={{ gap: 14 }}>
              <Segmented value={f.mode} onChange={(m) => patch(m === 'total' ? { mode: m, total: total } : { mode: m, level, into: into || '' })} options={[{ id: 'level', label: 'Level + XP' }, { id: 'total', label: 'Total XP' }]} />
              {f.mode === 'level' ? (
                <div className="fields">
                  <Field label="Current level"><Select value={level} onChange={(v) => patch({ level: v })} options={levelOpts} /></Field>
                  <Field label="XP into this level" hint={nextReq ? `of ${fmt(nextReq)}` : 'max level'}><NumberInput value={f.into} onChange={(v) => patch({ into: v })} min={0} max={nextReq || undefined} placeholder="0" /></Field>
                </div>
              ) : (
                <Field label="Total XP" hint="From your trainer profile"><NumberInput value={f.total} onChange={(v) => patch({ total: v })} min={0} placeholder="e.g. 5,400,000" /></Field>
              )}
              <Field label="Target level"><Select value={target} onChange={(v) => patch({ target: v })} options={levelOpts.filter((o) => o.id > level)} /></Field>
              <div className="row">
                {[40, 50, 60, 70, 80].filter((l) => l > level && l <= maxLevel).map((l) => <button key={l} className={`chip ${l === target ? 'on' : ''}`} onClick={() => patch({ target: l })}>L{l}</button>)}
              </div>
              <Field label="Your XP per day"><NumberInput value={f.perDay} onChange={(v) => patch({ perDay: v })} min={0} /></Field>
            </div>
          </Card>
          <p className="tool-note">Levels above 40 have also required completing Level-Up Research tasks; this calculator only counts XP.</p>
        </div>

        <div className="stack">
          <Card title={`Level ${level}${level < maxLevel ? ` → ${level + 1}` : ' (max)'}`}>
            <div className="stack">
              <div>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="small muted">{fmt(into)} / {fmt(nextReq)} XP</span>
                  <span className="small bold">{nextReq ? pct((into / nextReq) * 100) : '100%'}</span>
                </div>
                <div className="progress" style={{ marginTop: 6 }}><div style={{ width: `${nextReq ? (into / nextReq) * 100 : 100}%` }} /></div>
              </div>
              <div className="tool-tiles">
                <StatTile label="Total XP" value={fmt(total)} />
                <StatTile label="To next level" value={fmt(toNext)} />
                <StatTile label={`To level ${target}`} value={fmt(toTarget)} sub={`${pct((total / xp[target - 1]) * 100)} of the way`} />
                <StatTile label="Days at your pace" value={days === null ? '—' : fmt(days)} sub={eta ? eta.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'enter XP/day'} />
              </div>
              {days !== null && toTarget > 0 && <div className="callout small">At <b>{fmt(perDay)} XP/day</b> you reach level <b>{target}</b> in <b>{plural(days, 'day')}</b>{eta ? ` (around ${eta.toLocaleDateString()})` : ''}.</div>}
              <div>
                <div className="small muted" style={{ marginBottom: 6 }}>Progress to level {target}</div>
                <div className="progress"><div style={{ width: `${Math.min(100, (total / xp[target - 1]) * 100)}%`, background: 'var(--good)' }} /></div>
              </div>
            </div>
          </Card>

          <Card title="Lucky Egg calculator" footer={<span className="tool-note">A Lucky Egg doubles all XP earned for 30 minutes. Mass evolving is the classic use: ~60–90 evolutions × 500 XP × 2 per egg.</span>}>
            <div className="split" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.2fr)' }}>
              <div className="col">
                <Field label="Base XP you earn during one egg"><NumberInput value={f.eggBase} onChange={(v) => patch({ eggBase: v })} min={0} /></Field>
                <div className="row">
                  {[[15000, '15k (casual)'], [30000, '30k (60 evolutions)'], [45000, '45k (90 evolutions)']].map(([v, l]) => (
                    <button key={v} className={`chip ${eggBase === v ? 'on' : ''}`} onClick={() => patch({ eggBase: v as number })}>{l}</button>
                  ))}
                </div>
              </div>
              <div className="tool-tiles">
                <StatTile label="With Lucky Egg" value={fmt(eggBase * 2)} sub={`+${fmt(eggBase)} bonus`} />
                <StatTile label={`Eggs to level ${target}`} value={eggsToTarget === null ? '—' : fmt(eggsToTarget)} sub="if all XP came from eggs" />
              </div>
            </div>
          </Card>

          {upcoming.length > 0 && (
            <Card title={`Rewards: levels ${level + 1}–${target}`} flush>
              <div className="table-wrap" style={{ maxHeight: 420 }}>
                <table className="table compact">
                  <thead><tr><th className="num">Level</th><th>Items</th><th>Unlocks</th></tr></thead>
                  <tbody>
                    {upcoming.map((l) => { const r = rewards.get(l)!; return (
                      <tr key={l}>
                        <td className="num bold">{l}</td>
                        <td className="small">{[...r.items.entries()].map(([n, c]) => `${n} ×${fmt(c)}`).join(', ') || '—'}</td>
                        <td>{r.unlocks.length ? <div className="chips">{r.unlocks.map((u) => <span key={u} className="badge accent">{u}</span>)}</div> : <span className="muted">—</span>}</td>
                      </tr>
                    ); })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          <div className="grid grid-2" style={{ alignItems: 'start' }}>
            <Card title="XP sources" flush footer={<span className="tool-note">Approximate, community-known values — events often multiply these.</span>}>
              <div className="table-wrap">
                <table className="table compact">
                  <tbody>
                    {XP_SOURCES.map((g) => [
                      <tr key={g.group}><td colSpan={2} className="small bold" style={{ background: 'var(--surface-2)' }}>{g.group}</td></tr>,
                      ...g.rows.map(([a, b, c]) => <tr key={g.group + a}><td className="small">{a}{c && <div className="faint tiny">{c}</div>}</td><td className="num">{b}</td></tr>),
                    ])}
                    <tr><td colSpan={2} className="small bold" style={{ background: 'var(--surface-2)' }}>Friendship (game data)</td></tr>
                    {settings.friendship.filter((fr) => fr.level >= 1 && fr.level <= 4).map((fr) => (
                      <tr key={fr.level}><td className="small">Become {friendName(fr.level)} Friends</td><td className="num">{fmt(fr.xp)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
            <Card title="XP table" flush>
              <div className="table-wrap" style={{ maxHeight: 560 }}>
                <table className="table compact">
                  <thead><tr><th className="num">Level</th><th className="num">Total XP</th><th className="num">To next</th></tr></thead>
                  <tbody>
                    {xp.map((t, i) => (
                      <tr key={i} className={`clickable ${i + 1 === level ? 'sel' : ''} ${i + 1 === target ? 'sel' : ''}`} onClick={() => i + 1 > level && patch({ target: i + 1 })}>
                        <td className="num bold">{i + 1}</td>
                        <td className="num">{fmt(t)}</td>
                        <td className="num muted">{i + 1 < maxLevel ? fmt(xp[i + 1] - t) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
