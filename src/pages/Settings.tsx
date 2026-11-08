import { Fragment, useRef } from 'react';
import { Card, Field, NumberInput, PageHeader, Segmented, Select, Switch, useToast } from '../components/ui';
import { useData } from '../lib/data';
import { fmt } from '../lib/format';
import { exportAll, importAll, usePrefs } from '../lib/storage';

export default function Settings() {
  const data = useData();
  const [prefs, setPrefs] = usePrefs();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const download = () => {
    const blob = new Blob([exportAll()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `pogo-companion-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast.show('Backup downloaded');
  };
  const upload = async (f: File) => {
    try { const n = importAll(await f.text()); toast.show(`Restored ${n} saved items`); } catch (e) { toast.show(String((e as Error).message || e)); }
  };
  const clearLive = () => {
    for (const k of Object.keys(localStorage)) if (k.startsWith('pogo.live.')) localStorage.removeItem(k);
    toast.show('Live data cache cleared');
  };
  const resetAll = () => {
    if (!confirm('Erase all your saved data (collection, saved Pokémon, preferences)? This cannot be undone — download a backup first if unsure.')) return;
    for (const k of Object.keys(localStorage)) if (k.startsWith('pogo.')) localStorage.removeItem(k);
    location.reload();
  };

  const released = data.pokemon.filter((p) => p.released);
  return (
    <div className="stack">
      <PageHeader title="Settings & Backup" subtitle="Preferences are stored on this device only. Use backups to move your data between devices." />
      <div className="grid grid-2">
        <Card title="Trainer">
          <div className="fields">
            <Field label="Trainer level"><NumberInput value={prefs.trainerLevel} min={1} max={80} onChange={(v) => setPrefs({ trainerLevel: Number(v) || 1 })} /></Field>
            <Field label="Team">
              <Select value={prefs.team} onChange={(v) => setPrefs({ team: v })} options={[{ id: 'none', label: '—' }, { id: 'mystic', label: 'Mystic (blue)' }, { id: 'valor', label: 'Valor (red)' }, { id: 'instinct', label: 'Instinct (yellow)' }]} />
            </Field>
          </div>
        </Card>
        <Card title="Appearance">
          <Segmented value={prefs.theme} onChange={(v) => setPrefs({ theme: v })} options={[{ id: 'system', label: '🖥️ System' }, { id: 'dark', label: '🌙 Dark' }, { id: 'light', label: '☀️ Light' }]} />
        </Card>
        <Card title="Battle defaults">
          <div className="col">
            <Field label="Default attacker level for raid counters" hint="Level 40 is the classic benchmark; 50 needs XL Candy.">
              <Segmented value={prefs.attackerLevel} onChange={(v) => setPrefs({ attackerLevel: v })} options={[{ id: 30, label: '30' }, { id: 35, label: '35' }, { id: 40, label: '40' }, { id: 45, label: '45' }, { id: 50, label: '50' }]} />
            </Field>
            <Switch checked={prefs.bestFriends} onChange={(v) => setPrefs({ bestFriends: v })} label="Assume Best Friend raid bonus" />
            <Switch checked={prefs.showUnreleased} onChange={(v) => setPrefs({ showUnreleased: v })} label="Show unreleased Pokémon in pickers & lists" />
          </div>
        </Card>
        <Card title="Backup & restore">
          <p className="small muted">Your collection, saved Pokémon, medal progress, teams and preferences.</p>
          <div className="row">
            <button className="btn primary" onClick={download}>⬇ Download backup</button>
            <button className="btn" onClick={() => fileRef.current?.click()}>⬆ Restore from file</button>
            <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} />
          </div>
          <div className="divider" />
          <div className="row">
            <button className="btn" onClick={clearLive}>Clear live-data cache</button>
            <button className="btn danger" onClick={resetAll}>Erase all my data</button>
          </div>
        </Card>
      </div>

      <Card title="Game data">
        <div className="kv">
          <span>Built</span><span>{new Date(data.settings.generatedAt).toLocaleString()}</span>
          <span>Pokémon entries</span><span>{fmt(data.pokemon.length)} ({fmt(released.length)} released, {fmt(released.filter((p) => p.megaOf).length)} Mega/Primal, {fmt(released.filter((p) => p.shadowReleased).length)} with Shadow)</span>
          <span>Moves</span><span>{fmt(Object.keys(data.moves).length)}</span>
          <span>PvP ranking sets</span><span>{data.settings.rankings.map((r) => r.title).join(', ')}</span>
          {Object.entries(data.settings.sources).map(([k, v]) => <Fragment key={k}><span>{k === 'gameMaster' ? 'Game master' : k === 'pvp' ? 'PvP data' : 'Live feeds'}</span><span>{v}</span></Fragment>)}
        </div>
        <div className="callout" style={{ marginTop: 14 }}>
          Live info (events, raids, research, eggs, Rocket lineups) refreshes automatically every 30 minutes while you use the app.
          Static game data (stats, moves, rankings) is compiled at build time — rerun <code className="mono">npm run data</code> then rebuild to pick up a new game update.
        </div>
      </Card>
      {toast.node}
    </div>
  );
}
