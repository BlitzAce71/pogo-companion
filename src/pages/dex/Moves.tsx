import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Empty, PageHeader, Segmented, Types, useShowMore, useSort } from '../../components/ui';
import { useData } from '../../lib/data';
import { fmt } from '../../lib/format';
import { TYPES } from '../../lib/pogo';
import { useStored } from '../../lib/storage';
import type { Move, PokeType } from '../../lib/types';
import { buffText } from './PokemonDetail';

interface F { q: string; kind: 'fast' | 'charged'; mode: 'pve' | 'pvp'; type: PokeType | '' }

export default function Moves() {
  const data = useData();
  const nav = useNavigate();
  const [f, setF] = useStored<F>('moves.filters', { q: '', kind: 'fast', mode: 'pve', type: '' });
  const set = (p: Partial<F>) => setF({ ...f, ...p });

  const learners = useMemo(() => {
    const m: Record<string, number> = {};
    for (const p of data.pokemon) if (p.released && !p.megaOf) for (const id of [...p.fast, ...p.charged, ...p.eliteFast, ...p.eliteCharged]) m[id] = (m[id] || 0) + 1;
    return m;
  }, [data.pokemon]);

  const rows = useMemo(() => Object.values(data.moves).filter((m) => {
    if (m.max) return false;
    if (m.fast !== (f.kind === 'fast')) return false;
    if (f.mode === 'pve' ? !m.pve : !m.pvp) return false;
    if (f.type && m.type !== f.type) return false;
    if (f.q && !m.name.toLowerCase().includes(f.q.toLowerCase())) return false;
    return learners[m.id] || m.special;
  }), [data.moves, f, learners]);

  const v = (m: Move) => {
    if (f.mode === 'pve' && m.pve) {
      const s = m.pve.duration / 1000 || 1;
      return { power: m.pve.power, energy: m.pve.energy, time: s, dps: m.pve.power / s, eps: m.pve.energy / s, dpe: m.pve.energy ? m.pve.power / m.pve.energy : 0 };
    }
    const p = m.pvp!;
    return { power: p.power, energy: p.energy, time: p.turns, dps: p.power / p.turns, eps: p.energy / p.turns, dpe: p.energy ? p.power / p.energy : 0 };
  };
  const { sorted, th } = useSort(rows, { key: 'dps', dir: -1 }, {
    name: (m) => m.name, type: (m) => m.type, power: (m) => v(m).power, energy: (m) => v(m).energy, time: (m) => v(m).time,
    dps: (m) => (f.kind === 'fast' ? v(m).dps : v(m).dpe), eps: (m) => v(m).eps, learners: (m) => learners[m.id] || 0,
  });
  const { visible, more } = useShowMore(sorted, 100);
  const pvp = f.mode === 'pvp';
  const fast = f.kind === 'fast';

  return (
    <div>
      <PageHeader title="Moves" subtitle="Every fast and charged move with raid/gym and Trainer Battle stats. Moves behave differently in each mode — toggle to compare." />
      <Card>
        <div className="row">
          <input className="input" style={{ flex: '1 1 200px' }} placeholder="Search moves…" value={f.q} onChange={(e) => set({ q: e.target.value })} />
          <Segmented value={f.kind} onChange={(k) => set({ kind: k })} options={[{ id: 'fast', label: 'Fast' }, { id: 'charged', label: 'Charged' }]} />
          <Segmented value={f.mode} onChange={(m) => set({ mode: m })} options={[{ id: 'pve', label: 'Raids & gyms' }, { id: 'pvp', label: 'Trainer battles' }]} />
        </div>
        <div className="chips" style={{ marginTop: 12 }}>
          <button className={`chip ${!f.type ? 'on' : ''}`} onClick={() => set({ type: '' })}>All types</button>
          {TYPES.map((t) => (
            <button key={t} className={`chip ${f.type === t ? 'on' : ''}`} onClick={() => set({ type: f.type === t ? '' : t })}
              style={f.type === t ? { background: `var(--t-${t})`, borderColor: `var(--t-${t})`, color: '#fff' } : undefined}>
              <span className="type-dot" style={{ background: `var(--t-${t})` }} />{t}
            </button>
          ))}
        </div>
      </Card>
      <div style={{ height: 16 }} />
      {rows.length === 0 ? <Empty>No moves match.</Empty> : (
        <Card flush footer={pvp ? 'Trainer battles: 1 turn = 0.5 s. DPT = damage per turn, EPT = energy per turn, DPE = damage per energy. Values exclude STAB.' : 'Raids & gyms: DPS = power ÷ duration, EPS = energy per second, DPE = damage per energy. Values exclude STAB and weather.'}>
          <div className="table-wrap">
            <table className="table compact">
              <thead><tr>
                {th('name', 'Move')}{th('type', 'Type')}{th('power', 'Power', { num: true })}{th('energy', 'Energy', { num: true })}
                {fast && th('time', pvp ? 'Turns' : 'Duration', { num: true })}
                {th('dps', fast ? (pvp ? 'DPT' : 'DPS') : 'DPE', { num: true })}
                {fast && th('eps', pvp ? 'EPT' : 'EPS', { num: true })}
                {!fast && !pvp && th('time', 'Duration', { num: true })}
                {!fast && pvp && <th>Effect</th>}
                {th('learners', 'Learned by', { num: true })}
              </tr></thead>
              <tbody>
                {visible.map((m) => {
                  const x = v(m);
                  return (
                    <tr key={m.id} className="clickable" onClick={() => nav(`/moves/${m.id}`)}>
                      <td className="bold">{m.name}</td>
                      <td><Types types={[m.type]} small /></td>
                      <td className="num">{x.power}</td>
                      <td className="num">{x.energy}</td>
                      {fast && <td className="num">{pvp ? x.time : `${x.time.toFixed(1)}s`}</td>}
                      <td className="num bold">{(fast ? x.dps : x.dpe).toFixed(2)}</td>
                      {fast && <td className="num">{x.eps.toFixed(2)}</td>}
                      {!fast && !pvp && <td className="num">{x.time.toFixed(1)}s</td>}
                      {!fast && pvp && <td className="small">{buffText(m)}</td>}
                      <td className="num faint">{fmt(learners[m.id] || 0)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {more}
        </Card>
      )}
    </div>
  );
}
