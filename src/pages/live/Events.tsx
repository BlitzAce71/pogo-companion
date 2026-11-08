import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Card, Countdown, Empty, PageHeader, Segmented, Spinner, copyText, useNow, useShowMore, useToast } from '../../components/ui';
import { dateRange, duration, timeAgo } from '../../lib/format';
import { EVENT_TYPE_LABEL, eventDate, eventStatus, useLive, type LiveEvent, type LiveMon, type Resolved } from '../../lib/live';
import { defaultTier, RAID_TIERS, type RaidTier } from '../../lib/pve';
import { useStored } from '../../lib/storage';
import { countersLink } from '../battle/counterUtils';
import { FeedStatus, LiveSprite, useResolver } from './liveUtils';
import './live.css';

const DAY = 86_400_000;

const typeLabel = (t: string) => EVENT_TYPE_LABEL[t] || t.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
function typeColor(t: string) {
  if (t === 'community-day') return 'var(--good)';
  if (t.includes('spotlight')) return 'var(--warn)';
  if (t.includes('raid') || t === 'elite-raids') return 'var(--bad)';
  if (t.startsWith('max')) return '#e93d82';
  if (t.includes('battle-league')) return 'var(--purple)';
  if (t.includes('research')) return '#12a594';
  if (t.includes('rocket')) return '#8e4ec6';
  return 'var(--accent)';
}
/** Leek Duck dates without a zone suffix are local time everywhere. */
const isLocalTime = (s: string | null) => !!s && !/(Z|[+-]\d\d:?\d\d)$/.test(s);

