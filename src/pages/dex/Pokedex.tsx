import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Card, Empty, PageHeader, PokeImg, Segmented, Select, Switch, TypeBadge, Types, useShowMore, useSort } from '../../components/ui';
import { displayName, useData } from '../../lib/data';
import { fmt } from '../../lib/format';
import { cp, TYPES } from '../../lib/pogo';
import { useCollection, useStored } from '../../lib/storage';
import type { PokeType, Pokemon } from '../../lib/types';
import './dex.css';

const GEN_NAMES = ['', 'Kanto', 'Johto', 'Hoenn', 'Sinnoh', 'Unova', 'Kalos', 'Alola', 'Galar', 'Paldea'];
type Cat = 'all' | 'legendary' | 'mythical' | 'ultra_beast' | 'mega' | 'regional' | 'shadow' | 'dmax' | 'gmax' | 'starter';

interface Filters { q: string; types: PokeType[]; gen: number; cat: Cat; view: 'grid' | 'table'; unreleased: boolean; megas: boolean; owned: 'any' | 'have' | 'missing' }
const DEFAULT: Filters = { q: '', types: [], gen: 0, cat: 'all', view: 'grid', unreleased: false, megas: true, owned: 'any' };

export default function Pokedex() {
  const data = useData();
  const nav = useNavigate();
  const { collection } = useCollection();
  const [f, setF] = useStored<Filters>('dex.filters', DEFAULT);
  const filters = { ...DEFAULT, ...f };
  const set = (patch: Partial<Filters>) => setF({ ...filters, ...patch });
  const [showFilters, setShowFilters] = useState(false);

  const rows = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    const num = Number(q.replace('#', ''));
    return data.pokemon.filter((p) => {
      if (!filters.unreleased && !p.released) return false;
      if (!filters.megas && p.megaOf) return false;
      if (filters.gen && p.gen !== filters.gen) return false;
      if (filters.types.length && !filters.types.every((t) => p.types.includes(t))) return false;
      switch (filters.cat) {
        case 'legendary': if (p.class !== 'legendary') return false; break;
        case 'mythical': if (p.class !== 'mythical') return false; break;
        case 'ultra_beast': if (p.class !== 'ultra_beast') return false; break;
        case 'mega': if (!p.megaOf) return false; break;
        case 'regional': if (!/^(ALOLA|GALARIAN|HISUIAN|PALDEA)/.test(p.form || '')) return false; break;
        case 'shadow': if (!p.shadowReleased) return false; break;
        case 'dmax': if (!p.dmax) return false; break;
        case 'gmax': if (!p.gmax) return false; break;
        case 'starter': if (!p.tags.includes('starter')) return false; break;
      }
      if (filters.owned !== 'any') {
        const has = !!collection[p.id]?.caught;
        if (filters.owned === 'have' ? !has : has) return false;
      }
      if (q) {
        if (!Number.isNaN(num) && q !== '') return p.dex === num;
        const n = displayName(p).toLowerCase();
        if (!n.includes(q) && !p.types.some((t) => t === q)) return false;
      }
      return true;
    });
  }, [data, filters.q, filters.types, filters.gen, filters.cat, filters.unreleased, filters.megas, filters.owned, collection]); // eslint-disable-line react-hooks/exhaustive-deps

  const maxCp = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of rows) m.set(p.id, cp(p, data.settings, 50));
    return m;
  }, [rows, data.settings]);

  const { sorted, th } = useSort(rows, { key: 'dex', dir: 1 }, {
    dex: (p) => p.dex * 100 + (p.megaOf ? 50 : 0) + (p.form ? 1 : 0),
    name: (p) => displayName(p),
    atk: (p) => p.atk, def: (p) => p.def, sta: (p) => p.sta,
    total: (p) => p.atk + p.def + p.sta,
    cp: (p) => maxCp.get(p.id) ?? 0,
    buddy: (p) => p.buddyKm,
  });
  const { visible, more } = useShowMore(sorted, filters.view === 'grid' ? 120 : 100);

  const activeCount = filters.types.length + (filters.gen ? 1 : 0) + (filters.cat !== 'all' ? 1 : 0) + (filters.owned !== 'any' ? 1 : 0);

  return (
    <div>
      <PageHeader title="Pokédex" subtitle={`${fmt(rows.length)} Pokémon · stats, moves, evolutions, costs and battle ratings for every species and form.`}
        actions={<Segmented value={filters.view} onChange={(v) => set({ view: v })} options={[{ id: 'grid', label: '▦ Grid' }, { id: 'table', label: '☰ Table' }]} />} />

      <Card className="dex-filters">
        <div className="row">
          <input className="input" style={{ flex: '1 1 240px' }} placeholder="Search name, number or type…" value={filters.q} onChange={(e) => set({ q: e.target.value })} />
          <Select value={filters.gen} onChange={(v) => set({ gen: v })} style={{ width: 170 }} options={[{ id: 0, label: 'All generations' }, ...GEN_NAMES.slice(1).map((g, i) => ({ id: i + 1, label: `Gen ${i + 1} · ${g}` }))]} />
          <Select value={filters.cat} onChange={(v) => set({ cat: v })} style={{ width: 170 }} options={[
            { id: 'all', label: 'All categories' }, { id: 'legendary', label: 'Legendary' }, { id: 'mythical', label: 'Mythical' }, { id: 'ultra_beast', label: 'Ultra Beasts' },
            { id: 'mega', label: 'Mega & Primal' }, { id: 'regional', label: 'Regional forms' }, { id: 'shadow', label: 'Shadow available' },
            { id: 'dmax', label: 'Dynamax (game files)' }, { id: 'gmax', label: 'Gigantamax (game files)' }, { id: 'starter', label: 'Starters' },
          ] as { id: Cat; label: string }[]} />
          <button className={`btn ${showFilters || filters.types.length ? 'primary' : ''}`} onClick={() => setShowFilters((x) => !x)}>Types{filters.types.length ? ` (${filters.types.length})` : ''}</button>
          {activeCount > 0 && <button className="btn ghost" onClick={() => set({ types: [], gen: 0, cat: 'all', owned: 'any', q: '' })}>Clear</button>}
        </div>
        {showFilters && (
          <div className="chips" style={{ marginTop: 12 }}>
            {TYPES.map((t) => {
              const on = filters.types.includes(t);
              return (
                <button key={t} className={`chip ${on ? 'on' : ''}`} style={on ? { background: `var(--t-${t})`, borderColor: `var(--t-${t})`, color: '#fff' } : undefined}
                  onClick={() => set({ types: on ? filters.types.filter((x) => x !== t) : [...filters.types, t].slice(-2) })}>
                  <span className="type-dot" style={{ background: `var(--t-${t})` }} />{t}
                </button>
              );
            })}
          </div>
        )}
        <div className="row" style={{ marginTop: 12, gap: 18 }}>
          <Switch checked={filters.megas} onChange={(v) => set({ megas: v })} label="Show Mega / Primal" />
          <Switch checked={filters.unreleased} onChange={(v) => set({ unreleased: v })} label="Include unreleased" />
          <Segmented size="sm" value={filters.owned} onChange={(v) => set({ owned: v })} options={[{ id: 'any', label: 'All' }, { id: 'have', label: 'Caught' }, { id: 'missing', label: 'Missing' }]} />
        </div>
      </Card>

      <div style={{ height: 16 }} />
      {rows.length === 0 && <Empty>No Pokémon match these filters.</Empty>}

      {filters.view === 'grid' ? (
        <div className="dex-grid">
          {visible.map((p) => <DexTile key={p.id} p={p} caught={!!collection[p.id]?.caught} shiny={!!collection[p.id]?.shiny} />)}
        </div>
      ) : (
        <Card flush>
          <div className="table-wrap">
            <table className="table compact">
              <thead><tr>
                {th('dex', '#')}{th('name', 'Pokémon')}<th>Type</th>{th('atk', 'Atk', { num: true })}{th('def', 'Def', { num: true })}{th('sta', 'Sta', { num: true })}{th('total', 'Total', { num: true })}{th('cp', 'Max CP', { num: true, title: 'Level 50, 15/15/15' })}{th('buddy', 'Buddy', { num: true })}
              </tr></thead>
              <tbody>
                {visible.map((p) => (
                  <tr key={p.id} className="clickable" onClick={() => nav(`/dex/${p.id}`)}>
                    <td className="faint num">{p.dex}</td>
                    <td><span className="mon"><PokeImg p={p} size={30} /><span className="mon-name">{displayName(p)}</span>{!p.released && <span className="badge">Unreleased</span>}</span></td>
                    <td><Types types={p.types} small /></td>
                    <td className="num">{p.atk}</td><td className="num">{p.def}</td><td className="num">{p.sta}</td>
                    <td className="num bold">{p.atk + p.def + p.sta}</td>
                    <td className="num">{fmt(maxCp.get(p.id) ?? 0)}</td>
                    <td className="num">{p.buddyKm} km</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {more}
    </div>
  );
}

function DexTile({ p, caught, shiny }: { p: Pokemon; caught: boolean; shiny: boolean }) {
  return (
    <Link to={`/dex/${p.id}`} className="dex-tile" style={{ ['--tc' as string]: `var(--t-${p.types[0]})` }}>
      <span className="dex-num">#{String(p.dex).padStart(4, '0')}</span>
      {caught && <span className="dex-own" title={shiny ? 'Caught (shiny)' : 'Caught'}>{shiny ? '✦' : '●'}</span>}
      <PokeImg p={p} size={72} />
      <span className="dex-name">{p.name}</span>
      {p.formName && <span className="dex-form">{p.formName}</span>}
      <span className="types" style={{ justifyContent: 'center' }}>{p.types.map((t) => <TypeBadge key={t} type={t} small noIcon />)}</span>
    </Link>
  );
}
