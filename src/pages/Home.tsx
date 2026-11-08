import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, Countdown, PokeImg, Segmented, Spinner, Types, useNow } from '../components/ui';
import { useData } from '../lib/data';
import { dateRange, fmt, timeAgo } from '../lib/format';
import { EVENT_TYPE_LABEL, eventDate, eventStatus, resolveLiveName, useLive, type LiveEvent } from '../lib/live';
import { weatherTypes, WEATHERS } from '../lib/pogo';
import { DEX_FLAGS, useCollection, useMyPokemon, usePrefs, useStored } from '../lib/storage';
import './home.css';

const QUICK = [
  { to: '/counters', icon: '🛡️', label: 'Raid counters', sub: 'Best attackers for any boss' },
  { to: '/tools/iv', icon: '🧮', label: 'IV calculator', sub: 'From CP, HP & appraisal' },
  { to: '/pvp/ivs', icon: '📊', label: 'PvP IV ranker', sub: 'Rank-1 IVs per league' },
  { to: '/pvp', icon: '🏆', label: 'PvP rankings', sub: 'Great / Ultra / Master meta' },
  { to: '/tools/search', icon: '🔎', label: 'Search strings', sub: 'Build in-game filters' },
  { to: '/types', icon: '🎯', label: 'Type chart', sub: 'Weaknesses at a glance' },
  { to: '/pvp/sim', icon: '🥊', label: 'Battle simulator', sub: '1v1 matchups & shields' },
  { to: '/tools/powerup', icon: '⬆️', label: 'Power-up cost', sub: 'Stardust, candy & XL' },
];

