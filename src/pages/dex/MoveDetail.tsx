import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Card, Empty, Mon, MultChip, PageHeader, Segmented, StatTile, Types } from '../../components/ui';
import { displayName, useData } from '../../lib/data';
import { effectiveness, TYPES, weatherFor, WEATHERS } from '../../lib/pogo';
import type { Pokemon } from '../../lib/types';
import { buffText } from './PokemonDetail';

export default function MoveDetail() {
  const { id = '' } = useParams();
  const data = useData();
  const m = data.moves[id];
  const [filter, setFilter] = useState<'all' | 'normal' | 'elite'>('all');

  const learners = useMemo(() => {
    if (!m) return [];
    const out: { p: Pokemon; elite: boolean; stab: boolean }[] = [];
    for (const p of data.pokemon) {
      if (!p.released || p.megaOf) continue;
      const normal = p.fast.includes(m.id) || p.charged.includes(m.id);
      const elite = p.eliteFast.includes(m.id) || p.eliteCharged.includes(m.id);
      if (normal || elite) out.push({ p, elite: !normal && elite, stab: p.types.includes(m.type) });
    }
    return out.sort((a, b) => Number(b.stab) - Number(a.stab) || b.p.atk - a.p.atk);
  }, [data.pokemon, m]);

  if (!m) return <Empty icon="❓">Unknown move “{id}”. <Link to="/moves">All moves</Link></Empty>;
  const weather = weatherFor(data.settings, m.type);
  const w = WEATHERS.find((x) => x.id === weather || (weather === 'cloudy' && x.id === 'overcast'));
  const se = TYPES.filter((t) => effectiveness(data.types, m.type, [t]) > 1);
  const nve = TYPES.filter((t) => effectiveness(data.types, m.type, [t]) < 1);
  const shown = learners.filter((l) => filter === 'all' || (filter === 'elite') === l.elite);

  return (
    <div className="stack">
      <PageHeader title={m.name} subtitle={<span className="row" style={{ gap: 8 }}><Types types={[m.type]} /> {m.fast ? 'Fast move' : 'Charged move'}{m.special === 'shadow' && <span className="badge purple">Shadow Pokémon only</span>}{m.special === 'purified' && <span className="badge accent">Purified Pokémon only</span>}{m.max && <span className="badge bad">Max Move</span>}</span>}
        actions={<Link className="btn" to="/moves">← All moves</Link>} />

      <div className="grid grid-2">
        <Card title="Raids & gyms">
          {m.pve ? (
            <div className="grid grid-3" style={{ gap: 8 }}>
              <StatTile label="Power" value={m.pve.power} />
              <StatTile label={m.fast ? 'Energy gain' : 'Energy cost'} value={m.pve.energy} sub={!m.fast && m.pve.energy ? `${Math.round(100 / m.pve.energy)} bar${Math.round(100 / m.pve.energy) > 1 ? 's' : ''}` : undefined} />
              <StatTile label="Duration" value={`${(m.pve.duration / 1000).toFixed(1)}s`} sub={`damage at ${(m.pve.dws / 1000).toFixed(2)}s`} />
              {m.fast ? <><StatTile label="DPS" value={(m.pve.power / (m.pve.duration / 1000)).toFixed(2)} /><StatTile label="EPS" value={(m.pve.energy / (m.pve.duration / 1000)).toFixed(2)} /></>
                : <><StatTile label="DPS" value={(m.pve.power / (m.pve.duration / 1000)).toFixed(2)} /><StatTile label="DPE" value={m.pve.energy ? (m.pve.power / m.pve.energy).toFixed(2) : '—'} /></>}
            </div>
          ) : <div className="faint">Not used in raids/gyms.</div>}
        </Card>
        <Card title="Trainer battles">
          {m.pvp ? (
            <div className="grid grid-3" style={{ gap: 8 }}>
              <StatTile label="Power" value={m.pvp.power} />
              <StatTile label={m.fast ? 'Energy gain' : 'Energy cost'} value={m.pvp.energy} />
              {m.fast ? <><StatTile label="Turns" value={m.pvp.turns} sub={`${(m.pvp.turns * 0.5).toFixed(1)}s`} /><StatTile label="DPT" value={(m.pvp.power / m.pvp.turns).toFixed(2)} /><StatTile label="EPT" value={(m.pvp.energy / m.pvp.turns).toFixed(2)} /></>
                : <><StatTile label="DPE" value={m.pvp.energy ? (m.pvp.power / m.pvp.energy).toFixed(2) : '—'} /><StatTile label="Effect" value={<span className="small">{buffText(m) || 'None'}</span>} /></>}
            </div>
          ) : <div className="faint">Not used in Trainer Battles.</div>}
        </Card>
      </div>

      <Card title="Type effectiveness">
        <div className="row" style={{ alignItems: 'flex-start', gap: 24 }}>
          <div><div className="field-label">Super effective (×1.6) against</div><div className="row" style={{ marginTop: 6, gap: 4 }}>{se.length ? <Types types={se} small /> : <span className="faint">—</span>}</div></div>
          <div><div className="field-label">Not very effective against</div><div className="row" style={{ marginTop: 6, gap: 4 }}>{nve.map((t) => <span key={t} className="row" style={{ gap: 3 }}><Types types={[t]} small /><MultChip m={effectiveness(data.types, m.type, [t])} /></span>)}</div></div>
          {w && <div><div className="field-label">Weather boost</div><div style={{ marginTop: 6 }}>{w.icon} {w.name}</div></div>}
        </div>
      </Card>

      <Card title={`Learned by ${learners.length} Pokémon`} actions={<Segmented size="sm" value={filter} onChange={setFilter} options={[{ id: 'all', label: 'All' }, { id: 'normal', label: 'Regular' }, { id: 'elite', label: 'Elite / legacy' }]} />}
        footer="Sorted by same-type bonus (STAB) then attack stat.">
        {shown.length === 0 ? <div className="faint">None.</div> : (
          <div className="grid grid-auto" style={{ gap: 8 }}>
            {shown.map(({ p, elite, stab }) => (
              <div key={p.id} className="tile row nowrap" style={{ padding: 8 }} title={displayName(p)}>
                <Mon p={p} size={36} showTypes />
                <span className="spacer" />
                {stab && <span className="badge good">STAB</span>}
                {elite && <span className="badge warn">★ Elite</span>}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
