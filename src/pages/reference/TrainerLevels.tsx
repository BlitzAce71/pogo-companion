import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, NumberInput, PageHeader, Segmented, StatTile, Switch } from '../../components/ui';
import { useData } from '../../lib/data';
import { fmt, titleCase } from '../../lib/format';
import { trainerLevelFromXp } from '../../lib/pogo';
import { usePrefs, useStored } from '../../lib/storage';
import type { Settings } from '../../lib/types';
import './reference.css';

// ---------------------------------------------------------------- reward helpers
interface Reward { name: string; count: number; kind: 'item' | 'storage' | 'special' }
interface LevelRow { level: number; total: number; toNext: number | null; gain: number; rewards: Reward[]; unlocks: string[] }

const STORAGE: Record<string, string> = {
  'Item Storage Upgrade Earned': 'Bag space',
  'Pokemon Storage Upgrade Earned': 'Pokémon storage',
  'Giftbox Storage Upgrade Earned': 'Gift storage',
  'Postcard Storage Upgrade Earned': 'Postcard space',
};
const SPECIAL = new Set(['Master Ball', 'Elite Fast TM', 'Elite Charged TM', 'Rare Candy XL', 'Premium Battle Pass', 'Max Particle Pack', 'Max Mushroom', 'Super Incubator']);
const UNLOCKS: Record<string, string> = {
  'Egg Hatching': 'Egg hatching',
  Gym: 'Gyms',
  Raid: 'Raids',
  Routes: 'Routes',
  Rocket: 'Team GO Rocket battles',
  'Combat League': 'GO Battle League',
  Trade: 'Trading',
  'Weekly Challenges': 'Weekly challenges',
  Mega: 'Mega Evolution',
  'Max Battle': 'Max Battles',
  'Party Play': 'Party Play',
  'Routes Creation': 'Route creation',
  'Candy Xl': 'Candy XL',
  'Pokestop Nomination': 'PokéStop nominations',
  'Lucky Chance Increase': 'Higher Lucky trade chance',
};
const prettyName = (n: string) => n.replace(/\bPokemon\b/g, 'Pokémon');

function buildRows(settings: Settings): LevelRow[] {
  const byLevel = new Map<number, { rewards: Map<string, Reward>; unlocks: Set<string> }>();
  for (const r of settings.levelRewards) {
    if (!byLevel.has(r.level)) byLevel.set(r.level, { rewards: new Map(), unlocks: new Set() });
    const e = byLevel.get(r.level)!;
    // Some levels appear twice in the game master (storage upgrades repeated) — de-duplicate by name.
    for (const it of r.items) {
      if (e.rewards.has(it.name)) continue;
      const storage = STORAGE[it.name];
      e.rewards.set(it.name, { name: storage ?? prettyName(it.name), count: it.count, kind: storage ? 'storage' : SPECIAL.has(it.name) ? 'special' : 'item' });
    }
    for (const u of r.unlocks) e.unlocks.add(UNLOCKS[u] ?? titleCase(u));
  }
  return settings.xp.map((total, i) => {
    const level = i + 1;
    const e = byLevel.get(level);
    const rewards = e ? [...e.rewards.values()].sort((a, b) => (a.kind === 'storage' ? 1 : 0) - (b.kind === 'storage' ? 1 : 0)) : [];
    return { level, total, toNext: i + 1 < settings.xp.length ? settings.xp[i + 1] - total : null, gain: i ? total - settings.xp[i - 1] : 0, rewards, unlocks: e ? [...e.unlocks] : [] };
  });
}

const short = (n: number) => (n >= 1e6 ? `${Number((n / 1e6).toFixed(n >= 1e7 ? 0 : 1))}M` : n >= 1e3 ? `${Number((n / 1e3).toFixed(0))}k` : String(n));
const isMilestone = (r: LevelRow) => r.level % 5 === 0 || r.unlocks.length > 0;