export default function Home() {
  const data = useData();
  const now = useNow(30_000);
  const events = useLive('events');
  const raids = useLive('raids');
  const [prefs] = usePrefs();
  const greeting = useMemo(() => { const h = new Date(now).getHours(); return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; }, [now]);
  useEffect(() => { document.title = 'Today · PoGo Companion'; }, []);

  const { live, upcoming } = useMemo(() => {
    const list = (events.data || []).filter((e) => e.eventType !== 'season' || eventStatus(e, now) === 'live');
    const live = list.filter((e) => eventStatus(e, now) === 'live').sort((a, b) => (eventDate(a.end)?.getTime() ?? Infinity) - (eventDate(b.end)?.getTime() ?? Infinity));
    const upcoming = list.filter((e) => eventStatus(e, now) === 'upcoming').sort((a, b) => (eventDate(a.start)?.getTime() ?? 0) - (eventDate(b.start)?.getTime() ?? 0));
    return { live, upcoming };
  }, [events.data, now]);

  const highlight = useMemo(() => {
    const pick = (t: string) => [...live, ...upcoming].find((e) => e.eventType === t);
    return [pick('community-day'), pick('pokemon-spotlight-hour'), pick('raid-hour'), pick('max-mondays')].filter(Boolean) as LiveEvent[];
  }, [live, upcoming]);

  const raidGroups = useMemo(() => {
    const g: Record<string, typeof raids.data> = {};
    for (const r of raids.data || []) (g[r.tier] ||= []).push(r);
    return Object.entries(g).sort((a, b) => tierOrder(b[0]) - tierOrder(a[0]));
  }, [raids.data]);

  return (
    <div className="stack">
      <div className="home-hero">
        <div>
          <div className="faint small">{new Date(now).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</div>
          <h1>{greeting}, Trainer{prefs.team !== 'none' ? <span className={`team-dot team-${prefs.team}`} title={prefs.team} /> : null}</h1>
          <p className="muted">Here’s what’s happening in Pokémon GO right now.</p>
        </div>
        <div className="row small faint" style={{ gap: 8 }}>
          {events.source === 'snapshot' ? <span className="badge warn" title="Couldn't reach the live feed; showing data bundled with the app">Offline snapshot</span> : events.at ? <span>Updated {timeAgo(events.at)}</span> : null}
          <button className="btn sm" onClick={() => { events.refresh(); raids.refresh(); }} disabled={events.loading}>↻ Refresh</button>
        </div>
      </div>

      {highlight.length > 0 && (
        <div className="grid grid-auto">
          {highlight.map((e) => <Highlight key={e.eventID} e={e} now={now} />)}
        </div>
      )}

      <div className="home-cols">
        <div className="stack">
          <Card title={<>Live now <span className="badge live" style={{ marginLeft: 6 }}>{live.length}</span></>} actions={<Link to="/events" className="btn sm ghost">All events →</Link>} flush>
            {events.loading && !events.data ? <Spinner /> : live.length === 0 ? <div className="empty">No events running right now.</div> : (
              <ul className="list-plain">{live.map((e) => <EventRow key={e.eventID} e={e} live />)}</ul>
            )}
          </Card>
          <Card title="Coming up" actions={<Link to="/events" className="btn sm ghost">Calendar →</Link>} flush>
            {upcoming.length === 0 ? <div className="empty">Nothing announced yet.</div> : <ul className="list-plain">{upcoming.slice(0, 8).map((e) => <EventRow key={e.eventID} e={e} />)}</ul>}
          </Card>
        </div>

        <div className="stack">
          <Card title="Raid bosses" actions={<Link to="/raids" className="btn sm ghost">Details →</Link>}>
            {raids.loading && !raids.data ? <Spinner /> : raidGroups.length === 0 ? <div className="faint">No raid data.</div> : (
              <div className="col" style={{ gap: 12 }}>
                {raidGroups.map(([tier, list]) => (
                  <div key={tier}>
                    <div className="field-label" style={{ marginBottom: 6 }}>{tier}</div>
                    <div className="raid-strip">
                      {list!.map((r) => {
                        const res = resolveLiveName(data, r.name, r.image);
                        const to = res ? `/counters?boss=${res.pokemon.id}${res.shadow ? '&tier=shadow' + (tier.match(/\d/)?.[0] || '5') : ''}` : '/raids';
                        return (
                          <Link key={r.name} to={to} className="raid-chip" title={`Counters for ${r.name}`}>
                            {res ? <PokeImg p={res.pokemon} size={44} /> : <img src={r.image} width={44} height={44} alt="" />}
                            <span className="small bold" style={{ lineHeight: 1.15 }}>{r.name}</span>
                            {r.canBeShiny && <span className="tiny warn">✦ shiny</span>}
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
          <WeatherCard />
          <ProgressCard />
        </div>
      </div>

      <Card title="Quick tools">
        <div className="grid grid-4" style={{ gap: 10 }}>
          {QUICK.map((q) => (
            <Link key={q.to} to={q.to} className="tile quick">
              <span className="quick-ico">{q.icon}</span>
              <span><b>{q.label}</b><br /><span className="small faint">{q.sub}</span></span>
            </Link>
          ))}
        </div>
      </Card>
      <div className="small faint center">{fmt(data.pokemon.filter((p) => p.released).length)} Pokémon · {fmt(Object.keys(data.moves).length)} moves · game data built {new Date(data.settings.generatedAt).toLocaleString()}</div>
    </div>
  );
}

function tierOrder(t: string) {
  if (/mega/i.test(t)) return 6.5;
  const n = Number(t.match(/\d/)?.[0] || 0);
  return (/shadow/i.test(t) ? 0.5 : 0) + n;
}

function EventRow({ e, live }: { e: LiveEvent; live?: boolean }) {
  const start = eventDate(e.start), end = eventDate(e.end);
  return (
    <li>
      <a href={e.link} target="_blank" rel="noreferrer" className="event-row">
        <img src={e.image} alt="" loading="lazy" />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="bold ellipsis">{e.name}</div>
          <div className="small faint">{EVENT_TYPE_LABEL[e.eventType] || e.heading} · {dateRange(start, end)}</div>
        </div>
        <div className="small nowrap right">
          {live ? (end ? <><span className="faint">ends in</span><br /><b><Countdown to={end} /></b></> : null)
            : start ? <><span className="faint">starts in</span><br /><b><Countdown to={start} /></b></> : null}
        </div>
      </a>
    </li>
  );
}

function Highlight({ e, now }: { e: LiveEvent; now: number }) {
  const data = useData();
  const st = eventStatus(e, now);
  const start = eventDate(e.start), end = eventDate(e.end);
  const mons = e.extraData?.spotlight?.list || e.extraData?.communityday?.spawns || e.extraData?.raidbattles?.bosses || [];
  return (
    <a className="card highlight" href={e.link} target="_blank" rel="noreferrer" style={{ backgroundImage: `linear-gradient(90deg, var(--surface) 35%, color-mix(in srgb, var(--surface) 55%, transparent)), url(${e.image})` }}>
      <div className="row" style={{ gap: 6 }}>
        <span className="badge accent">{EVENT_TYPE_LABEL[e.eventType] || e.heading}</span>
        {st === 'live' ? <span className="badge live">LIVE</span> : null}
      </div>
      <div className="bold" style={{ fontSize: '1.05rem', marginTop: 6 }}>{e.name}</div>
      <div className="small muted">{dateRange(start, end)}</div>
      {e.extraData?.spotlight?.bonus && <div className="small" style={{ marginTop: 4 }}>Bonus: <b>{e.extraData.spotlight.bonus}</b></div>}
      <div className="row" style={{ marginTop: 8, gap: 4 }}>
        {mons.slice(0, 6).map((m) => { const r = resolveLiveName(data, m.name, m.image); return r ? <PokeImg key={m.name} p={r.pokemon} size={40} /> : <img key={m.name} src={m.image} width={40} height={40} alt={m.name} />; })}
        <span className="spacer" />
        <b className="small">{st === 'live' ? <>ends in <Countdown to={end!} /></> : start ? <>in <Countdown to={start} /></> : null}</b>
      </div>
    </a>
  );
}

function WeatherCard() {
  const { settings } = useData();
  const [w, setW] = useStored<string>('home.weather', 'clear');
  const [show, setShow] = useState(false);
  const types = weatherTypes(settings, w);
  const cur = WEATHERS.find((x) => x.id === w) || WEATHERS[0];
  return (
    <Card title="Weather boost" actions={<button className="btn sm ghost" onClick={() => setShow((s) => !s)}>{cur.icon} {cur.name} ▾</button>}>
      {show && <div style={{ marginBottom: 10 }}><Segmented size="sm" value={w} onChange={(v) => { setW(v); setShow(false); }} options={WEATHERS.map((x) => ({ id: x.id, label: `${x.icon}` }))} /></div>}
      <div className="row" style={{ gap: 6 }}><Types types={types} small /></div>
      <div className="small faint" style={{ marginTop: 8 }}>Boosted spawns are +{settings.weatherBonus.level} levels with IVs ≥ {settings.weatherBonus.minIv}; boosted moves deal ×{settings.weatherBonus.attack} damage. <Link to="/ref/weather">More</Link></div>
    </Card>
  );
}

function ProgressCard() {
  const data = useData();
  const { collection } = useCollection();
  const { mons } = useMyPokemon();
  const total = useMemo(() => data.pokemon.filter((p) => p.released && !p.megaOf).length, [data.pokemon]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const [id, e] of Object.entries(collection)) { const p = data.byId[id]; if (!p || p.megaOf) continue; for (const k of Object.keys(e)) c[k] = (c[k] || 0) + 1; }
    return c;
  }, [collection, data.byId]);
  const any = Object.keys(counts).length > 0 || mons.length > 0;
  return (
    <Card title="My collection" actions={<Link to="/collection" className="btn sm ghost">Open →</Link>}>
      {!any ? <div className="small muted">Track your caught, shiny, lucky and hundo Pokémon in <Link to="/collection">My Dex</Link>, and save individual Pokémon from the <Link to="/tools/iv">IV calculator</Link>.</div> : (
        <div className="col" style={{ gap: 8 }}>
          {DEX_FLAGS.filter((f) => ['caught', 'shiny', 'lucky', 'hundo'].includes(f.key)).map((f) => (
            <div key={f.key}>
              <div className="row small"><span style={{ flex: 1 }}>{f.label}</span><span className="num faint">{counts[f.key] || 0} / {total}</span></div>
              <div className="progress"><div style={{ width: `${((counts[f.key] || 0) / total) * 100}%`, background: f.color }} /></div>
            </div>
          ))}
          {mons.length > 0 && <div className="small faint">{mons.length} saved Pokémon in <Link to="/collection/mons">My Pokémon</Link></div>}
        </div>
      )}
    </Card>
  );
}

