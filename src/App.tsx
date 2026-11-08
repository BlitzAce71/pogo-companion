import { Component, Suspense, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from 'react';
import { HashRouter, Link, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { PokeImg, Spinner, Types, searchPokemon } from './components/ui';
import { DataProvider, displayName, useData } from './lib/data';
import { usePrefs } from './lib/storage';
import { NAV_GROUPS, ROUTES } from './routes';

function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden>
      <defs><linearGradient id="bm" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#ff5a5f" /><stop offset="1" stopColor="#c2185b" /></linearGradient></defs>
      <circle cx="16" cy="16" r="14.5" fill="url(#bm)" />
      <path d="M1.5 16h29" stroke="#0d1117" strokeWidth="2.6" />
      <path d="M16 1.5a14.5 14.5 0 0 1 14.5 14.5H1.5A14.5 14.5 0 0 1 16 1.5z" fill="url(#bm)" />
      <path d="M1.5 16a14.5 14.5 0 0 0 29 0z" fill="#f4f6fb" />
      <circle cx="16" cy="16" r="5" fill="#f4f6fb" stroke="#0d1117" strokeWidth="2.6" />
      <circle cx="16" cy="16" r="1.8" fill="#4f8ef7" />
    </svg>
  );
}

function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const groups = NAV_GROUPS.map((g) => ({ g, items: ROUTES.filter((r) => r.nav?.group === g) }));
  return (
    <>
      {open && <div className="sidebar-backdrop" onClick={onClose} />}
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <Link to="/" className="sidebar-brand" onClick={onClose}><BrandMark /> PoGo Companion</Link>
        <nav className="sidebar-nav">
          {groups.map(({ g, items }) => (
            <div className="nav-group" key={g}>
              {g !== 'Today' && <div className="nav-group-title">{g}</div>}
              {items.map((r) => (
                <NavLink key={r.path} to={r.path} end={r.path === '/' || r.path === '/pvp' || r.path === '/collection'} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} onClick={onClose}>
                  <span className="ico">{r.nav!.icon}</span>{r.nav!.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
      </aside>
    </>
  );
}

function BottomNav({ onMore }: { onMore: () => void }) {
  const items = [
    { to: '/', icon: '🏠', label: 'Today' },
    { to: '/dex', icon: '📖', label: 'Pokédex' },
    { to: '/counters', icon: '🛡️', label: 'Counters' },
    { to: '/tools/iv', icon: '🧮', label: 'IV Calc' },
  ];
  return (
    <nav className="bottom-nav">
      {items.map((i) => <NavLink key={i.to} to={i.to} end={i.to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}><span className="ico">{i.icon}</span>{i.label}</NavLink>)}
      <button onClick={onMore}><span className="ico">☰</span>More</button>
    </nav>
  );
}

// ---------------------------------------------------------------- command palette
function Palette({ onClose }: { onClose: () => void }) {
  const data = useData();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    type R = { key: string; group: string; label: React.ReactNode; to: string };
    const out: R[] = [];
    const pages = ROUTES.filter((r) => r.nav && (!s || `${r.nav.label} ${r.nav.group} ${r.nav.keywords || ''}`.toLowerCase().includes(s)));
    const mons = s ? searchPokemon(data.pokemon.filter((p) => p.released || s.length > 2), s, 12) : [];
    const moves = s.length >= 2 ? Object.values(data.moves).filter((m) => !m.max && m.name.toLowerCase().includes(s)).sort((a, b) => a.name.indexOf(s) - b.name.indexOf(s)).slice(0, 8) : [];
    for (const p of mons) out.push({ key: 'p' + p.id, group: 'Pokémon', to: `/dex/${p.id}`, label: <><PokeImg p={p} size={28} /><span style={{ flex: 1 }}>{displayName(p)} <span className="faint small">#{p.dex}</span></span><Types types={p.types} small /></> });
    for (const m of moves) out.push({ key: 'm' + m.id, group: 'Moves', to: `/moves/${m.id}`, label: <><span className="type-dot" style={{ background: `var(--t-${m.type})`, marginLeft: 8 }} /><span style={{ flex: 1 }}>{m.name}</span><span className="faint small">{m.fast ? 'Fast' : 'Charged'}</span></> });
    for (const r of pages.slice(0, s ? 8 : 40)) out.push({ key: 'r' + r.path, group: 'Pages', to: r.path, label: <><span style={{ width: 28, textAlign: 'center' }}>{r.nav!.icon}</span><span style={{ flex: 1 }}>{r.nav!.label}</span><span className="faint small">{r.nav!.group}</span></> });
    if (mons[0]) out.push({ key: 'c' + mons[0].id, group: 'Actions', to: `/counters?boss=${mons[0].id}`, label: <><span style={{ width: 28, textAlign: 'center' }}>🛡️</span><span style={{ flex: 1 }}>Raid counters for {displayName(mons[0])}</span></> });
    return out;
  }, [q, data]);
  useEffect(() => { listRef.current?.querySelector('.on')?.scrollIntoView({ block: 'nearest' }); }, [hi]);
  const go = (to: string) => { nav(to); onClose(); };
  let lastGroup = '';
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <input autoFocus placeholder="Search Pokémon, moves, tools…" value={q}
          onChange={(e) => { setQ(e.target.value); setHi(0); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(results.length - 1, h + 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
            if (e.key === 'Enter' && results[hi]) go(results[hi].to);
            if (e.key === 'Escape') onClose();
          }} />
        <div className="palette-list" ref={listRef}>
          {results.length === 0 && <div className="empty">No results</div>}
          {results.map((r, i) => {
            const head = r.group !== lastGroup ? <div className="palette-group">{r.group}</div> : null;
            lastGroup = r.group;
            return (
              <div key={r.key}>
                {head}
                <div className={`picker-item ${i === hi ? 'on' : ''}`} onMouseEnter={() => setHi(i)} onClick={() => go(r.to)}>{r.label}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

class PageBoundary extends Component<{ children: ReactNode; resetKey: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('Page crashed', error, info.componentStack); }
  componentDidUpdate(prev: { resetKey: string }) { if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null }); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="empty">
        <div className="big">⚠️</div>
        <h2>This page hit an error</h2>
        <p className="muted small mono" style={{ margin: '10px auto', maxWidth: 600 }}>{String(this.state.error.message || this.state.error)}</p>
        <button className="btn" onClick={() => this.setState({ error: null })}>Try again</button> <Link className="btn" to="/">Go home</Link>
      </div>
    );
  }
}

function BoundedRoutes() {
  const { pathname } = useLocation();
  return (
    <PageBoundary resetKey={pathname}>
      <Suspense fallback={<Spinner label="Loading…" />}>
        <Routes>
          {ROUTES.map((r) => <Route key={r.path} path={r.path} element={<r.page />} />)}
          <Route path="*" element={<div className="empty"><div className="big">🤔</div>Page not found. <Link to="/">Go home</Link></div>} />
        </Routes>
      </Suspense>
    </PageBoundary>
  );
}

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

function Shell() {
  const [navOpen, setNavOpen] = useState(false);
  const [palette, setPalette] = useState(false);
  const data = useData();
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((x) => !x); }
      else if (e.key === '/' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement)) { e.preventDefault(); setPalette(true); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
  return (
    <div className="app">
      <ScrollToTop />
      <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />
      <div className="main">
        <header className="topbar">
          <button className="btn ghost icon menu-btn" onClick={() => setNavOpen(true)} aria-label="Menu">☰</button>
          <button className="search-trigger" onClick={() => setPalette(true)}>
            <span>🔍</span><span>Search Pokémon, moves, tools…</span><kbd>Ctrl K</kbd>
          </button>
          <div className="spacer" />
          <Link to="/settings" className="btn ghost icon" aria-label="Settings" title="Settings">⚙️</Link>
        </header>
        <main className="content">
          <BoundedRoutes />
        </main>
        <footer className="footer">
          Game data from PokeMiners game master &amp; PvPoke · Live data from Leek Duck (ScrapedDuck) · Built {new Date(data.settings.generatedAt).toLocaleDateString()}<br />
          Personal fan-made companion. Pokémon and Pokémon GO are trademarks of Nintendo, Creatures, GAME FREAK and Niantic.
        </footer>
      </div>
      <BottomNav onMore={() => setNavOpen(true)} />
      {palette && <Palette onClose={() => setPalette(false)} />}
    </div>
  );
}

function ThemeSync() {
  const [prefs] = usePrefs();
  useEffect(() => {
    const apply = () => {
      const dark = prefs.theme === 'dark' || (prefs.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0d1117' : '#f3f5fa');
    };
    apply();
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [prefs.theme]);
  return null;
}

export default function App() {
  return (
    <HashRouter>
      <ThemeSync />
      <DataProvider fallback={<div className="loading-screen"><div className="spinner" /><div>Loading game data…</div></div>}>
        <Shell />
      </DataProvider>
    </HashRouter>
  );
}
