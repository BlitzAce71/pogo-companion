import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, Empty, PageHeader, Segmented, Spinner, Switch, Types } from '../../components/ui';
import { displayName, useData } from '../../lib/data';
import { useLive, type LiveResearch, type Resolved } from '../../lib/live';
import { cpRange, ENCOUNTERS } from '../../lib/pogo';
import { useStored } from '../../lib/storage';
import { cpText, FeedStatus, LiveSprite, normCp, ShinyBadge, stripTags, useResolver } from './liveUtils';
import './live.css';

type Reward = LiveResearch['rewards'][number];

const CATEGORIES: { id: string; label: string; icon: string; re?: RegExp }[] = [
  { id: 'event', label: 'Event tasks', icon: '🎉' },
  { id: 'rocket', label: 'Team GO Rocket', icon: '🚀', re: /rocket|grunt|leader|giovanni|purif/i },
  { id: 'catch', label: 'Catching', icon: '🎯', re: /catch/i },
  { id: 'throw', label: 'Throwing', icon: '🌀', re: /throw|curveball/i },
  { id: 'battle', label: 'Battling', icon: '⚔️', re: /raid|battle|defeat|win |gym|charged attack|max battle/i },
  { id: 'explore', label: 'Exploring', icon: '🧭', re: /spin|explore|walk|hatch|egg|km|snapshot|pokéstop|route|power spot/i },
  { id: 'training', label: 'Training', icon: '💪', re: /power up|evolve|mega|use .* berr|berr/i },
  { id: 'buddy', label: 'Buddy & friends', icon: '🤝', re: /buddy|gift|trade|friend|sticker|candies/i },
  { id: 'other', label: 'Other', icon: '📋' },
];
const catMeta = (id: string) => CATEGORIES.find((c) => c.id === id) || { id, label: id[0].toUpperCase() + id.slice(1), icon: '📋' };

function categorize(text: string): string {
  for (const c of CATEGORIES) if (c.re?.test(text)) return c.id;
  return 'other';
}

/** Reward kind: Leek Duck marks rewards with `type` (encounter / item / …) in newer feeds; older ones are all encounters. */
function rewardKind(r: Reward, res: Resolved | null): 'encounter' | 'item' {
  if (r.type) return /encounter|pokemon/i.test(r.type) ? 'encounter' : 'item';
  return res || r.combatPower ? 'encounter' : 'item';
}

interface Task { text: string; cat: string; encounters: { r: Reward; res: Resolved | null }[]; items: Reward[] }

export default function Research() {
  const feed = useLive('research');
  const resolve = useResolver();
  const [q, setQ] = useState('');
  const [view, setView] = useStored<'tasks' | 'rewards'>('research.view', 'tasks');
  const [shinyOnly, setShinyOnly] = useState(false);
  const [cat, setCat] = useState<string>('all');

  const tasks = useMemo<Task[]>(() => {
    const list = feed.data || [];
    const anyTyped = list.some((t) => t.type);
    return list.map((t) => {
      const text = stripTags(t.text);
      const seen = new Set<string>();
      const encounters: Task['encounters'] = [];
      const items: Reward[] = [];
      for (const r of t.rewards || []) {
        const res = resolve(r.name, r.image);
        if (rewardKind(r, res) === 'item') { items.push(r); continue; }
        const k = r.name + '|' + r.image;
        if (seen.has(k)) continue;
        seen.add(k);
        encounters.push({ r, res });
      }
      return { text, cat: t.type || (anyTyped ? 'event' : categorize(text)), encounters, items };
    });
  }, [feed.data, resolve]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return tasks
      .filter((t) => cat === 'all' || t.cat === cat)
      .map((t) => ({ ...t, encounters: shinyOnly ? t.encounters.filter((e) => e.r.canBeShiny) : t.encounters }))
      .filter((t) => (!shinyOnly || t.encounters.length) && (!s || t.text.toLowerCase().includes(s) || t.encounters.some((e) => e.r.name.toLowerCase().includes(s) || e.res?.pokemon.types.includes(s as never)) || t.items.some((i) => i.name.toLowerCase().includes(s))));
  }, [tasks, q, shinyOnly, cat]);

  const catCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of tasks) m.set(t.cat, (m.get(t.cat) || 0) + 1);
    const order = CATEGORIES.map((c) => c.id);
    return [...m.entries()].sort((a, b) => (order.indexOf(a[0]) + 99) % 99 - (order.indexOf(b[0]) + 99) % 99);
  }, [tasks]);

  const shinyTotal = useMemo(() => new Set(tasks.flatMap((t) => t.encounters.filter((e) => e.r.canBeShiny).map((e) => e.r.name))).size, [tasks]);

  return (
    <div>
      <PageHeader title="Field Research" subtitle={tasks.length ? `${tasks.length} tasks from PokéStops · ${shinyTotal} shiny-eligible reward Pokémon.` : 'Current field research tasks and their rewards.'}
        actions={<FeedStatus {...feed} what="research" />} />

      <div className="page-tools">
        <input className="input" placeholder="Search tasks, rewards or types…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search research" />
        <Segmented value={view} onChange={setView} options={[{ id: 'tasks', label: 'By task' }, { id: 'rewards', label: 'By reward' }]} />
        <Switch checked={shinyOnly} onChange={setShinyOnly} label="✨ Shiny-eligible only" />
      </div>
      {catCounts.length > 1 && (
        <div className="chips" style={{ marginBottom: 16 }} role="group" aria-label="Task category">
          <button type="button" className={`chip ${cat === 'all' ? 'on' : ''}`} onClick={() => setCat('all')}>All <span className="faint">{tasks.length}</span></button>
          {catCounts.map(([c, n]) => <button key={c} type="button" className={`chip ${cat === c ? 'on' : ''}`} onClick={() => setCat(c)}>{catMeta(c).icon} {catMeta(c).label} <span className="faint">{n}</span></button>)}
        </div>
      )}

      {!feed.data && feed.loading && <Spinner label="Loading research…" />}
      {feed.data && !filtered.length && <Card><Empty icon="📋">{tasks.length ? 'No tasks match.' : 'No field research is listed right now.'}</Empty></Card>}

      {view === 'tasks' ? <ByTask tasks={filtered} /> : <ByReward tasks={filtered} />}

      {tasks.length > 0 && <p className="faint small" style={{ marginTop: 18 }}>Research encounters are level {ENCOUNTERS.research.level} with IVs of at least {ENCOUNTERS.research.minIv}/{ENCOUNTERS.research.minIv}/{ENCOUNTERS.research.minIv} — CP ranges above reflect that. Rewards rotate with events; refresh for the latest list.</p>}
    </div>
  );
}