// ---------------------------------------------------------------- chart
function XpChart({ rows, mode, log, mine, cap, onPick }: { rows: LevelRow[]; mode: 'per' | 'total'; log: boolean; mine: number | null; cap: number; onPick: (l: number) => void }) {
  const W = 820, H = 240, L = 52, R = 10, T = 14, B = 26;
  const n = rows.length;
  const vals = rows.map((r) => (mode === 'per' ? r.gain : r.total));
  const max = Math.max(...vals, 1);
  const minPos = log ? Math.max(1, Math.min(...vals.filter((v) => v > 0))) : 0;
  const y = (v: number) => {
    if (v <= 0) return H - B;
    const f = log ? (Math.log10(v) - Math.log10(minPos)) / (Math.log10(max) - Math.log10(minPos) || 1) : v / max;
    return H - B - Math.max(0, f) * (H - B - T);
  };
  const bw = (W - L - R) / n;
  const x = (i: number) => L + i * bw;
  const ticks = log
    ? Array.from({ length: 12 }, (_, i) => 10 ** i).filter((v) => v >= minPos && v <= max)
    : [0.25, 0.5, 0.75, 1].map((f) => max * f);
  const linePts = rows.map((r, i) => `${x(i) + bw / 2},${y(vals[i])}`).join(' ');
  return (
    <svg className="ref-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={mode === 'per' ? 'XP required for each level' : 'Total XP by level'}>
      {ticks.map((v) => (
        <g key={v}>
          <line className="grid-line" x1={L} x2={W - R} y1={y(v)} y2={y(v)} />
          <text className="axis-label" x={L - 6} y={y(v) + 4} textAnchor="end">{short(Math.round(v))}</text>
        </g>
      ))}
      <line className="grid-line" x1={L} x2={W - R} y1={H - B} y2={H - B} />
      {rows.map((r, i) => (r.level === 1 || r.level % 10 === 0) && (
        <text key={r.level} className="axis-label" x={x(i) + bw / 2} y={H - 8} textAnchor="middle">{r.level}</text>
      ))}
      {mode === 'per' ? rows.map((r, i) => i > 0 && (
        <rect key={r.level} className={`bar ${r.level === mine ? 'mine' : r.level % 10 === 0 ? 'ms' : ''} ${r.level > cap ? 'cap' : ''}`}
          x={x(i) + bw * 0.12} width={bw * 0.76} y={y(vals[i])} height={Math.max(0, H - B - y(vals[i]))} onClick={() => onPick(r.level)}>
          <title>{`Level ${r.level}: ${fmt(r.gain)} XP from level ${r.level - 1} · ${fmt(r.total)} total`}</title>
        </rect>
      )) : (
        <>
          <polygon className="area" points={`${x(0) + bw / 2},${H - B} ${linePts} ${x(n - 1) + bw / 2},${H - B}`} />
          <polyline className="line" points={linePts} />
          {rows.map((r, i) => (
            <rect key={r.level} x={x(i)} width={bw} y={T} height={H - B - T} fill="transparent" style={{ cursor: 'pointer' }} onClick={() => onPick(r.level)}>
              <title>{`Level ${r.level}: ${fmt(r.total)} total XP`}</title>
            </rect>
          ))}
        </>
      )}
      {cap < n && (
        <g>
          <line className="cap-line" x1={x(cap)} x2={x(cap)} y1={T} y2={H - B} />
          <text className="cap-label" x={x(cap) + 4} y={T + 10}>cap {cap}</text>
        </g>
      )}
      {mine !== null && (
        <g>
          <line className="marker" x1={x(mine - 1) + bw / 2} x2={x(mine - 1) + bw / 2} y1={T} y2={H - B} />
          <text className="marker-label" x={x(mine - 1) + bw / 2 + (mine > n * 0.8 ? -4 : 4)} y={T + 24} textAnchor={mine > n * 0.8 ? 'end' : 'start'}>You · {mine}</text>
        </g>
      )}
    </svg>
  );
}

