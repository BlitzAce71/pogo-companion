import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, Empty, Field, PageHeader, PokeImg, PokemonPicker, Segmented, Select, Switch, useToast } from '../../components/ui';
import { displayName, useData } from '../../lib/data';
import { fmt } from '../../lib/format';
import {
  answerKey, attributesFromSearch, borderColor, excludedFromSearch, findRowPhase, fingerprintRegion, learnRowTemplate, loadLibrary, matchFingerprint, pageOverlap, tileRects, tileSignature, validCalibration,
  type Candidate, type Fingerprint, type GridCalibration, type TileSignature, type ScanAttributes, type SpriteLibrary, type SpriteRef,
} from '../../lib/scanner';
import { useCollection, useMyPokemon, useStored, type Collection, type SavedMon } from '../../lib/storage';
import type { GameData } from '../../lib/types';
import { findStillTimes, grabFrame, loadImagePage, loadVideo, measureScroll, thumbnail, type Page, type StillRun } from './scanFrames';
import './scanner.css';

const REVIEW_BELOW = 0.25; // confidence under this is flagged for review

interface Answer { id: string; costume?: string; shiny: boolean; female?: boolean }
interface ScanItem { uid: number; thumb: string; page: number; fp: Fingerprint; alternatives: Candidate[]; confidence: number; answer: Answer | null; edited?: boolean }
type Stage = 'setup' | 'calibrate' | 'scanning' | 'review';

const toAnswer = (r: SpriteRef): Answer => ({ id: r.id, costume: r.costume, shiny: r.shiny, female: r.female });