function ByTask({ tasks }: { tasks: Task[] }) {
  const groups = useMemo(() => {
    const m = new Map<string, Task[]>();
    for (const t of tasks) { if (!m.has(t.cat)) m.set(t.cat, []); m.get(t.cat)!.push(t); }
    const order = CATEGORIES.map((c) => c.id);
    return [...m.entries()].sort((a, b) => (order.indexOf(a[0]) + 99) % 99 - (order.indexOf(b[0]) + 99) % 99);
  }, [tasks]);
  return (
    <div className="stack">
      {groups.map(([c, list]) => (
        <Card key={c} title={<span>{catMeta(c).icon} {catMeta(c).label} <span className="faint small">{list.length}</span></span>} flush>
          {list.map((t, i) => (
            <div key={t.text + i} className="task-row">
              <div className="task-text">{t.text}{t.encounters.some((e) => e.r.canBeShiny) && <ShinyBadge small />}</div>
              {t.encounters.length > 0 && <div className="reward-grid">{t.encounters.map((e) => <RewardTile key={e.r.name + e.r.image} r={e.r} res={e.res} />)}</div>}
              {t.items.length > 0 && <div className="row small" style={{ gap: 6 }}>{t.items.map((it, j) => <ItemReward key={j} r={it} />)}</div>}
            </div>
          ))}
        </Card>
      ))}
    </div>
  );
}

function ByReward({ tasks }: { tasks: Task[] }) {
  const rewards = useMemo(() => {
    const m = new Map<string, { r: Reward; res: Resolved | null; tasks: string[] }>();
    for (const t of tasks) for (const e of t.encounters) {
      const k = e.res ? e.res.pokemon.id + e.r.name : e.r.name;
      if (!m.has(k)) m.set(k, { ...e, tasks: [] });
      const v = m.get(k)!;
      if (!v.tasks.includes(t.text)) v.tasks.push(t.text);
    }
    return [...m.values()].sort((a, b) => Number(!!b.r.canBeShiny) - Number(!!a.r.canBeShiny) || (a.res?.pokemon.dex ?? 9999) - (b.res?.pokemon.dex ?? 9999));
  }, [tasks]);
  const items = tasks.flatMap((t) => t.items.map((i) => ({ i, text: t.text })));
  return (
    <div className="stack">
      <Card title={`Encounters (${rewards.length})`}>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
          {rewards.map((x) => (
            <div key={x.r.name + x.r.image} className="tile col" style={{ gap: 6 }}>
              <RewardTile r={x.r} res={x.res} bare />
              <ul className="list-plain tiny muted">{x.tasks.map((t) => <li key={t} style={{ padding: '2px 0' }}>{t}</li>)}</ul>
            </div>
          ))}
        </div>
      </Card>
      {items.length > 0 && (
        <Card title={`Items & resources (${items.length})`} flush>
          {items.map(({ i, text }, k) => <div key={k} className="task-row"><div className="task-text">{text}</div><ItemReward r={i} /></div>)}
        </Card>
      )}
    </div>
  );
}

function RewardTile({ r, res, bare }: { r: Reward; res: Resolved | null; bare?: boolean }) {
  const { settings } = useData();
  const feedCp = normCp(r.combatPower).normal;
  const cp = feedCp || (res ? cpRange(res.pokemon, settings, ENCOUNTERS.research.level, ENCOUNTERS.research.minIv) : undefined);
  const inner = (
    <>
      <LiveSprite image={r.image} p={res?.pokemon} size={40} />
      <span className="info">
        <span className="nm">{res && /^\w+ \d+$/.test(r.name) ? `${displayName(res.pokemon)} (${r.name.split(' ').pop()})` : r.name}</span>
        <span className="sub num">CP {cpText(cp)}</span>
        {res && <Types types={res.pokemon.types} small />}
      </span>
      {r.canBeShiny && <span style={{ marginLeft: 'auto' }} title="Shiny available">✨</span>}
    </>
  );
  const style = bare ? { background: 'transparent', border: 0, padding: 0 } : undefined;
  return res ? <Link to={`/dex/${res.pokemon.id}`} className="reward-tile" style={style}>{inner}</Link> : <div className="reward-tile" style={style}>{inner}</div>;
}

function ItemReward({ r }: { r: Reward }) {
  return (
    <span className="ev-mon">
      {r.image && <img src={r.image} width={22} height={22} alt="" loading="lazy" />}
      {r.quantity ? `${r.quantity.toLocaleString()} × ` : ''}{r.name}
    </span>
  );
}