// ---------------------------------------------------------------- page
export default function TrainerLevels() {
  const { settings } = useData();
  const [prefs, setPrefs] = usePrefs();
  const [xp, setXp] = useStored<number | ''>('trainer.xp', '');
  const [mode, setMode] = useState<'per' | 'total'>('per');
  const [log, setLog] = useState(false);
  const [filter, setFilter] = useState<'all' | 'milestones' | 'unlocks'>('all');
  const [range, setRange] = useState<'all' | '1' | '21' | '41' | '51'>('all');
  const [picked, setPicked] = useState<number | null>(null);

  const rows = useMemo(() => buildRows(settings), [settings]);
  const maxLevel = rows.length;
  const cap = Math.min(settings.levelCap || maxLevel, maxLevel);
  const xpLevel = xp === '' ? null : trainerLevelFromXp(settings, xp);
  const mine = xpLevel ?? (prefs.trainerLevel >= 1 && prefs.trainerLevel <= maxLevel ? prefs.trainerLevel : null);
  const cur = mine ? rows[mine - 1] : null;
  const next = mine && mine < maxLevel ? rows[mine] : null;
  const inLevel = xp !== '' && cur && next ? xp - cur.total : null;
  const xpCumMax = rows[rows.length - 1].total;

  const ranges = { all: [1, maxLevel], '1': [1, 20], '21': [21, 40], '41': [41, 50], '51': [51, maxLevel] } as const;
  const shown = rows.filter((r) => {
    const [lo, hi] = ranges[range];
    if (r.level < lo || r.level > hi) return false;
    if (filter === 'milestones') return isMilestone(r);
    if (filter === 'unlocks') return r.unlocks.length > 0;
    return true;
  });

  const pick = (l: number) => {
    setPicked(l);
    setRange('all');
    setFilter('all');
    requestAnimationFrame(() => document.getElementById(`lvl-${l}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  };

  const goals = [40, 50, cap, maxLevel].filter((g, i, a) => g <= maxLevel && a.indexOf(g) === i && (!mine || g > mine));

  return (
    <div className="stack">
      <PageHeader
        title="Trainer Levels"
        subtitle={`XP required and rewards for all ${maxLevel} trainer levels, from the game master. Enter your total XP to see where you stand.`}
        actions={<Link className="btn" to="/tools/xp">⭐ XP Calculator</Link>}
      />

      <div className="grid grid-2">
        <Card title="My progress" className="ref-xp-card">
          <div className="stack-sm">
            <div className="row" style={{ gap: 12, alignItems: 'flex-end' }}>
              <div className="field" style={{ flex: '1 1 200px' }}>
                <label>My total XP</label>
                <NumberInput value={xp} onChange={(v) => setXp(v === '' ? '' : Math.max(0, Math.floor(v)))} min={0} placeholder="e.g. 5,300,000 (Me → Total XP)" />
              </div>
              {xp !== '' && <button className="btn ghost sm" onClick={() => setXp('')}>Clear</button>}
            </div>
            {mine ? (
              <>
                <div className="row" style={{ gap: 16, alignItems: 'baseline' }}>
                  <span className="big">Lv {mine}</span>
                  <span className="muted small">{xpLevel ? 'from your XP' : 'from your preferences'}{xpLevel && prefs.trainerLevel !== xpLevel && <> · <button className="btn ghost sm" onClick={() => setPrefs({ trainerLevel: xpLevel })}>Save Lv {xpLevel} to preferences</button></>}</span>
                </div>
                {next && inLevel !== null && cur?.toNext ? (
                  <>
                    <div className="progress"><div style={{ width: `${Math.min(100, (inLevel / cur.toNext) * 100)}%` }} /></div>
                    <div className="row small muted" style={{ justifyContent: 'space-between' }}>
                      <span>{fmt(inLevel)} / {fmt(cur.toNext)} XP into level {mine}</span>
                      <span><b className="bold" style={{ color: 'var(--text)' }}>{fmt(next.total - (xp as number))}</b> XP to level {next.level}</span>
                    </div>
                  </>
                ) : !next ? <div className="callout good">Maximum level reached in the game data. 🎉</div> : null}
                {xp !== '' && goals.length > 0 && (
                  <div className="kv" style={{ marginTop: 6 }}>
                    {goals.map((g) => <span key={g} style={{ display: 'contents' }}><span>To level {g}</span><span className="num">{fmt(Math.max(0, rows[g - 1].total - xp))} XP</span></span>)}
                  </div>
                )}
                {mine >= 40 && next && <p className="small faint" style={{ marginTop: 6, marginBottom: 0 }}>XP alone isn't enough here: the next level also needs Level-Up Research tasks (see note below).</p>}
              </>
            ) : <p className="muted">Enter your XP (or set your trainer level in <Link to="/settings">Settings</Link>) to highlight your level.</p>}
          </div>
        </Card>

        <div className="grid grid-2" style={{ alignContent: 'start' }}>
          <StatTile label="Level 40" value={short(rows[39]?.total ?? 0)} sub={`${fmt(rows[39]?.total ?? 0)} XP`} />
          <StatTile label="Level 50" value={short(rows[49]?.total ?? 0)} sub={`${fmt(rows[49]?.total ?? 0)} XP`} />
          <StatTile label={`Level ${maxLevel}`} value={short(xpCumMax)} sub={`${fmt(xpCumMax)} XP`} />
          <StatTile label="Biggest single level" value={short(Math.max(...rows.map((r) => r.gain)))} sub={`level ${rows.reduce((a, b) => (b.gain > a.gain ? b : a)).level}`} />
        </div>
      </div>

      <div className="callout warn">
        <b>Level-Up Research.</b> Higher trainer levels, notably 41 and above, also need a set of Level-Up Research tasks on top of the XP shown here. The tasks have changed over time and vary by season, and they aren't in the game data.
        {cap < maxLevel && <> The game data defines XP for {maxLevel} levels and lists a current level cap of {cap}; levels above the cap are dimmed.</>}
      </div>

      <Card
        title={mode === 'per' ? 'XP needed for each level' : 'Total XP by level'}
        actions={
          <div className="row" style={{ gap: 10 }}>
            <Switch checked={log} onChange={setLog} label="Log scale" />
            <Segmented size="sm" value={mode} onChange={setMode} options={[{ id: 'per', label: 'Per level' }, { id: 'total', label: 'Total' }]} />
          </div>
        }
        footer="Click a bar to jump to that level in the table. Gold bars mark every 10th level."
      >
        <XpChart rows={rows} mode={mode} log={log} mine={mine} cap={cap} onPick={pick} />
      </Card>

      <Card
        title="All levels"
        flush
        actions={
          <div className="row" style={{ gap: 8 }}>
            <Segmented size="sm" value={range} onChange={setRange} options={[{ id: 'all', label: 'All' }, { id: '1', label: '1–20' }, { id: '21', label: '21–40' }, { id: '41', label: '41–50' }, ...(maxLevel > 50 ? [{ id: '51' as const, label: `51–${maxLevel}` }] : [])]} />
            <Segmented size="sm" value={filter} onChange={setFilter} options={[{ id: 'all', label: 'Every level' }, { id: 'milestones', label: 'Milestones' }, { id: 'unlocks', label: 'Unlocks' }]} />
          </div>
        }
        footer="Rewards are listed per level from the game master. Storage upgrades are shown with dashed outlines. Milestones are every 5th level and any level that unlocks a feature."
      >
        <div className="table-wrap">
          <table className="table ref-levels">
            <thead>
              <tr><th>Level</th><th className="num">Total XP</th><th className="num">XP to next</th><th className="rew-col">Rewards</th><th>Unlocks</th></tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.level} id={`lvl-${r.level}`} className={`${r.level === mine ? 'mine' : isMilestone(r) ? 'ms' : ''} ${picked === r.level ? 'sel' : ''} ${r.level > cap ? 'cap' : ''}`}>
                  <td>
                    <span className="ref-lvl">{r.level}</span>
                    {r.level >= 41 && <div className="tiny faint" style={{ marginTop: 3 }} title="Requires Level-Up Research tasks">+ tasks</div>}
                  </td>
                  <td className="num">{fmt(r.total)}</td>
                  <td className="num">{r.toNext === null ? <span className="faint">—</span> : fmt(r.toNext)}</td>
                  <td className="rew-col">
                    {r.rewards.length ? (
                      <div className="ref-rewards">
                        {r.rewards.map((it) => (
                          <span key={it.name} className={`ref-reward ${it.kind}`}>
                            {it.kind === 'storage' ? <><b>+{fmt(it.count)}</b> {it.name}</> : <>{it.name} <b>×{fmt(it.count)}</b></>}
                          </span>
                        ))}
                      </div>
                    ) : <span className="faint">—</span>}
                  </td>
                  <td>{r.unlocks.length ? <div className="ref-rewards">{r.unlocks.map((u) => <span key={u} className="ref-unlock">{u}</span>)}</div> : <span className="faint">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