export default function BoxScanner() {
  const data = useData();
  const toast = useToast();
  const [stage, setStage] = useState<Stage>('setup');
  const [files, setFiles] = useState<File[]>([]);
  const [search, setSearch] = useStored<string>('scan.search', '');
  const [lib, setLib] = useState<SpriteLibrary | null>(null);
  const [libError, setLibError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Page | null>(null);
  const [cal, setCal] = useStored<GridCalibration | null>('scan.calibration', null);
  const [progress, setProgress] = useState<{ label: string; value: number }>({ label: '', value: 0 });
  const [items, setItems] = useState<ScanItem[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const abort = useRef<AbortController | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stillTimes = useRef<StillRun[]>([]);

  useEffect(() => { loadLibrary().then(setLib, (e) => setLibError(String(e.message || e))); }, []);
  useEffect(() => { document.title = 'Box Scanner · PoGo Companion'; }, []);

  const attrs = useMemo(() => attributesFromSearch(search), [search]);
  const excluded = useMemo(() => excludedFromSearch(search), [search]);
  const isVideo = files.length === 1 && files[0].type.startsWith('video/');

  // ---------------------------------------------------------------- step 1 → 2: load source, find first still page
  const start = async () => {
    if (!files.length) return;
    abort.current = new AbortController();
    setWarnings([]);
    try {
      setStage('scanning');
      if (isVideo) {
        setProgress({ label: 'Opening video…', value: 0 });
        const v = await loadVideo(files[0]);
        videoRef.current = v;
        setProgress({ label: 'Finding your pauses…', value: 0 });
        const times = await findStillTimes(v, (f) => setProgress({ label: 'Finding your pauses…', value: f }), 0.25, abort.current.signal);
        if (!times.length) throw new Error('No pauses found. Pause for about a second after each scroll so the scanner can read a still frame.');
        stillTimes.current = times;
        setPreview(await grabFrame(v, times[0].time, 0));
      } else {
        const imgs = files.filter((f) => f.type.startsWith('image/')).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
        if (!imgs.length) throw new Error('Choose a screen recording or screenshots.');
        setPreview(await loadImagePage(imgs[0], 0));
      }
      setStage('calibrate');
    } catch (e) {
      toast.show(String((e as Error).message || e));
      setStage('setup');
    }
  };

  // ---------------------------------------------------------------- step 3: scan every page
  const runScan = async () => {
    if (!lib || !validCalibration(cal) || !preview) return;
    abort.current = new AbortController();
    setStage('scanning');
    const filter = (r: SpriteRef) => {
      if (!data.byId[r.id]?.released) return false;
      if (excluded.has('shiny') && r.shiny) return false;
      if (attrs.shiny && !r.shiny) return false;
      if (excluded.has('costume') && r.costume) return false;
      if (attrs.costume && !r.costume) return false;
      return true;
    };
    const prior = (r: SpriteRef) => (data.byId[r.id]?.megaOf ? 10 : 0) + (r.costume ? 2 : 0);
    const out: ScanItem[] = [];
    const warn: string[] = [];
    const noOverlap: string[] = [];
    let prevSigs: (TileSignature | null)[] | null = null;
    let prevRowYs: number[] = [];
    const gaps: string[] = [];
    let uid = 0;
    try {
      const sources: (() => Promise<Page>)[] = isVideo
        ? stillTimes.current.map((run, i) => () => grabFrame(videoRef.current!, run.time, i))
        : files.filter((f) => f.type.startsWith('image/')).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })).map((f, i) => () => loadImagePage(f, i));
      for (let i = 0; i < sources.length; i++) {
        if (abort.current.signal.aborted) throw new Error('Cancelled');
        setProgress({ label: `Reading page ${i + 1} of ${sources.length} · ${fmt(out.length)} Pokémon so far`, value: i / sources.length });
        await new Promise((r) => setTimeout(r, 0));
        const page = await sources[i]();
        const p = page.pixels;
        const gapBg = borderColor(p, { x: Math.round(cal.x0 + cal.pitchX / 2 - 2), y: cal.top, w: 4, h: Math.max(4, cal.bottom - cal.top) });
        const phase = findRowPhase(p, cal, gapBg);
        const rects = tileRects(p, cal, phase);
        const fps = rects.map((r) => fingerprintRegion(p, r));
        const sigs = rects.map((r, k) => (fps[k] ? tileSignature(p, r, cal) : null));
        let skip = 0;
        const rowYs = rects.filter((_, k) => k % cal.columns === 0).map((r) => r.y);
        if (prevSigs && isVideo && prevRowYs.length && rowYs.length) {
          // Video: follow the scroll between the two pauses and work out geometrically which rows repeat
          setProgress({ label: `Following the scroll into page ${i + 1} of ${sources.length} · ${fmt(out.length)} Pokémon so far`, value: i / sources.length });
          const moved = await measureScroll(videoRef.current!, stillTimes.current[i - 1], stillTimes.current[i], cal, abort.current.signal);
          const lastPrev = prevRowYs[prevRowYs.length - 1], firstPrev = prevRowYs[0];
          // a row at y on this page was at y + moved on the previous one
          const repeatRows = rowYs.filter((y) => y + moved <= lastPrev + cal.pitchY / 2 && y + moved >= firstPrev - cal.pitchY / 2).length;
          skip = repeatRows * cal.columns;
          const gapRows = Math.round((rowYs[0] + moved - lastPrev) / cal.pitchY) - 1;
          if (gapRows > 0) gaps.push(`${page.label} (${gapRows} row${gapRows > 1 ? 's' : ''})`);
        } else if (prevSigs) {
          // Screenshots: recognise repeated rows by comparing tiles (incl. their printed CP)
          const ov = pageOverlap(prevSigs, sigs, cal.columns);
          skip = ov.overlap;
          if (!ov.overlap) noOverlap.push(page.label);
        }
        prevRowYs = rowYs;
        rects.forEach((r, k) => {
          if (k < skip) return;
          const f = fps[k];
          if (!f) return; // empty slot (end of the box)
          const m = matchFingerprint(lib, f, { filter, prior });
          const tw = cal.pitchX * 0.96, th = cal.pitchY * 0.96;
          out.push({
            uid: uid++, page: i, fp: f, alternatives: m.alternatives, confidence: m.confidence,
            answer: m.best ? toAnswer(m.best.ref) : null,
            thumb: thumbnail(page.canvas, r.x + r.w / 2 - tw / 2, r.y + r.h / 2 - th / 2, tw, th),
          });
        });
        prevSigs = sigs;
      }
      if (gaps.length) warn.push(`Rows were scrolled past without ever being fully on screen at ${gaps.slice(0, 8).join(', ')}${gaps.length > 8 ? '…' : ''}. Those Pokémon are missing from this scan — re-record those parts more slowly.`);
      if (noOverlap.length) warn.push(`${noOverlap.length} of ${sources.length} pages didn't repeat a row from the page before (at ${noOverlap.slice(0, 6).join(', ')}${noOverlap.length > 6 ? '…' : ''}). That's fine if you scrolled about one screen there — but if you flicked further, Pokémon in between were never on screen. Scrolling a little less than a full screen avoids this.`);
      setItems(out);
      setWarnings(warn);
      setStage('review');
    } catch (e) {
      toast.show(String((e as Error).message || e));
      if (out.length) { setItems(out); setWarnings(warn); setStage('review'); } else setStage('calibrate');
    }
  };

  return (
    <div className="stack">
      <PageHeader title="Box Scanner" subtitle="Record yourself scrolling through your Pokémon storage, and the scanner identifies every Pokémon from its picture — then adds them to My Dex and My Pokémon. Everything runs on this device; nothing is uploaded."
        actions={stage !== 'setup' && stage !== 'scanning' ? <button className="btn" onClick={() => { setStage('setup'); setItems([]); setPreview(null); }}>↺ Start over</button> : undefined} />
      {libError && <div className="callout bad">Couldn’t load the sprite library: {libError}</div>}

      {stage === 'setup' && <Setup files={files} setFiles={setFiles} search={search} setSearch={setSearch} attrs={attrs} excluded={excluded} onStart={start} ready={!!lib} />}

      {stage === 'calibrate' && preview && (
        <Calibrate page={preview} cal={cal} setCal={setCal} pages={isVideo ? stillTimes.current.length : files.length} onScan={runScan} />
      )}

      {stage === 'scanning' && (
        <Card>
          <div className="col" style={{ gap: 10 }}>
            <div className="bold">{progress.label || 'Working…'}</div>
            <div className="progress"><div style={{ width: `${Math.round(progress.value * 100)}%` }} /></div>
            <div><button className="btn sm" onClick={() => abort.current?.abort()}>Cancel</button></div>
          </div>
        </Card>
      )}

      {stage === 'review' && <Review data={data} items={items} setItems={setItems} attrs={attrs} warnings={warnings} search={search} />}
      {toast.node}
    </div>
  );
}