export default function Events() {
  const feed = useLive('events');
  const now = useNow(30_000);
  const [view, setView] = useStored<'list' | 'agenda'>('events.view', 'list');
  const [filter, setFilter] = useState<string[]>([]);

  const all = useMemo(() => feed.data || [], [feed.data]);
  const typeCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of all) m.set(e.eventType, (m.get(e.eventType) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [all]);
  const events = useMemo(() => (filter.length ? all.filter((e) => filter.includes(e.eventType)) : all), [all, filter]);
  // Only re-bucket when some event actually changes status (keeps “show more” state stable between ticks).
  const statusSig = events.map((e) => eventStatus(e, now)[0]).join('');

  const sections = useMemo(() => {
    const live: LiveEvent[] = [], upcoming: LiveEvent[] = [], ended: LiveEvent[] = [], tba: LiveEvent[] = [];
    for (const e of events) {
      if (!e.start && !e.end) { tba.push(e); continue; }
      const s = eventStatus(e, now);
      (s === 'live' ? live : s === 'upcoming' ? upcoming : ended).push(e);
    }
    const t = (s: string | null, fb: number) => eventDate(s)?.getTime() ?? fb;
    live.sort((a, b) => t(a.end, Infinity) - t(b.end, Infinity));
    upcoming.sort((a, b) => t(a.start, 0) - t(b.start, 0));
    ended.sort((a, b) => t(b.end, 0) - t(a.end, 0));
    return { live, upcoming, ended, tba };
  }, [events, statusSig]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (t: string) => setFilter((f) => (f.includes(t) ? f.filter((x) => x !== t) : [...f, t]));

  return (
    <div>
      <PageHeader title="Events" subtitle={all.length ? `${sections.live.length} live now · ${sections.upcoming.length} upcoming. Community Days, Spotlight Hours, raid rotations, Max Mondays, GO Battle League and more.` : 'Community Days, Spotlight Hours, raid rotations and everything else happening in Pokémon GO.'}
        actions={<>
          <Segmented value={view} onChange={setView} options={[{ id: 'list', label: '▦ Cards' }, { id: 'agenda', label: '🗓 Agenda' }]} />
          <FeedStatus {...feed} what="events" />
        </>} />

      {typeCounts.length > 1 && (
        <div className="chips" style={{ marginBottom: 16 }} role="group" aria-label="Filter by event type">
          <button type="button" className={`chip ${filter.length === 0 ? 'on' : ''}`} onClick={() => setFilter([])}>All <span className="faint">{all.length}</span></button>
          {typeCounts.map(([t, n]) => (
            <button key={t} type="button" className={`chip ${filter.includes(t) ? 'on' : ''}`} aria-pressed={filter.includes(t)} onClick={() => toggle(t)}>
              <span className="ev-type-dot" style={{ background: typeColor(t) }} />{typeLabel(t)} <span className="faint">{n}</span>
            </button>
          ))}
        </div>
      )}

      {!feed.data && feed.loading && <Spinner label="Loading events…" />}
      {feed.data && !events.length && <Card><Empty icon="📅">{all.length ? 'No events match this filter.' : 'No events are listed right now.'}</Empty></Card>}

      {view === 'agenda' ? <Agenda events={events} now={now} /> : (
        <>
          <EventSection id="ev-live" title="Live now" events={sections.live} now={now} badge={<span className="badge live">LIVE</span>} />
          <EventSection id="ev-upcoming" title="Upcoming" events={sections.upcoming} now={now} pageSize={18} />
          <EventSection id="ev-tba" title="Date to be announced" events={sections.tba} now={now} />
          <EventSection id="ev-ended" title="Recently ended" events={sections.ended} now={now} pageSize={6} />
        </>
      )}
      {all.length > 0 && <p className="faint small" style={{ marginTop: 18 }}>Times are shown in your timezone. Most events start at the same local time everywhere (e.g. Community Day 2–5 PM local); events with a fixed global time are converted automatically.</p>}
    </div>
  );
}

// ---------------------------------------------------------------- list view
function EventSection({ id, title, events, now, badge, pageSize = 12 }: { id: string; title: string; events: LiveEvent[]; now: number; badge?: ReactNode; pageSize?: number }) {
  const { visible, more } = useShowMore(events, pageSize);
  if (!events.length) return null;
  return (
    <section>
      <div className="section-title" id={id}><h2>{title}</h2>{badge}<span className="count">{events.length}</span></div>
      <div className="ev-grid">{visible.map((e) => <EventCard key={e.eventID + (e.start || '')} e={e} now={now} />)}</div>
      {more}
    </section>
  );
}

function EventCard({ e, now }: { e: LiveEvent; now: number }) {
  const start = eventDate(e.start), end = eventDate(e.end);
  const status = !e.start && !e.end ? 'tba' : eventStatus(e, now);
  const label = typeLabel(e.eventType);
  const progress = status === 'live' && start && end ? Math.min(100, Math.max(0, ((now - start.getTime()) / (end.getTime() - start.getTime())) * 100)) : null;
  const [imgOk, setImgOk] = useState(true);
  return (
    <article className="card event-card ev-card" style={status === 'ended' ? { opacity: 0.78 } : undefined}>
      <div className="banner-wrap">
        {e.image && imgOk ? (
          <a href={e.link} target="_blank" rel="noopener noreferrer" tabIndex={-1} aria-hidden>
            <img className="banner" src={e.image} alt="" loading="lazy" onError={() => setImgOk(false)} />
          </a>
        ) : <div className="banner" style={{ background: `linear-gradient(135deg, ${typeColor(e.eventType)}, var(--surface-3))` }} />}
        <div className="badges">
          {status === 'live' && <span className="badge live">LIVE</span>}
          <span className="badge"><span className="ev-type-dot" style={{ background: typeColor(e.eventType) }} />{label}</span>
        </div>
      </div>
      <div className="body">
        <h3>{e.name}</h3>
        {e.heading && e.heading !== label && !label.includes(e.heading) && !e.heading.includes(label) && <div className="small faint">{e.heading}</div>}
        <div className="ev-when">
          {start || end ? dateRange(start, end) : 'Date to be announced'}
          {(isLocalTime(e.start) || isLocalTime(e.end)) && <span className="faint"> · local time</span>}
        </div>
        <div className="small">
          {status === 'live' && end && <><span className="good bold">Ends in <Countdown to={end} /></span>{start && end && <span className="faint"> · {duration(end.getTime() - start.getTime())} total</span>}</>}
          {status === 'live' && !end && <span className="good bold">Ongoing</span>}
          {status === 'upcoming' && start && <span className="bold" style={{ color: 'var(--accent-2)' }}>Starts in <Countdown to={start} /></span>}
          {status === 'ended' && end && <span className="faint">Ended {timeAgo(end.getTime())}</span>}
        </div>
        {progress !== null && <div className="progress" aria-label={`${Math.round(progress)}% elapsed`}><div style={{ width: `${progress}%` }} /></div>}
        <EventDetails e={e} />
        <div className="ev-foot">
          <a className="btn sm" href={e.link} target="_blank" rel="noopener noreferrer">Leek Duck ↗</a>
          {e.extraData?.generic?.hasSpawns && <span className="badge">🌿 Wild spawns</span>}
          {e.extraData?.generic?.hasFieldResearchTasks && <Link to="/research" className="badge accent">📋 Field research</Link>}
        </div>
      </div>
    </article>
  );
}

// ---------------------------------------------------------------- extraData
function guessTier(eventName: string, res: Resolved): RaidTier {
  const p = res.pokemon;
  const by = (id: string) => RAID_TIERS.find((t) => t.id === id)!;
  if (res.shadow || /shadow raid/i.test(eventName)) return by(p.class ? 'shadow5' : /3-star/i.test(eventName) ? 'shadow3' : /1-star/i.test(eventName) ? 'shadow1' : 'shadow5');
  if (p.megaOf) return by(p.class ? 'mega5' : 'mega');
  if (/5-star/i.test(eventName)) return by('5');
  if (/3-star/i.test(eventName)) return by('3');
  if (/1-star/i.test(eventName)) return by('1');
  return defaultTier(p);
}

function MonChips({ list, counters, eventName }: { list: LiveMon[]; counters?: boolean; eventName?: string }) {
  const resolve = useResolver();
  const seen = new Set<string>();
  const uniq = list.filter((m) => (seen.has(m.name) ? false : (seen.add(m.name), true)));
  return (
    <div className="ev-mons">
      {uniq.map((m) => {
        const r = resolve(m.name, m.image);
        const inner = <><LiveSprite image={m.image} p={r?.pokemon} size={26} shadow={r?.shadow} />{m.name}{m.canBeShiny && <span title="Shiny available">✨</span>}</>;
        if (!r) return <span key={m.name} className="ev-mon">{inner}</span>;
        const to = counters ? countersLink(r.pokemon, guessTier(eventName || '', r)) : `/dex/${r.pokemon.id}`;
        return <Link key={m.name} className="ev-mon" to={to} title={counters ? `Raid counters for ${m.name}` : undefined}>{inner}</Link>;
      })}
    </div>
  );
}

function EventDetails({ e }: { e: LiveEvent }) {
  const x = e.extraData;
  const toast = useToast();
  if (!x) return null;
  const { spotlight, communityday: cd, raidbattles: rb, breakthrough, promocodes } = x;
  return (
    <div className="ev-detail">
      {spotlight && (
        <>
          <MonChips list={spotlight.list?.length ? spotlight.list : [spotlight]} />
          {spotlight.bonus && <div><span className="faint">Bonus:</span> <b>{spotlight.bonus}</b></div>}
        </>
      )}
      {cd && (
        <>
          {cd.spawns?.length > 0 && <><div className="faint small">Featured</div><MonChips list={cd.spawns} /></>}
          {cd.bonuses?.length > 0 && (
            <details>
              <summary className="small"><b>{cd.bonuses.length} bonuses</b></summary>
              <ul className="ev-bonuses small">{cd.bonuses.map((b) => <li key={b.text}>{b.text}</li>)}</ul>
              {cd.bonusDisclaimers?.map((d) => <p key={d} className="tiny faint" style={{ margin: '4px 0 0' }}>{d}</p>)}
            </details>
          )}
          {cd.shinies && cd.shinies.length > 0 && <div className="small"><span className="faint">Shiny:</span> {[...new Set(cd.shinies.map((s) => s.name))].join(', ')}</div>}
        </>
      )}
      {rb && rb.bosses?.length > 0 && (
        <>
          <div className="faint small">Raid bosses · tap for counters</div>
          <MonChips list={rb.bosses} counters eventName={e.name} />
        </>
      )}
      {breakthrough && (
        <>
          <div className="faint small">Research Breakthrough</div>
          <MonChips list={breakthrough.list?.length ? breakthrough.list : [breakthrough]} />
        </>
      )}
      {promocodes && promocodes.length > 0 && (
        <div className="row" style={{ gap: 6 }}>
          <span className="faint small">Promo code{promocodes.length > 1 ? 's' : ''}:</span>
          {promocodes.map((c) => (
            <button key={c} type="button" className="chip mono" title="Copy code" onClick={async () => toast.show((await copyText(c)) ? `Copied ${c}` : 'Copy failed')}>{c} ⧉</button>
          ))}
        </div>
      )}
      {toast.node}
    </div>
  );
}

// ---------------------------------------------------------------- agenda view
const startOfDay = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
function startOfWeek(t: number) {
  const d = new Date(startOfDay(t));
  const dow = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - dow);
  return d.getTime();
}
const addDays = (t: number, n: number) => { const d = new Date(t); d.setDate(d.getDate() + n); return d.getTime(); };
const LONG_EVENT = 3 * DAY;

