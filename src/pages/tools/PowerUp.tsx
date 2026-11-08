import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Card, Empty, Field, IvInputs, NumberInput, PageHeader, PokemonPicker, Select, StatTile, Switch } from '../../components/ui';
import { displayName, useData } from '../../lib/data';
import { fmt } from '../../lib/format';
import { cp, upgradeCost } from '../../lib/pogo';
import { useStored } from '../../lib/storage';
import { levelOptions, num, usePokemonParam } from './toolUtils';
import './tools.css';

interface Opts { shadow: boolean; purified: boolean; lucky: boolean }

export default function PowerUp() {
  const { settings } = useData();
  const [p, setP] = usePokemonParam('powerup');
  const [from, setFrom] = useStored<number>('tools.powerup.from', 20);
  const [to, setTo] = useStored<number>('tools.powerup.to', 40);
  const [o, setO] = useStored<Opts>('tools.powerup.opts', { shadow: false, purified: false, lucky: false });
  const [ivs, setIvs] = useStored<[number, number, number]>('tools.powerup.ivs', [15, 15, 15]);
  const [budget, setBudget] = useStored<{ dust: number | ''; candy: number | ''; xl: number | '' }>('tools.powerup.budget', { dust: '', candy: '', xl: '' });

  const maxL = settings.maxPokemonLevel || 50;
  const target = Math.min(maxL, Math.max(to, from + 0.5));
  const opts = { shadow: o.shadow, purified: o.purified, lucky: o.lucky };
  const total = upgradeCost(settings, p, from, target, opts);
  const override = p ? settings.upgrade.overrides[p.speciesId] : undefined;

  const setOpt = (k: keyof Opts, v: boolean) => setO((prev) => {
    const next = { ...prev, [k]: v };
    // Shadow Pokémon can't be purified at the same time, and can't be traded (so can't be lucky).
    if (k === 'shadow' && v) { next.purified = false; next.lucky = false; }
    if ((k === 'purified' || k === 'lucky') && v) next.shadow = false;
    return next;
  });

  const steps = useMemo(() => {
    const out: { L: number; dust: number; candy: number; xl: number; cd: number; cc: number; cx: number }[] = [];
    let cd = 0, cc = 0, cx = 0;
    for (let L = from; L < target; L += 0.5) {
      const s = upgradeCost(settings, p, L, L + 0.5, opts);
      cd += s.dust; cc += s.candy; cx += s.xl;
      out.push({ L, dust: s.dust, candy: s.candy, xl: s.xl, cd, cc, cx });
    }
    return out;
  }, [settings, p, from, target, o.shadow, o.purified, o.lucky]); // eslint-disable-line react-hooks/exhaustive-deps

  // Budget mode: highest level reachable from `from` with the given resources
  const reach = useMemo(() => {
    const bd = num(budget.dust, Infinity), bc = num(budget.candy, Infinity), bx = num(budget.xl, Infinity);
    if (budget.dust === '' && budget.candy === '' && budget.xl === '') return null;
    let d = 0, c = 0, x = 0, L = from, limit: string | null = null;
    while (L < maxL) {
      const s = upgradeCost(settings, p, L, L + 0.5, opts);
      if (d + s.dust > bd) { limit = 'Stardust'; break; }
      if (c + s.candy > bc) { limit = 'Candy'; break; }
      if (x + s.xl > bx) { limit = 'Candy XL'; break; }
      d += s.dust; c += s.candy; x += s.xl; L += 0.5;
    }
    return { level: L, dust: d, candy: c, xl: x, limit };
  }, [budget, from, settings, p, maxL, o.shadow, o.purified, o.lucky]); // eslint-disable-line react-hooks/exhaustive-deps

  const milestones = [30, 40, 41, 45, 50].filter((l) => l > from && l <= maxL);

  return (
    <div className="stack">
      <PageHeader title="Power-Up Cost" subtitle="Stardust, Candy and Candy XL needed to power up — with shadow, purified and lucky modifiers and a budget planner." />
      <div className="split">
        <div className="col sticky-side" style={{ gap: 16 }}>
          <Card>
            <div className="col" style={{ gap: 14 }}>
              <Field label="Pokémon (optional)" hint="Needed for special costs (e.g. Eternatus) and CP preview."><PokemonPicker value={p} onChange={setP} allowClear /></Field>
              <div className="fields">
                <Field label="From level"><Select value={from} onChange={(v) => { setFrom(v); if (to <= v) setTo(Math.min(maxL, v + 0.5)); }} options={levelOptions(maxL - 0.5)} /></Field>
                <Field label="To level"><Select value={target} onChange={setTo} options={levelOptions(maxL, Math.min(maxL, from + 0.5))} /></Field>
              </div>
              <div className="row">
                {[40, 45, 50].map((l) => <button key={l} className={`btn sm ${target === l ? 'primary' : ''}`} disabled={l <= from} onClick={() => setTo(l)}>→ L{l}</button>)}
              </div>
              <div className="col" style={{ gap: 8 }}>
                <Switch checked={o.shadow} onChange={(v) => setOpt('shadow', v)} label={`Shadow (×${settings.upgrade.shadowMult} dust & candy)`} />
                <Switch checked={o.purified} onChange={(v) => setOpt('purified', v)} label={`Purified (×${settings.upgrade.purifiedMult} dust & candy)`} />
                <Switch checked={o.lucky} onChange={(v) => setOpt('lucky', v)} label={`Lucky (×${settings.upgrade.luckyDustMult} dust)`} />
              </div>
              {p && (
                <details>
                  <summary className="small muted">IVs for CP preview ({ivs.join('/')})</summary>
                  <div style={{ marginTop: 8 }}><IvInputs value={ivs} onChange={setIvs} /></div>
                </details>
              )}
            </div>
          </Card>
          <div className="callout small">
            <b>Level 51?</b> A Best Buddy is boosted +1 level (up to 51) only while it's your buddy. Power-ups stop at level {maxL}.
          </div>
        </div>

        <div className="stack">
          <Card title={`Level ${from} → ${target}`} actions={p ? <span className="small muted">{displayName(p, o.shadow)}</span> : null}>
            <div className="stack">
              {override && <div className="callout warn small"><b>{p && displayName(p)}</b> uses special (much higher) candy costs from the game master.</div>}
              <div className="tool-tiles">
                <StatTile label="Stardust" value={fmt(total.dust)} />
                <StatTile label="Candy" value={fmt(total.candy)} sub={from < 40 ? `levels ${from}–${Math.min(40, target)}` : 'none needed'} />
                <StatTile label="Candy XL" value={fmt(total.xl)} sub={target > 40 ? `levels ${Math.max(40, from)}–${target}` : 'none needed'} />
                <StatTile label="Power-ups" value={total.steps} />
                {p && <StatTile label="CP" value={`${fmt(cp(p, settings, from, ivs))} → ${fmt(cp(p, settings, target, ivs))}`} sub={`at ${ivs.join('/')}`} />}
              </div>
              {target > 40 && <p className="tool-note">Candy XL can also be made from Rare Candy XL, or converted from {fmt(p?.candyPerXl ?? 100)} Candy each (from trainer level 31).</p>}
              {milestones.length > 0 && (
                <div className="table-wrap">
                  <table className="table compact">
                    <thead><tr><th>From L{from} to</th><th className="num">Stardust</th><th className="num">Candy</th><th className="num">Candy XL</th></tr></thead>
                    <tbody>{milestones.map((l) => { const c = upgradeCost(settings, p, from, l, opts); return (
                      <tr key={l} className="clickable" onClick={() => setTo(l)}><td>Level {l}</td><td className="num">{fmt(c.dust)}</td><td className="num">{fmt(c.candy)}</td><td className="num">{fmt(c.xl)}</td></tr>
                    ); })}</tbody>
                  </table>
                </div>
              )}
            </div>
          </Card>

          <Card title="Budget mode" footer={<span className="tool-note">Leave a field empty to treat it as unlimited.</span>}>
            <div className="stack">
              <div className="fields">
                <Field label="Stardust"><NumberInput value={budget.dust} onChange={(v) => setBudget({ ...budget, dust: v })} min={0} placeholder="unlimited" /></Field>
                <Field label="Candy"><NumberInput value={budget.candy} onChange={(v) => setBudget({ ...budget, candy: v })} min={0} placeholder="unlimited" /></Field>
                <Field label="Candy XL"><NumberInput value={budget.xl} onChange={(v) => setBudget({ ...budget, xl: v })} min={0} placeholder="unlimited" /></Field>
              </div>
              {!reach ? <p className="muted small" style={{ margin: 0 }}>Enter what you have to see how high you can go from level {from}.</p> : (
                <div className="tool-tiles">
                  <StatTile label="Max level" value={reach.level} sub={reach.level >= maxL ? 'Fully powered!' : `Limited by ${reach.limit}`} />
                  <StatTile label="Stardust used" value={fmt(reach.dust)} />
                  <StatTile label="Candy used" value={fmt(reach.candy)} />
                  <StatTile label="XL used" value={fmt(reach.xl)} />
                  {p && <StatTile label="CP there" value={fmt(cp(p, settings, reach.level, ivs))} />}
                </div>
              )}
            </div>
          </Card>

          {p && (
            <Card title="Other costs">
              <div className="grid grid-2">
                <div className="tile">
                  <div className="bold">Second Charged Attack</div>
                  {p.thirdMove ? <div className="num" style={{ marginTop: 4 }}>{fmt(p.thirdMove.dust)} Stardust · {fmt(p.thirdMove.candy)} Candy</div> : <div className="muted small">Not available</div>}
                  <div className="tool-note" style={{ marginTop: 4 }}>Base cost. Shadow Pokémon cost more and purified Pokémon less.</div>
                </div>
                <div className="tile">
                  <div className="bold">Purification</div>
                  {p.purify ? <div className="num" style={{ marginTop: 4 }}>{fmt(p.purify.dust)} Stardust · {fmt(p.purify.candy)} Candy</div> : <div className="muted small">{p.shadowReleased ? 'Unknown' : 'No shadow form released'}</div>}
                  <div className="tool-note" style={{ marginTop: 4 }}>Purified Pokémon get +2 to each IV, level 25 if lower, and cheaper power-ups.</div>
                </div>
              </div>
              <div className="row" style={{ marginTop: 12 }}>
                <Link className="btn sm" to={`/tools/cp?id=${p.id}`}>📈 CP by level</Link>
                <Link className="btn sm" to={`/tools/iv?id=${p.id}`}>🧮 IV calculator</Link>
              </div>
            </Card>
          )}

          <Card title="Per power-up" flush>
            {!steps.length ? <Empty icon="⬆️">Choose a target level above the start level.</Empty> : (
              <div className="table-wrap" style={{ maxHeight: 520 }}>
                <table className="table compact">
                  <thead><tr><th className="num">Level</th><th className="num">Stardust</th><th className="num">Candy</th><th className="num">XL</th><th className="num">Σ Stardust</th><th className="num">Σ Candy</th><th className="num">Σ XL</th></tr></thead>
                  <tbody>
                    {steps.map((s) => (
                      <tr key={s.L}>
                        <td className="num">{s.L} → {s.L + 0.5}</td>
                        <td className="num">{fmt(s.dust)}</td><td className="num">{s.candy || '—'}</td><td className="num">{s.xl || '—'}</td>
                        <td className="num muted">{fmt(s.cd)}</td><td className="num muted">{fmt(s.cc)}</td><td className="num muted">{fmt(s.cx)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