// ---------------------------------------------------------------- setup
function Setup({ files, setFiles, search, setSearch, attrs, excluded, onStart, ready }: {
  files: File[]; setFiles: (f: File[]) => void; search: string; setSearch: (s: string) => void; attrs: ScanAttributes; excluded: Set<string>; onStart: () => void; ready: boolean;
}) {
  const known = new Set(['lucky', 'shadow', 'purified', 'shiny', 'dynamax', 'gigantamax', 'costume', 'female', 'male', 'favorite', 'legendary', 'background', 'mythical', 'traded', 'hatched', 'evolve', 'defender', 'buddy', 'xxl', 'xxs', 'xl', 'xs', 'ultra beasts', 'shadow', '0*', '1*', '2*', '3*', '4*']);
  const typos = [...excluded, ...search.toLowerCase().split('&').map((t) => t.trim()).filter((t) => t && !t.startsWith('!'))].filter((t) => /^[a-z]+$/.test(t) && !known.has(t) && t.length > 3);
  return (
    <div className="grid grid-2">
      <Card title="1. Record your box">
        <ol className="scan-steps">
          <li>In Pokémon GO open <b>Pokémon storage</b>. Sort by <b>Number</b> so later scans line up the same way.</li>
          <li>Optionally type a search to scan one group at a time (e.g. <code>lucky</code>, <code>shiny</code>, <code>4*</code>), or leave it empty for everything.</li>
          <li>Start your phone’s <b>screen recorder</b>, scroll down <b>a little less than one screen</b> at a time, and <b>pause about a second</b> after each scroll. Keeping the last row at the top of the next screen lets the scanner stitch pages together reliably.</li>
          <li>Send the recording to this computer and choose it below. A <b>video is best</b>: the scanner follows the scroll itself, so it never double-counts or skips. Screenshots work too (select them all at once, in order), but identical neighbours can be miscounted at page edges.</li>
        </ol>
      </Card>
      <Card title="2. Choose the recording">
        <div className="col" style={{ gap: 14 }}>
          <Field label="Screen recording (MP4) or screenshots">
            <input className="input" type="file" accept="video/*,image/*" multiple onChange={(e) => setFiles([...(e.target.files || [])])} />
          </Field>
          {files.length > 0 && <div className="small muted">{files.length === 1 ? files[0].name : `${files.length} files`} · {(files.reduce((s, f) => s + f.size, 0) / 1e6).toFixed(1)} MB</div>}
          <Field label="Search string you used in the game (optional)" hint="Every Pokémon in this scan gets these attributes. Excluded terms like !shiny and !costume also make recognition more accurate.">
            <input className="input mono" placeholder="e.g. lucky   or   !shiny&!costume&!lucky" value={search} onChange={(e) => setSearch(e.target.value)} />
          </Field>
          {(Object.keys(attrs).length > 0 || excluded.size > 0) && (
            <div className="chips">
              {Object.entries(attrs).map(([k, v]) => <span key={k} className="chip on">{k === 'stars' ? `${v}★` : k}</span>)}
              {[...excluded].map((k) => <span key={k} className="chip">not {k}</span>)}
            </div>
          )}
          {typos.length > 0 && <div className="callout warn small">Not a search term the scanner knows: {typos.map((t) => <code key={t}>{t} </code>)} — check for typos (e.g. <code>lucky</code>, <code>gigantamax</code>).</div>}
          <div><button className="btn primary" disabled={!files.length || !ready} onClick={onStart}>{ready ? 'Next: line up the grid →' : 'Loading sprite library…'}</button></div>
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- calibration
function Calibrate({ page, cal, setCal, pages, onScan }: { page: Page; cal: GridCalibration | null; setCal: (c: GridCalibration | null) => void; pages: number; onScan: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [clicks, setClicks] = useState<{ x: number; y: number }[]>([]);
  const p = page.pixels;
  const usable = validCalibration(cal, p.width) ? cal : null;
  const [redo, setRedo] = useState(!usable);

  const rects = useMemo(() => {
    if (!usable) return [];
    const bg = borderColor(p, { x: Math.round(usable.x0 + usable.pitchX / 2 - 2), y: usable.top, w: 4, h: Math.max(4, usable.bottom - usable.top) });
    return tileRects(p, usable, findRowPhase(p, usable, bg));
  }, [usable, p]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    c.width = p.width; c.height = p.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(page.canvas, 0, 0);
    if (usable && !redo) {
      ctx.fillStyle = 'rgba(79,142,247,0.10)';
      ctx.fillRect(0, 0, c.width, usable.top); ctx.fillRect(0, usable.bottom, c.width, c.height - usable.bottom);
      ctx.strokeStyle = '#4f8ef7'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, usable.top); ctx.lineTo(c.width, usable.top); ctx.moveTo(0, usable.bottom); ctx.lineTo(c.width, usable.bottom); ctx.stroke();
      ctx.strokeStyle = '#3ccf8e';
      for (const r of rects) ctx.strokeRect(r.x, r.y, r.w, r.h);
    }
    ctx.fillStyle = '#f2555a';
    for (const k of clicks) { ctx.beginPath(); ctx.arc(k.x, k.y, 6, 0, Math.PI * 2); ctx.fill(); }
  }, [page, usable, rects, clicks, redo, p]);

  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!redo) return;
    const b = e.currentTarget.getBoundingClientRect();
    if (b.width < 10 || b.height < 10) return; // canvas not laid out yet
    const pt = { x: ((e.clientX - b.left) / b.width) * p.width, y: ((e.clientY - b.top) / b.height) * p.height };
    if (!Number.isFinite(pt.x) || !Number.isFinite(pt.y)) return;
    const next = [...clicks, pt];
    if (next.length < 2) { setClicks(next); return; }
    const [a, d] = next;
    const pitchX = Math.abs(d.x - a.x), pitchY = Math.abs(d.y - a.y);
    if (pitchX < 20 || pitchY < 20) { setClicks([]); return; }
    // Defaults measured from a real storage screen: big Pokémon (e.g. Charizard) fill the space from just
    // under the CP number to just above the name, so the box spans that: centre ~0.33 rows below the CP
    // number, ~0.5 rows tall, ~80% of the column width. Stars/letters poking in at the edges are ignored.
    const base: GridCalibration = {
      // the CP number sits a little right of the tile centre (the small "CP" label is on its left)
      version: 2, x0: Math.min(a.x, d.x) - pitchX * 0.04, pitchX, pitchY, y0: Math.min(a.y, d.y), boxW: 0.8, boxH: 0.5, offsetY: 0.33, columns: 3, width: p.width,
      // The first clicked CP number is in the first fully visible row, so anything above it is header /
      // search bar. Rows that scroll partly under it are skipped (they reappear on the next page).
      top: Math.max(0, Math.round(Math.min(a.y, d.y) - pitchY * 0.08)), bottom: Math.round(p.height * 0.88),
    };
    setCal({ ...base, rowTemplate: learnRowTemplate(p, base) });
    setClicks([]);
    setRedo(false);
  };
  // Changing the scroll area or columns changes what the row pattern covers, so relearn it on this frame
  const patch = (x: Partial<GridCalibration>) => { if (!usable) return; const next = { ...usable, ...x }; setCal({ ...next, rowTemplate: learnRowTemplate(p, next) }); };

  return (
    <div className="split">
      <Card title="3. Line up the grid" className="sticky-side">
        {redo ? (
          <div className="col" style={{ gap: 10 }}>
            <p className="small">Click the <b>CP number of the first Pokémon</b> (top-left), then the <b>CP number of the Pokémon one row down and one column right</b>. This tells the scanner your screen’s grid spacing. It’s remembered for next time.</p>
            <div className="badge accent">{clicks.length === 0 ? 'Click the first CP number' : 'Now click the CP number diagonally below-right'}</div>
            {usable && <button className="btn sm" onClick={() => { setRedo(false); setClicks([]); }}>Keep previous calibration</button>}
          </div>
        ) : usable && (
          <div className="col" style={{ gap: 12 }}>
            <p className="small muted">Each green box should cover the space between the CP number and the name — big Pokémon should fit inside, and the box shouldn’t touch the name. Blue lines mark the scrolling area — move them to exclude the search bar and bottom buttons. Name letters and favourite stars that poke into a box are ignored.</p>
            <Field label={`Top of scroll area · ${Math.round(usable.top)}px`}><input type="range" min={0} max={p.height / 2} value={usable.top} onChange={(e) => patch({ top: Number(e.target.value) })} /></Field>
            <Field label={`Bottom of scroll area · ${Math.round(usable.bottom)}px`}><input type="range" min={p.height / 2} max={p.height} value={usable.bottom} onChange={(e) => patch({ bottom: Number(e.target.value) })} /></Field>
            <Field label="Move boxes up / down"><input type="range" min={0.1} max={0.65} step={0.005} value={usable.offsetY} onChange={(e) => patch({ offsetY: Number(e.target.value) })} /></Field>
            <Field label="Picture box width"><input type="range" min={0.3} max={0.95} step={0.01} value={usable.boxW} onChange={(e) => patch({ boxW: Number(e.target.value) })} /></Field>
            <Field label="Picture box height"><input type="range" min={0.25} max={0.9} step={0.01} value={usable.boxH} onChange={(e) => patch({ boxH: Number(e.target.value) })} /></Field>
            <Field label="Columns"><Segmented size="sm" value={usable.columns} onChange={(v) => patch({ columns: v })} options={[{ id: 3, label: '3' }, { id: 4, label: '4' }]} /></Field>
            <div className="row">
              <button className="btn sm" onClick={() => setRedo(true)}>Redo clicks</button>
              <span className="small faint">{rects.length} tiles on this page · {fmt(pages)} {pages === 1 ? 'page' : 'pages'}</span>
            </div>
            <button className="btn primary" disabled={!rects.length} onClick={onScan}>Scan {fmt(pages)} {pages === 1 ? 'page' : 'pages'} →</button>
          </div>
        )}
      </Card>
      <Card flush>
        <div className="scan-preview"><canvas ref={canvasRef} onClick={onClick} style={{ cursor: redo ? 'crosshair' : 'default' }} /></div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- review & import
function answerName(data: GameData, a: Answer | null): string {
  if (!a) return 'Unknown';
  const p = data.byId[a.id];
  if (!p) return a.id;
  const c = a.costume ? data.costumeById[a.costume] : null;
  return `${a.shiny ? '✦ ' : ''}${displayName(p)}${c ? ` · ${c.name}` : ''}`;
}
function AnswerSprite({ data, a, size = 44 }: { data: GameData; a: Answer | null; size?: number }) {
  if (!a || !data.byId[a.id]) return <span className="scan-unknown" style={{ width: size, height: size }}>?</span>;
  const c = a.costume ? data.costumeById[a.costume] : null;
  return <PokeImg p={c ?? data.byId[a.id]} shiny={a.shiny} size={size} />;
}

function Review({ data, items, setItems, attrs, warnings, search }: { data: GameData; items: ScanItem[]; setItems: (f: (x: ScanItem[]) => ScanItem[]) => void; attrs: ScanAttributes; warnings: string[]; search: string }) {
  const [filter, setFilter] = useState<'review' | 'all' | 'summary'>(items.some((i) => i.confidence < REVIEW_BELOW) ? 'review' : 'all');
  const [editing, setEditing] = useState<ScanItem | null>(null);
  const [limit, setLimit] = useState(240);
  const needs = items.filter((i) => !i.edited && (i.confidence < REVIEW_BELOW || !i.answer));
  const shown = filter === 'review' ? needs : items;
  const update = (uid: number, answer: Answer | null) => setItems((list) => list.map((i) => (i.uid === uid ? { ...i, answer, edited: true } : i)));
  const remove = (uid: number) => setItems((list) => list.filter((i) => i.uid !== uid));
  const summary = useMemo(() => {
    const m = new Map<string, { a: Answer; n: number }>();
    for (const i of items) if (i.answer) { const k = `${i.answer.id}|${i.answer.costume || ''}|${i.answer.shiny}`; const e = m.get(k); if (e) e.n++; else m.set(k, { a: i.answer, n: 1 }); }
    return [...m.values()].sort((x, y) => (data.byId[x.a.id]?.dex ?? 0) - (data.byId[y.a.id]?.dex ?? 0));
  }, [items, data.byId]);

  return (
    <div className="stack">
      <div className="grid grid-4">
        <div className="stat-tile"><div className="label">Pokémon found</div><div className="value">{fmt(items.length)}</div></div>
        <div className="stat-tile"><div className="label">Confident</div><div className="value">{fmt(items.length - needs.length)}</div><div className="sub">{items.length ? Math.round(((items.length - needs.length) / items.length) * 100) : 0}%</div></div>
        <div className="stat-tile"><div className="label">Needs a look</div><div className="value" style={{ color: needs.length ? 'var(--warn)' : undefined }}>{fmt(needs.length)}</div></div>
        <div className="stat-tile"><div className="label">Different Pokémon</div><div className="value">{fmt(summary.length)}</div></div>
      </div>
      {warnings.length > 0 && <div className="callout warn small"><b>Check these pages:</b><ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{warnings.slice(0, 8).map((w) => <li key={w}>{w}</li>)}{warnings.length > 8 && <li>…and {warnings.length - 8} more</li>}</ul></div>}

      <Card title="Review" actions={<Segmented size="sm" value={filter} onChange={(v) => { setFilter(v); setLimit(240); }} options={[{ id: 'review', label: `Needs a look (${needs.length})` }, { id: 'all', label: `All (${items.length})` }, { id: 'summary', label: 'Summary' }]} />}
        footer="Each card shows the cut-out from your recording (left) and the scanner’s answer (right). Click a card to fix it.">
        {filter === 'summary' ? (
          <div className="scan-summary">
            {summary.map(({ a, n }) => <div key={`${a.id}${a.costume}${a.shiny}`} className="scan-sum-row"><AnswerSprite data={data} a={a} size={32} /><span style={{ flex: 1 }}>{answerName(data, a)}</span><b className="num">×{n}</b></div>)}
          </div>
        ) : shown.length === 0 ? <Empty icon="✅">{filter === 'review' ? 'Nothing left to check.' : 'No Pokémon found.'}</Empty> : (
          <>
            <div className="scan-grid">
              {shown.slice(0, limit).map((i) => (
                <button key={i.uid} className={`scan-card ${!i.edited && i.confidence < REVIEW_BELOW ? 'low' : ''} ${i.edited ? 'edited' : ''}`} onClick={() => setEditing(i)} title={`Page ${i.page + 1} · confidence ${Math.round(i.confidence * 100)}%`}>
                  <img src={i.thumb} alt="" />
                  <span className="arrow">→</span>
                  <AnswerSprite data={data} a={i.answer} />
                  <span className="nm">{answerName(data, i.answer)}</span>
                </button>
              ))}
            </div>
            {shown.length > limit && <div className="center" style={{ padding: 12 }}><button className="btn" onClick={() => setLimit((l) => l + 480)}>Show more ({fmt(shown.length - limit)})</button></div>}
          </>
        )}
      </Card>

      <ImportCard data={data} items={items} attrs={attrs} search={search} />
      {editing && <EditDialog data={data} item={editing} onClose={() => setEditing(null)} onSave={(a) => { update(editing.uid, a); setEditing(null); }} onRemove={() => { remove(editing.uid); setEditing(null); }} />}
    </div>
  );
}

function EditDialog({ data, item, onClose, onSave, onRemove }: { data: GameData; item: ScanItem; onClose: () => void; onSave: (a: Answer) => void; onRemove: () => void }) {
  const [a, setA] = useState<Answer | null>(item.answer);
  const p = a ? data.byId[a.id] : null;
  const costumes = p ? data.costumesFor(p.id) : [];
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-label="Fix this Pokémon">
        <div className="card-head"><h2>Which Pokémon is this?</h2><button className="btn ghost icon" onClick={onClose} aria-label="Close">✕</button></div>
        <div className="card-body col" style={{ gap: 14 }}>
          <div className="row" style={{ gap: 16 }}>
            <img src={item.thumb} alt="" style={{ width: 110, borderRadius: 10, border: '1px solid var(--border)' }} />
            <span className="faint">→</span>
            <AnswerSprite data={data} a={a} size={80} />
            <b>{answerName(data, a)}</b>
          </div>
          <div>
            <div className="field-label" style={{ marginBottom: 6 }}>Closest matches</div>
            <div className="row" style={{ gap: 6 }}>
              {item.alternatives.map((c) => {
                const ans = toAnswer(c.ref);
                const on = a && answerKey({ ...ans, aspect: 0 }) === answerKey({ ...a, aspect: 0 });
                return <button key={c.index} className={`scan-alt ${on ? 'on' : ''}`} onClick={() => setA(ans)} title={answerName(data, ans)}><AnswerSprite data={data} a={ans} size={48} /><span className="tiny">{answerName(data, ans)}</span></button>;
              })}
            </div>
          </div>
          <Field label="Or pick any Pokémon"><PokemonPicker value={p} onChange={(np) => np && setA({ id: np.id, shiny: a?.shiny ?? false })} /></Field>
          {p && (
            <div className="row" style={{ gap: 18 }}>
              <Switch checked={!!a?.shiny} onChange={(v) => a && setA({ ...a, shiny: v })} label="Shiny" />
              {costumes.length > 0 && <Select value={a?.costume || ''} onChange={(v) => a && setA({ ...a, costume: v || undefined })} options={[{ id: '', label: 'No costume' }, ...costumes.map((c) => ({ id: c.id, label: c.name }))]} style={{ maxWidth: 260 }} />}
            </div>
          )}
        </div>
        <div className="card-foot row" style={{ justifyContent: 'space-between' }}>
          <button className="btn danger" onClick={onRemove}>Not a Pokémon / remove</button>
          <button className="btn primary" disabled={!a} onClick={() => a && onSave(a)}>Save</button>
        </div>
      </div>
    </div>
  );
}