function Agenda({ events, now }: { events: LiveEvent[]; now: number }) {
  const [weeksShown, setWeeksShown] = useState(6);
  const weekStarts = useMemo(() => {
    const first = startOfWeek(now);
    const lastStart = Math.max(now, ...events.map((e) => eventDate(e.start)?.getTime() ?? 0));
    const total = Math.min(60, Math.max(1, Math.ceil((lastStart - first) / (7 * DAY)) + 1));
    return { first, total };
  }, [events, now]);
  const dated = events.filter((e) => e.start || e.end);
  const today = startOfDay(now);
  const weeks = Array.from({ length: Math.min(weeksShown, weekStarts.total) }, (_, i) => addDays(weekStarts.first, i * 7));

  return (
    <div>
      {weeks.map((ws) => {
        const we = addDays(ws, 7);
        const span = (e: LiveEvent) => {
          const s = eventDate(e.start)?.getTime() ?? -Infinity, en = eventDate(e.end)?.getTime() ?? Infinity;
          return { s, en, long: en - s > LONG_EVENT };
        };
        const ongoing = dated.filter((e) => { const { s, en, long } = span(e); return long && s < we && en > ws; })
          .sort((a, b) => span(a).en - span(b).en);
        const days = Array.from({ length: 7 }, (_, i) => addDays(ws, i)).map((d) => ({
          d,
          items: dated.filter((e) => { const { s, long } = span(e); return !long && s >= d && s < addDays(d, 1); })
            .sort((a, b) => span(a).s - span(b).s),
          starts: dated.filter((e) => { const { s, long } = span(e); return long && s >= d && s < addDays(d, 1); }),
        })).filter((x) => x.items.length || x.starts.length || x.d === today);
        const label = `${new Date(ws).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${new Date(addDays(ws, 6)).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
        return (
          <Card key={ws} className="agenda-week" flush>
            <div className="agenda-week-head">
              <h3>{ws === weekStarts.first ? 'This week' : ws === addDays(weekStarts.first, 7) ? 'Next week' : 'Week of ' + new Date(ws).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}</h3>
              <span className="small faint">{label}</span>
            </div>
            {ongoing.length > 0 && (
              <div className="agenda-ongoing">
                <span className="tiny faint" style={{ alignSelf: 'center' }}>Running:</span>
                {ongoing.map((e) => {
                  const en = eventDate(e.end);
                  return (
                    <a key={e.eventID + e.start} className="span-chip" href={e.link} target="_blank" rel="noopener noreferrer" title={dateRange(eventDate(e.start), en)}>
                      <span className="ev-type-dot" style={{ background: typeColor(e.eventType) }} /><span>{e.name}</span>
                      {en && <span className="faint" style={{ flex: 'none' }}>→ {en.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>}
                    </a>
                  );
                })}
              </div>
            )}
            {days.length === 0 && ongoing.length === 0 && <div className="faint small" style={{ padding: '10px 16px' }}>Nothing scheduled yet.</div>}
            {days.map(({ d, items, starts }) => (
              <div key={d} className={`agenda-day ${d === today ? 'today' : ''}`}>
                <div className="agenda-date">{new Date(d).toLocaleDateString(undefined, { weekday: 'short' })}<b>{new Date(d).getDate()}</b>{d === today && <span className="badge accent">Today</span>}</div>
                <div className="agenda-items">
                  {!items.length && !starts.length && <span className="faint small">No new events</span>}
                  {[...starts, ...items].map((e) => {
                    const s = eventDate(e.start), en = eventDate(e.end);
                    const st = eventStatus(e, now);
                    return (
                      <div key={e.eventID + e.start} className="agenda-item" style={st === 'ended' ? { opacity: 0.6 } : undefined}>
                        <span className="t">{s ? s.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '—'}</span>
                        <span className="ev-type-dot" style={{ background: typeColor(e.eventType) }} />
                        <a className="n" href={e.link} target="_blank" rel="noopener noreferrer" title={`${typeLabel(e.eventType)} · ${dateRange(s, en)}`} style={{ color: 'var(--text)' }}>{e.name}</a>
                        {st === 'live' && <span className="badge live" style={{ flex: 'none' }}>LIVE</span>}
                        {span(e).long && <span className="badge" style={{ flex: 'none' }}>starts</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </Card>
        );
      })}
      {weekStarts.total > weeksShown && (
        <div className="center" style={{ padding: 12 }}><button className="btn" onClick={() => setWeeksShown((n) => n + 6)}>Show later weeks ({weekStarts.total - weeksShown} more)</button></div>
      )}
      {(() => { const tba = events.filter((e) => !e.start && !e.end); return tba.length ? <p className="small muted">Date to be announced: {tba.map((e) => e.name).join(' · ')}</p> : null; })()}
    </div>
  );
}