function ImportCard({ data, items, attrs, search }: { data: GameData; items: ScanItem[]; attrs: ScanAttributes; search: string }) {
  const { collection, setAll } = useCollection();
  const { mons, setAll: setMons } = useMyPokemon();
  const toast = useToast();
  const [toDex, setToDex] = useState(true);
  const [toMons, setToMons] = useState<'add' | 'merge' | 'none'>('add');
  const [tag, setTag] = useState(() => `scan ${new Date().toISOString().slice(0, 10)}`);
  const [done, setDone] = useState<string | null>(null);
  const answered = items.filter((i) => i.answer);
  const unsure = items.filter((i) => !i.edited && i.confidence < REVIEW_BELOW).length;

  const run = () => {
    let dexMarks = 0, added = 0, merged = 0;
    if (toDex) {
      const next: Collection = { ...collection };
      const mark = (key: string, flags: string[]) => {
        const e = { ...(next[key] || {}) } as Record<string, 1>;
        for (const f of ['caught', ...flags]) if (!e[f]) { e[f] = 1; dexMarks++; }
        next[key] = e;
      };
      for (const i of answered) {
        const a = i.answer!;
        const flags: string[] = [];
        if (a.shiny) flags.push('shiny');
        if (attrs.lucky) flags.push('lucky');
        if (attrs.shadow) flags.push('shadow');
        if (attrs.purified) flags.push('purified');
        if (attrs.dynamax) flags.push('dynamax');
        if (attrs.gigantamax) flags.push('gigantamax');
        if (attrs.stars === 4) flags.push(a.shiny ? 'shundo' : 'hundo');
        mark(a.costume || a.id, flags.filter((f) => !a.costume || f === 'shiny' || f === 'lucky' || f === 'hundo'));
        if (a.costume) mark(a.id, []); // a costume also registers the species
      }
      setAll(next);
    }
    if (toMons !== 'none') {
      const tags = [tag.trim(), ...(attrs.female ? ['female'] : []), ...(attrs.male ? ['male'] : []), ...(attrs.dynamax ? ['dynamax'] : []), ...(attrs.gigantamax ? ['gigantamax'] : []), ...(attrs.stars !== undefined ? [`${attrs.stars}*`] : [])].filter(Boolean);
      const list = [...mons];
      const now = Date.now();
      const makeNew = (a: Answer): SavedMon => ({
        uid: Math.random().toString(36).slice(2, 10), id: a.id, shiny: a.shiny || undefined,
        lucky: attrs.lucky || undefined, shadow: attrs.shadow || undefined, purified: attrs.purified || undefined,
        ivs: attrs.stars === 4 ? [15, 15, 15] : undefined,
        nickname: a.costume ? data.costumeById[a.costume]?.name : undefined,
        tags: [...tags, ...(a.female ? ['female'] : []), ...(a.costume ? ['costume'] : [])], notes: search ? `Scanned with search: ${search}` : undefined, added: now,
      });
      if (toMons === 'add') {
        for (const i of answered) { list.push(makeNew(i.answer!)); added++; }
      } else {
        // Count-matched merge: apply this scan's attributes to existing saved Pokémon of the same species
        const used = new Set<string>();
        for (const i of answered) {
          const a = i.answer!;
          const target = list.find((m) => !used.has(m.uid) && m.id === a.id && !!m.shiny === a.shiny && (!attrs.lucky || !m.lucky) && (!attrs.shadow || !m.shadow));
          if (!target) { list.push(makeNew(a)); added++; continue; }
          used.add(target.uid);
          Object.assign(target, {
            lucky: target.lucky || attrs.lucky || undefined, shadow: target.shadow || attrs.shadow || undefined, purified: target.purified || attrs.purified || undefined,
            ivs: attrs.stars === 4 ? [15, 15, 15] : target.ivs, tags: [...new Set([...(target.tags || []), ...tags])],
          });
          merged++;
        }
      }
      setMons(list);
    }
    const msg = [toDex && `${fmt(dexMarks)} My Dex marks`, added && `${fmt(added)} Pokémon added`, merged && `${fmt(merged)} updated`].filter(Boolean).join(' · ');
    setDone(msg || 'Nothing to import');
    toast.show('Imported');
  };

  return (
    <Card title="Import">
      <div className="col" style={{ gap: 12 }}>
        {unsure > 0 && <div className="callout warn small">{fmt(unsure)} Pokémon still need a look. You can import now and fix them later, but checking them first keeps your collection accurate.</div>}
        <Switch checked={toDex} onChange={setToDex} label={<>Mark them in <Link to="/collection">My Dex</Link> (caught{Object.keys(attrs).length ? ` + ${Object.keys(attrs).join(', ')}` : ''}, shiny and costumes as seen)</>} />
        <Field label={<>Add to <Link to="/collection/mons">My Pokémon</Link></>}>
          <Segmented size="sm" value={toMons} onChange={setToMons} options={[{ id: 'add', label: 'Add as new' }, { id: 'merge', label: 'Update existing first' }, { id: 'none', label: 'Don’t add' }]} />
        </Field>
        {toMons === 'merge' && <p className="small muted">For attribute scans (e.g. a <code>lucky</code> or <code>4*</code> search): each scanned Pokémon updates one saved Pokémon of the same species that doesn’t have the attribute yet; extras are added as new. Which individual gets it can’t be known without CP, so this is right by count.</p>}
        {toMons !== 'none' && <Field label="Tag" hint="Added to every imported Pokémon so you can filter or undo this scan later."><input className="input" value={tag} onChange={(e) => setTag(e.target.value)} style={{ maxWidth: 260 }} /></Field>}
        <div className="row"><button className="btn primary" disabled={!answered.length} onClick={run}>Import {fmt(answered.length)} Pokémon</button>{done && <span className="small good">✓ {done}</span>}</div>
      </div>
      {toast.node}
    </Card>
  );
}
