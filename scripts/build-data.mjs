#!/usr/bin/env node
/**
 * Data pipeline for PoGo Companion.
 *
 * Downloads the latest game data from public community sources and compiles
 * it into compact JSON files the app loads at runtime:
 *
 *   - PokeMiners game master       (stats, moves, costs, evolutions, settings)
 *   - PokeMiners i18n text          (English names, Pokédex entries, medals)
 *   - PokeMiners asset tree         (which sprite files exist)
 *   - PvPoke game master + rankings (release flags, shadow availability, PvP rankings)
 *   - ScrapedDuck (Leek Duck)       (snapshot of events/raids/research/eggs/rockets)
 *
 * Usage:  node scripts/build-data.mjs [--offline]
 *   --offline   reuse files in .cache/ instead of downloading
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, '.cache');
const OUT = path.join(ROOT, 'public', 'data');
const OFFLINE = process.argv.includes('--offline');
fs.mkdirSync(CACHE, { recursive: true });
fs.mkdirSync(path.join(OUT, 'live'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'rankings'), { recursive: true });

const SRC = {
  gm: 'https://raw.githubusercontent.com/PokeMiners/game_masters/master/latest/latest.json',
  i18n: 'https://raw.githubusercontent.com/PokeMiners/pogo_assets/master/Texts/Latest%20APK/JSON/i18n_english.json',
  remoteText: 'https://raw.githubusercontent.com/PokeMiners/pogo_assets/master/Texts/Latest%20Remote/English.txt',
  pvpoke: 'https://raw.githubusercontent.com/pvpoke/pvpoke/master/src/data/gamemaster.json',
  pvpokeRank: (cup, cat, cp) => `https://raw.githubusercontent.com/pvpoke/pvpoke/master/src/data/rankings/${cup}/${cat}/rankings-${cp}.json`,
  assetsDir: 'https://api.github.com/repos/PokeMiners/pogo_assets/contents/Images/Pokemon',
  scrapedDuck: (f) => `https://raw.githubusercontent.com/bigfoott/ScrapedDuck/data/${f}.json`,
};

async function fetchCached(name, url, { json = true, optional = false } = {}) {
  const file = path.join(CACHE, name);
  if (!(OFFLINE && fs.existsSync(file))) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'pogo-companion-data-builder' } });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      console.log(`  ↓ ${name}`);
    } catch (e) {
      if (fs.existsSync(file)) console.warn(`  ! ${name}: ${e.message} (using cache)`);
      else if (optional) { console.warn(`  ! ${name}: ${e.message} (skipped)`); return null; }
      else throw new Error(`Failed to download ${url}: ${e.message}`);
    }
  }
  const text = fs.readFileSync(file, 'utf8');
  return json ? JSON.parse(text) : text;
}

const write = (rel, data) => {
  const file = path.join(OUT, rel);
  fs.writeFileSync(file, JSON.stringify(data));
  console.log(`  → ${rel} (${(fs.statSync(file).size / 1024).toFixed(0)} KB)`);
};

// ---------------------------------------------------------------- helpers
const TYPES = ['normal', 'fighting', 'flying', 'poison', 'ground', 'rock', 'bug', 'ghost', 'steel', 'fire', 'water', 'grass', 'electric', 'psychic', 'ice', 'dragon', 'dark', 'fairy'];
const typeOf = (t) => (t ? t.replace('POKEMON_TYPE_', '').toLowerCase() : null);
const titleCase = (s) => s.toLowerCase().split(/[_\s]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
const GENS = [[1, 151], [152, 251], [252, 386], [387, 493], [494, 649], [650, 721], [722, 809], [810, 905], [906, 1025]];
const genOf = (dex) => { const i = GENS.findIndex(([a, b]) => dex >= a && dex <= b); return i < 0 ? 0 : i + 1; };
const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

// Regional form labels used in the UI and to match PvPoke ids
const FORM_LABEL = {
  ALOLA: 'Alolan', GALARIAN: 'Galarian', HISUIAN: 'Hisuian', PALDEA: 'Paldean',
  PALDEA_COMBAT: 'Paldean Combat', PALDEA_BLAZE: 'Paldean Blaze', PALDEA_AQUA: 'Paldean Aqua',
};

async function main() {
  console.log('Downloading sources…');
  const gm = await fetchCached('gm.json', SRC.gm);
  const i18nRaw = await fetchCached('i18n_en.json', SRC.i18n);
  const remoteText = await fetchCached('remote_en.txt', SRC.remoteText, { json: false, optional: true });
  const pvp = await fetchCached('pvpoke_gm.json', SRC.pvpoke);

  // ------------------------------------------------------------ text
  const T = new Map();
  for (let i = 0; i < i18nRaw.data.length; i += 2) T.set(i18nRaw.data[i], i18nRaw.data[i + 1]);
  if (remoteText) {
    const re = /RESOURCE ID: (.+)\r?\nTEXT: (.*)/g; let m;
    while ((m = re.exec(remoteText))) T.set(m[1].trim(), m[2].trim());
  }
  const t = (k) => T.get(k);

  // ------------------------------------------------------------ asset list
  let assetFiles = new Set();
  try {
    const listing = await fetchCached('assets_dir.json', SRC.assetsDir);
    const aa = listing.find((x) => x.name === 'Addressable Assets');
    const tree = await fetchCached('assets_tree.json', `https://api.github.com/repos/PokeMiners/pogo_assets/git/trees/${aa.sha}`);
    assetFiles = new Set(tree.tree.map((x) => x.path));
  } catch (e) { console.warn('  ! asset listing unavailable:', e.message); }

  // ------------------------------------------------------------ index GM
  const byKey = {};
  for (const e of gm) {
    const k = Object.keys(e.data).find((x) => x !== 'templateId');
    (byKey[k] ||= []).push(e.data);
  }
  const one = (k) => byKey[k]?.[0]?.[k];

  // ------------------------------------------------------------ moves
  console.log('Compiling moves…');
  const moves = {};
  const moveNum = {};
  for (const d of byKey.moveSettings || []) {
    const s = d.moveSettings;
    const tm = d.templateId.match(/^V(\d{4})_MOVE_(.+)$/);
    const id = tm ? tm[2] : String(s.movementId);
    if (tm) moveNum[id] = tm[1];
    const isFast = id.endsWith('_FAST');
    let name = tm ? t(`move_name_${tm[1]}`) : null;
    if (!name && s.vfxName) name = titleCase(s.vfxName.replace(/_fast$/, ''));
    if (!name) name = titleCase(id.replace(/_FAST$/, ''));
    moves[id] = {
      id, name, type: typeOf(s.pokemonType), fast: isFast,
      pve: {
        power: s.power || 0,
        energy: Math.abs(s.energyDelta || 0),
        duration: s.durationMs || 0,
        dws: s.damageWindowStartMs || 0,
      },
      pvp: null,
      max: /^VN_BM_/.test(id) || undefined,
    };
  }
  for (const d of byKey.combatMove || []) {
    const c = d.combatMove;
    const tm = d.templateId.match(/^COMBAT_V\d{4}_MOVE_(.+)$/);
    const id = tm ? tm[1] : String(c.uniqueId);
    const m = moves[id] || (moves[id] = { id, name: titleCase(id.replace(/_FAST$/, '')), type: typeOf(c.type), fast: id.endsWith('_FAST'), pve: null, pvp: null });
    const pv = { power: c.power || 0, energy: Math.abs(c.energyDelta || 0), turns: (c.durationTurns || 0) + 1 };
    if (c.buffs) {
      const b = c.buffs;
      pv.buffs = {
        chance: b.buffActivationChance,
        selfAtk: b.attackerAttackStatStageChange || 0,
        selfDef: b.attackerDefenseStatStageChange || 0,
        oppAtk: b.targetAttackStatStageChange || 0,
        oppDef: b.targetDefenseStatStageChange || 0,
      };
    }
    m.pvp = pv;
  }
  // Shadow-specific moves
  for (const id of ['FRUSTRATION', 'RETURN']) if (moves[id]) moves[id].special = id === 'FRUSTRATION' ? 'shadow' : 'purified';

  // PvPoke move id → our id
  const pvpMoveMap = {};
  const nameIdx = {};
  for (const m of Object.values(moves)) nameIdx[m.name.toLowerCase().replace(/[^a-z0-9]/g, '') + (m.fast ? 'F' : 'C')] = m.id;
  for (const pm of pvp.moves) {
    const isFast = pm.energyGain > 0 || pm.energy === 0;
    let id = null;
    if (isFast && moves[pm.moveId + '_FAST']) id = pm.moveId + '_FAST';
    else if (moves[pm.moveId]) id = pm.moveId;
    else id = nameIdx[pm.name.toLowerCase().replace(/[^a-z0-9]/g, '') + (isFast ? 'F' : 'C')] || null;
    if (id) pvpMoveMap[pm.moveId] = id;
  }
  // PvPoke tracks Trainer Battle balance changes faster than the public game master dumps,
  // so its PvP move values take precedence when the two disagree.
  let pvpOverrides = 0;
  for (const pm of pvp.moves) {
    const id = pvpMoveMap[pm.moveId];
    if (!id || !moves[id]) continue;
    const isFast = moves[id].fast;
    const next = { power: pm.power || 0, energy: isFast ? pm.energyGain || 0 : pm.energy || 0, turns: isFast ? pm.turns || Math.max(1, Math.round((pm.cooldown || 500) / 500)) : 1 };
    const self = pm.buffsSelf || (pm.buffTarget === 'self' ? pm.buffs : null);
    const opp = pm.buffsOpponent || (pm.buffTarget === 'opponent' ? pm.buffs : null);
    if (self || opp) next.buffs = { chance: Number(pm.buffApplyChance ?? 1), selfAtk: self?.[0] || 0, selfDef: self?.[1] || 0, oppAtk: opp?.[0] || 0, oppDef: opp?.[1] || 0 };
    const cur = moves[id].pvp;
    if (!cur || JSON.stringify(cur) !== JSON.stringify(next)) { moves[id].pvp = next; pvpOverrides++; }
  }
  console.log(`  PvP move values updated from PvPoke: ${pvpOverrides}`);

  // ------------------------------------------------------------ forms/costumes
  const costumeForms = new Set();
  const costumeSpecies = {};
  const formAssets = {};
  for (const d of byKey.formSettings || []) {
    for (const f of d.formSettings.forms || []) {
      if (f.isCostume) { costumeForms.add(f.form); costumeSpecies[f.form] = d.formSettings.pokemon; }
      if (f.assetBundleSuffix) formAssets[f.form] = f.assetBundleSuffix;
    }
  }
  const extended = {};
  for (const d of byKey.pokemonExtendedSettings || []) {
    const s = d.pokemonExtendedSettings;
    extended[s.form || s.uniqueId] = s;
    if (!extended[s.uniqueId]) extended[s.uniqueId] = s;
  }
  const families = {};
  for (const d of byKey.pokemonFamily || []) families[d.pokemonFamily.familyId] = d.pokemonFamily;

  // ------------------------------------------------------------ evolution quests
  const evoQuests = {};
  for (const d of byKey.evolutionQuestTemplate || []) {
    const q = d.evolutionQuestTemplate;
    const target = q.goals?.[0]?.target ?? '';
    let text = t(q.display?.description) || t(q.display?.title) || titleCase(q.questType.replace('QUEST_', ''));
    text = text.replace(/\{0\}/g, target).replace(/<[^>]+>/g, '');
    evoQuests[q.questTemplateId] = text;
  }

  // ------------------------------------------------------------ items
  const itemName = (id) => {
    if (!id) return null;
    const k = id.toLowerCase();
    return t(`${k}_name`) || t(k.replace(/^item_/, 'item_') + '_name') || titleCase(id.replace(/^ITEM_/, ''));
  };

  // ------------------------------------------------------------ PvPoke index
  const pvpByDex = {};
  for (const p of pvp.pokemon) (pvpByDex[p.dex] ||= []).push(p);

  // ------------------------------------------------------------ pokemon
  console.log('Compiling Pokémon…');
  const raw = (byKey.pokemonSettings || []).map((d) => ({ tid: d.templateId, s: d.pokemonSettings }));
  // group by species
  const species = {};
  for (const r of raw) (species[r.s.pokemonId] ||= []).push(r);

  const out = [];
  const usedIds = new Set();
  const numToMove = Object.fromEntries(Object.entries(moveNum).map(([id, n]) => [Number(n), id]));
  const moveset = (list) => [...new Set((list || []).map((m) => (typeof m === 'number' ? numToMove[m] : m)).filter(Boolean))];

  const imgFor = (dex, formSuffix, kind = 'f') => {
    const base = `pm${dex}`;
    if (formSuffix) {
      const cand = `${base}.${kind}${formSuffix}`;
      if (assetFiles.has(`${cand}.icon.png`)) return cand;
      if (!assetFiles.size) return cand;
    }
    return base;
  };

  const sig = (s) => JSON.stringify([s.type, s.type2, s.stats, [...(s.quickMoves || [])].sort(), [...(s.cinematicMoves || [])].sort(), s.eliteQuickMove, s.eliteCinematicMove]);

  for (const [pid, entries] of Object.entries(species)) {
    const dex = Number(entries[0].tid.slice(1, 5));
    // Drop costume forms and formless duplicates when explicit forms exist
    let list = entries.filter((e) => !costumeForms.has(e.s.form));
    const hasForms = list.some((e) => e.s.form);
    if (hasForms) list = list.filter((e) => e.s.form);
    // Collapse cosmetic forms (identical stats/types/moves) — keep NORMAL or first
    const groups = new Map();
    for (const e of list) {
      const k = sig(e.s);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(e);
    }
    for (const g of groups.values()) {
      g.sort((a, b) => (/_NORMAL$/.test(b.s.form || '') ? 1 : 0) - (/_NORMAL$/.test(a.s.form || '') ? 1 : 0));
      const e = g[0];
      const s = e.s;
      const formFull = s.form || null;
      let formSuffix = formFull ? formFull.replace(new RegExp(`^${pid}_?`), '') : null;
      if (formSuffix === 'NORMAL' || formSuffix === '' || /(^|_)NORMAL$/.test(formFull || '')) formSuffix = null;
      // A species whose forms are all mechanically identical is shown as one entry
      if (groups.size === 1) formSuffix = null;
      // Skip odd technical forms
      if (formSuffix && /(_COPY_|COPY_20|_NOEVOLVE$|^S$|_S$)/.test(formSuffix)) continue;
      const id = formSuffix ? `${pid}_${formSuffix}` : pid;
      if (usedIds.has(id)) continue;
      usedIds.add(id);

      const types = [typeOf(s.type), typeOf(s.type2)].filter(Boolean);
      const stats = { atk: s.stats?.baseAttack || 0, def: s.stats?.baseDefense || 0, sta: s.stats?.baseStamina || 0 };
      if (!stats.atk) continue;

      const nameBase = t(`pokemon_name_${String(dex).padStart(4, '0')}`) || titleCase(pid);
      const formKey = formSuffix ? `form_${formSuffix.toLowerCase()}` : null;
      let formName = formSuffix ? (FORM_LABEL[formSuffix] || t(`form_${pid.toLowerCase()}_${formSuffix.toLowerCase()}`) || (TYPES.includes(formSuffix.toLowerCase()) ? titleCase(formSuffix) : null) || t(formKey) || titleCase(formSuffix)) : null;
      if (formName && formName.toLowerCase() === 'normal') formName = null;

      // PvPoke match: same dex + stats + types, non shadow/mega
      const candidates = (pvpByDex[dex] || []).filter((p) => !p.tags?.includes('shadow') && !p.tags?.includes('mega') && !/_mega|_primal|_shadow/.test(p.speciesId));
      const SUF = { ALOLA: 'alolan', GALARIAN: 'galarian', HISUIAN: 'hisuian', PALDEA: 'paldean' };
      const expected = (pid.toLowerCase() + (formSuffix ? '_' + formSuffix.split('_').map((x) => SUF[x] || x.toLowerCase()).join('_') : ''));
      const tries = [
        candidates.find((p) => p.speciesId === expected),
        candidates.find((p) => p.speciesId === expected.replace(/_(standard|ordinary|altered|incarnate|land|aria|average|shield|plant|overcast|east_sea|midday|amped|full_belly|hero|single_strike|baile|red_striped|confined|zero)$/, '')),
        candidates.find((p) => p.baseStats.atk === stats.atk && p.baseStats.def === stats.def && p.baseStats.hp === stats.sta && p.types.filter((x) => x !== 'none').join() === types.join()),
        candidates.find((p) => p.baseStats.atk === stats.atk && p.baseStats.def === stats.def && p.baseStats.hp === stats.sta),
        candidates.length === 1 && !formSuffix ? candidates[0] : null,
      ];
      const match = tries.find((x) => x && x.released !== false) || tries.find(Boolean);

      const evolutions = [];
      for (const b of s.evolutionBranch || []) {
        if (b.temporaryEvolution) continue;
        const evo = { to: b.evolution, form: b.form || null, candy: b.candyCost || 0 };
        if (b.candyCostPurified) evo.candyPurified = b.candyCostPurified;
        if (b.evolutionItemRequirement) { evo.item = itemName(b.evolutionItemRequirement); evo.itemId = b.evolutionItemRequirement; }
        if (b.evolutionItemRequirementCost) evo.itemCost = b.evolutionItemRequirementCost;
        if (b.lureItemRequirement) evo.lure = itemName(b.lureItemRequirement);
        if (b.kmBuddyDistanceRequirement) evo.buddyKm = b.kmBuddyDistanceRequirement;
        if (b.mustBeBuddy) evo.mustBeBuddy = true;
        if (b.onlyDaytime) evo.time = 'Day';
        if (b.onlyNighttime) evo.time = 'Night';
        if (b.onlyDuskPeriod) evo.time = 'Dusk';
        if (b.onlyFullMoon) evo.time = 'Full moon';
        if (b.onlyUpsideDown) evo.upsideDown = true;
        if (b.genderRequirement) evo.gender = b.genderRequirement === 'FEMALE' ? 'Female' : 'Male';
        if (b.noCandyCostViaTrade) evo.tradeFree = true;
        if (b.evolutionMoveRequirement) evo.move = b.evolutionMoveRequirement;
        if (b.questDisplay?.length) evo.quest = b.questDisplay.map((q) => evoQuests[q.questRequirementTemplateId] || q.questRequirementTemplateId).join('; ');
        evolutions.push(evo);
      }

      const ext = extended[formFull] || extended[pid];
      const size = ext?.sizeSettings ? {
        xxs: ext.sizeSettings.xxsLowerBound, xs: ext.sizeSettings.xsLowerBound, mLo: ext.sizeSettings.mLowerBound,
        mHi: ext.sizeSettings.mUpperBound, xl: ext.sizeSettings.xlUpperBound, xxl: ext.sizeSettings.xxlUpperBound,
      } : null;
      const dynamaxVisual = ext?.breadOverrides?.some((o) => o.breadMode === 'BREAD_MODE');
      const gmaxVisual = ext?.breadOverrides?.some((o) => o.breadMode === 'BREAD_DOUGH_MODE');

      const cls = s.pokemonClass ? s.pokemonClass.replace('POKEMON_CLASS_', '').toLowerCase() : null;
      const img = imgFor(dex, formSuffix);
      const entry = {
        id, dex, speciesId: pid, name: nameBase, form: formSuffix, formName,
        types, ...stats,
        fast: moveset(s.quickMoves), charged: moveset(s.cinematicMoves),
        eliteFast: moveset(s.eliteQuickMove), eliteCharged: moveset(s.eliteCinematicMove),
        family: s.familyId, parent: s.parentPokemonId || null, parentForm: null,
        evolutions,
        buddyKm: s.kmBuddyDistance || 0, buddySize: s.buddySize ? s.buddySize.replace('BUDDY_', '').toLowerCase() : null,
        thirdMove: s.thirdMove ? { dust: s.thirdMove.stardustToUnlock || 0, candy: s.thirdMove.candyToUnlock || 0 } : null,
        purify: s.shadow ? { dust: s.shadow.purificationStardustNeeded, candy: s.shadow.purificationCandyNeeded } : null,
        class: cls === 'mythic' ? 'mythical' : cls,
        height: s.pokedexHeightM, weight: s.pokedexWeightKg,
        category: t(`pokemon_category_${String(dex).padStart(4, '0')}`) || null,
        desc: t(`pokemon_desc_${String(dex).padStart(4, '0')}`) || null,
        gen: genOf(dex),
        // The game master omits these flags for Pokémon that can't be traded/transferred (e.g. Mew)
        tradable: s.isTradable === true, transferable: s.isTransferable === true,
        candyToEvolve: s.candyToEvolve || 0,
        bonusCandy: s.encounter?.bonusCandyCaptureReward || 0,
        bonusXl: s.encounter?.bonusXlCandyCaptureReward || 0,
        captureRate: s.encounter?.baseCaptureRate ?? null,
        fleeRate: s.encounter?.baseFleeRate ?? null,
        shadowCaptureRate: s.encounter?.shadowBaseCaptureRate ?? null,
        size,
        maxGroup: s.breadTierGroup ? s.breadTierGroup.replace('GROUP_', '') : null,
        gmax: gmaxVisual || assetFiles.has(`pm${dex}.fGIGANTAMAX.icon.png`) || undefined,
        dmax: dynamaxVisual || undefined,
        img, shinyImg: assetFiles.size ? assetFiles.has(`${img}.s.icon.png`) : true,
        variants: (() => { const n = g.filter((x) => !/(COPY|NOEVOLVE|_S$)/.test(x.s.form || '')).length; return n > 1 ? n : undefined; })(),
        released: match ? match.released !== false : false,
        shadowReleased: !!match?.tags?.includes('shadoweligible'),
        pvpoke: match?.speciesId || null,
        tags: match?.tags?.filter((x) => !['shadoweligible', 'teambuilderexclude'].includes(x)) || [],
      };
      if (s.evolutionPips === undefined && !evolutions.length) delete entry.evolutions;
      const fam = families[s.familyId];
      if (fam?.candyPerXlCandy) entry.candyPerXl = fam.candyPerXlCandy;
      out.push(entry);

      // Mega / primal evolutions
      for (const o of s.tempEvoOverrides || []) {
        if (!o.stats) continue;
        const suffix = o.tempEvoId.replace('TEMP_EVOLUTION_', '');
        const mid = `${id}_${suffix}`;
        if (usedIds.has(mid)) continue;
        usedIds.add(mid);
        const branch = (s.evolutionBranch || []).find((b) => b.temporaryEvolution === o.tempEvoId);
        const mtypes = [typeOf(o.typeOverride1), typeOf(o.typeOverride2)].filter(Boolean);
        const mstats = { atk: o.stats.baseAttack, def: o.stats.baseDefense, sta: o.stats.baseStamina };
        const pvpMega = (pvpByDex[dex] || []).find((p) => (p.tags?.includes('mega') || /_mega|_primal/.test(p.speciesId)) && p.baseStats.atk === mstats.atk && p.baseStats.def === mstats.def);
        const isPrimal = suffix === 'PRIMAL';
        const mimg = imgFor(dex, suffix);
        out.push({
          ...entry,
          id: mid, form: suffix, formName: isPrimal ? 'Primal' : suffix === 'MEGA' ? 'Mega' : `Mega ${suffix.split('_')[1]}`,
          types: mtypes.length ? mtypes : types, ...mstats,
          evolutions: [], parent: null,
          megaOf: id,
          megaEnergy: branch ? { first: branch.temporaryEvolutionEnergyCost, after: branch.temporaryEvolutionEnergyCostSubsequent } : null,
          height: o.averageHeightM ?? entry.height, weight: o.averageWeightKg ?? entry.weight,
          img: mimg, shinyImg: assetFiles.size ? assetFiles.has(`${mimg}.s.icon.png`) : true,
          released: !!pvpMega && pvpMega.released !== false,
          shadowReleased: false,
          pvpoke: pvpMega?.speciesId || null,
          tags: isPrimal ? ['primal'] : ['mega'],
          gmax: undefined, dmax: undefined,
          purify: null, thirdMove: entry.thirdMove,
        });
        entry.megas = [...(entry.megas || []), mid];
      }
    }
  }

  // Add moves PvPoke knows about that the (older) game master dump is missing
  const pvpById = Object.fromEntries(pvp.pokemon.map((x) => [x.speciesId, x]));
  let poolAdds = 0;
  for (const p of out) {
    const src = p.pvpoke && pvpById[p.pvpoke];
    if (!src || p.speciesId === 'SMEARGLE') continue; // PvPoke lists every Sketchable move for Smeargle
    const elite = new Set(src.eliteMoves || []);
    for (const [list, eliteList, ids] of [['fast', 'eliteFast', src.fastMoves], ['charged', 'eliteCharged', src.chargedMoves]]) {
      for (const mid of ids || []) {
        const id = pvpMoveMap[mid];
        if (!id || !moves[id] || ['RETURN', 'FRUSTRATION'].includes(id) || id.startsWith('HIDDEN_POWER')) continue;
        if (p[list].includes(id) || p[eliteList].includes(id)) continue;
        (elite.has(mid) ? p[eliteList] : p[list]).push(id);
        poolAdds++;
      }
    }
  }
  console.log(`  Move pool additions from PvPoke: ${poolAdds}`);

  // Resolve evolution target ids (species + form → our id)
  const idSet = new Set(out.map((p) => p.id));
  const bySpecies = {};
  for (const p of out) if (!p.megaOf) (bySpecies[p.speciesId] ||= []).push(p);
  const resolve = (speciesId, form, fromForm) => {
    if (form) {
      const suf = form.replace(new RegExp(`^${speciesId}_?`), '');
      const cand = suf === 'NORMAL' ? speciesId : `${speciesId}_${suf}`;
      if (idSet.has(cand)) return cand;
    }
    if (fromForm && idSet.has(`${speciesId}_${fromForm}`)) return `${speciesId}_${fromForm}`;
    if (idSet.has(speciesId)) return speciesId;
    return bySpecies[speciesId]?.[0]?.id || null;
  };
  for (const p of out) {
    if (!p.evolutions) continue;
    p.evolutions = p.evolutions.map((e) => ({ ...e, to: resolve(e.to, e.form, p.form) })).filter((e) => e.to);
    p.evolutions.forEach((e) => delete e.form);
  }
  // parent links (reverse of evolutions — more reliable than parentPokemonId for forms)
  for (const p of out) for (const e of p.evolutions || []) {
    const c = out.find((x) => x.id === e.to);
    if (c && !c.parentId) c.parentId = p.id;
  }
  for (const p of out) { delete p.parent; delete p.parentForm; }
  // A PvPoke id may only map to one of our entries (first = most canonical)
  const seenPv = new Set();
  for (const p of out) { if (!p.pvpoke) continue; if (seenPv.has(p.pvpoke)) p.pvpoke = null; else seenPv.add(p.pvpoke); }

  // Sort by dex then base form first
  out.sort((a, b) => a.dex - b.dex || (a.megaOf ? 1 : 0) - (b.megaOf ? 1 : 0) || (a.form ? 1 : 0) - (b.form ? 1 : 0) || a.id.localeCompare(b.id));

  // ------------------------------------------------------------ costumes
  // Costume Pokémon share stats/moves with their regular form, so they're kept as a
  // separate list linked to the base entry. Two sources: costume forms in the game
  // master (e.g. PIKACHU_POP_STAR) and costume sprite codes (pm25.cHOLIDAY_2016).
  const COSTUME_WORDS = {
    GOFEST: 'GO Fest', GOTOUR: 'GO Tour', WCS: 'Worlds', VS: 'VS', TSHIRT: 'T-Shirt', TCG: 'TCG', PI: 'Pi', M: 'M',
    JAN: 'January', FEB: 'February', APRIL: 'April', MAY: 'May', NOVEMBER: 'November', COPY: 'Clone',
    ANNIV: 'Anniversary', '5TH': '5th', STIARA: 'Tiara (S)', MTIARA: 'Tiara (M)', DIWALI: 'Diwali',
  };
  const costumeName = (code) => code.replace(/_NOEVOLVE$/, '').split('_').map((w) => COSTUME_WORDS[w] || (/^\d+$/.test(w) ? (w.length === 2 && !/^20/.test(w) ? `#${Number(w)}` : w) : w[0] + w.slice(1).toLowerCase())).join(' ');
  const baseByDex = {};
  for (const p of out) if (!p.megaOf && (!baseByDex[p.dex] || (!p.form && baseByDex[p.dex].form))) baseByDex[p.dex] = p;
  const costumes = new Map();
  const addCostume = (dex, code, kind, speciesId) => {
    const base = (speciesId && out.find((p) => p.speciesId === speciesId && !p.megaOf && !p.form)) || baseByDex[dex];
    if (!base) return;
    const key = `${base.speciesId}__${code}`;
    if (costumes.has(key)) return;
    const img = `pm${dex}.${kind}${code}`;
    costumes.set(key, {
      id: key, dex, base: base.id, code, name: costumeName(code), img,
      shinyImg: assetFiles.size ? assetFiles.has(`${img}.s.icon.png`) : true,
      noEvolve: /NOEVOLVE/.test(code) || undefined,
    });
  };
  for (const f of assetFiles) {
    const m = f.match(/^pm(\d+)\.c([A-Z0-9_]+)\.icon\.png$/);
    if (m) addCostume(Number(m[1]), m[2], 'c');
  }
  for (const form of costumeForms) {
    const sp = costumeSpecies[form];
    const base = out.find((p) => p.speciesId === sp && !p.megaOf);
    if (!base) continue;
    addCostume(base.dex, form.slice(sp.length + 1), 'f', sp);
  }
  // The same costume can appear as both a form and a sprite code — merge by Pokémon + name
  const byName = new Map();
  for (const c of costumes.values()) {
    const k = `${c.base}|${c.name}`;
    const prev = byName.get(k);
    if (!prev) { byName.set(k, c); continue; }
    if (!prev.shinyImg && c.shinyImg) byName.set(k, { ...c, noEvolve: prev.noEvolve && c.noEvolve });
    else prev.noEvolve = prev.noEvolve && c.noEvolve ? true : undefined;
  }
  const costumeList = [...byName.values()].sort((a, b) => a.dex - b.dex || a.name.localeCompare(b.name));

  // Strip moves that don't exist; collect learners
  for (const p of out) for (const k of ['fast', 'charged', 'eliteFast', 'eliteCharged']) p[k] = p[k].filter((m) => moves[m]);

  // ------------------------------------------------------------ type chart
  const typeChart = {};
  for (const d of byKey.typeEffective || []) {
    const te = d.typeEffective;
    const atk = typeOf(te.attackType);
    typeChart[atk] = Object.fromEntries(TYPES.map((def, i) => [def, te.attackScalar[i]]));
  }

  // ------------------------------------------------------------ settings
  console.log('Compiling settings…');
  const pl = one('playerLevel');
  const cpmWhole = pl.cpMultiplier;
  const cpm = {};
  for (let i = 0; i < cpmWhole.length; i++) {
    const L = i + 1;
    cpm[L] = cpmWhole[i];
    if (i + 1 < cpmWhole.length) cpm[L + 0.5] = Math.sqrt((cpmWhole[i] ** 2 + cpmWhole[i + 1] ** 2) / 2);
  }
  const up = (byKey.pokemonUpgrades || []).find((d) => d.templateId === 'POKEMON_UPGRADE_SETTINGS').pokemonUpgrades;
  const upOverrides = {};
  for (const d of byKey.pokemonUpgrades || []) {
    const m = d.templateId.match(/OVERRIDE_SETTINGS_V\d{4}_POKEMON_(.+)$/);
    if (m) upOverrides[m[1]] = { candy: d.pokemonUpgrades.candyCost, xl: d.pokemonUpgrades.xlCandyCost, dust: d.pokemonUpgrades.stardustCost };
  }
  const weather = {};
  for (const d of byKey.weatherAffinities || []) weather[d.weatherAffinities.weatherCondition.toLowerCase()] = d.weatherAffinities.pokemonType.map(typeOf);

  const friendship = (byKey.friendshipMilestoneSettings || []).map((d) => {
    const f = d.friendshipMilestoneSettings;
    return { level: Number(d.templateId.split('_').pop()), points: f.minPointsToReach || 0, xp: f.milestoneXpReward || 0, attack: f.attackBonusPercentage || 1, raidBalls: f.raidBallBonus || 0, tradeDiscount: f.tradingDiscount || 0, luckyApplicator: !!f.unlockedLuckyFriendApplicator };
  }).sort((a, b) => a.level - b.level);

  const levelRewards = (byKey.levelUpRewardSettings || []).map((d) => {
    const r = d.levelUpRewardSettings;
    return {
      level: r.level,
      items: (r.items || []).map((it, i) => ({ name: itemName(it), count: r.itemsCount?.[i] || 1 })),
      unlocks: (r.featuresUnlocked || []).filter((f) => typeof f === 'string').map((f) => titleCase(f.replace('FEATURE_', ''))),
    };
  }).sort((a, b) => a.level - b.level)
    // Some levels have several reward templates (e.g. storage upgrades) — merge them
    .reduce((acc, r) => {
      const prev = acc.find((x) => x.level === r.level);
      if (!prev) { acc.push(r); return acc; }
      for (const it of r.items) { const same = prev.items.find((x) => x.name === it.name); if (same) same.count = Math.max(same.count, it.count); else prev.items.push(it); }
      for (const u of r.unlocks) if (!prev.unlocks.includes(u)) prev.unlocks.push(u);
      return acc;
    }, []);

  const buddyLevels = (byKey.buddyLevelSettings || []).map((d) => {
    const b = d.buddyLevelSettings;
    return { level: Number(b.level.split('_').pop()), points: b.minNonCumulativePointsRequired || 0, traits: (b.unlockedTraits || []).map((x) => titleCase(x)) };
  }).sort((a, b) => a.level - b.level);

  const wb = one('weatherBonusSettings');
  const combat = one('combatSettings');
  const stages = one('combatStatStageSettings');
  const megaLevels = (byKey.megaEvoLevelSettings || []).filter((d) => !d.megaEvoLevelSettings.pokemonId).map((d) => ({
    level: Number(d.templateId.split('_').pop()),
    ...d.megaEvoLevelSettings.effects,
    cooldownMs: Number(d.megaEvoLevelSettings.cooldown?.durationMs || 0),
    points: d.megaEvoLevelSettings.progression?.pointsLimitPerPeriod,
  })).sort((a, b) => a.level - b.level);

  // Max (Dynamax) battle data
  const maxMoves = (one('breadMoveMappings')?.mappings || []).map((m) => ({ type: typeOf(m.type), id: m.move, name: moves[m.move]?.name || m.move }));
  const maxMoveLevels = {};
  for (const d of byKey.breadMoveLevelSettings || []) {
    const s = d.breadMoveLevelSettings;
    maxMoveLevels[s.group.replace('GROUP_', '')] = { attack: s.aSettings, guard: s.bSettings, spirit: s.cSettings };
  }

  // Medals
  const medals = [];
  for (const d of byKey.badgeSettings || []) {
    const b = d.badgeSettings;
    if (b.eventBadge || !b.targets || b.targets.length < 3) continue;
    const k = b.badgeType.toLowerCase();
    const title = t(`${k}_title`);
    if (!title) continue;
    const desc = (t(k) || t(`${k}_plural`) || '').replace(/\{0\}/g, '#');
    medals.push({ id: b.badgeType, name: title, desc, targets: b.targets, type: k.startsWith('badge_type_') ? k.replace('badge_type_', '') : null });
  }
  medals.sort((a, b) => (a.type ? 1 : 0) - (b.type ? 1 : 0) || a.name.localeCompare(b.name));

  // Items
  const items = (byKey.itemSettings || []).map((d) => {
    const s = d.itemSettings;
    const id = s.itemId;
    if (typeof id !== 'string' || !id.startsWith('ITEM_')) return null;
    const k = id.toLowerCase();
    const name = t(`${k}_name`);
    if (!name || /^undefined$/i.test(name)) return null;
    // dropTrainerLevel 100 marks items that never drop from Pokéstops (store / reward only)
    const lvl = s.dropTrainerLevel && s.dropTrainerLevel <= 80 ? s.dropTrainerLevel : null;
    return { id, name, desc: t(`${k}_desc`) || '', category: (s.category || '').replace('ITEM_CATEGORY_', '').toLowerCase(), level: lvl };
  }).filter(Boolean).sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));

  // Combat leagues (in-game definitions)
  const leagues = (byKey.combatLeague || []).map((d) => {
    const l = d.combatLeague;
    const name = t(l.title) || titleCase(l.title.replace('combat_', ''));
    const cap = l.pokemonCondition?.find((c) => c.withPokemonCpLimit)?.withPokemonCpLimit?.maxCp;
    const typesAllowed = l.pokemonCondition?.find((c) => c.withPokemonType)?.withPokemonType?.pokemonType?.map(typeOf);
    return { id: d.templateId, name, cp: cap || null, types: typesAllowed || null, banned: l.bannedPokemon?.length || 0, enabled: !!l.enabled };
  });

  const settings = {
    generatedAt: new Date().toISOString(),
    sources: { gameMaster: 'PokeMiners', pvp: `PvPoke (${pvp.timestamp || 'latest'})`, live: 'Leek Duck via ScrapedDuck' },
    cpm,
    maxPokemonLevel: up.maxNormalUpgradeLevel || 50,
    upgrade: { candy: up.candyCost, dust: up.stardustCost, xl: up.xlCandyCost, shadowMult: up.shadowStardustMultiplier, purifiedMult: up.purifiedStardustMultiplier, shadowCandyMult: up.shadowCandyMultiplier, purifiedCandyMult: up.purifiedCandyMultiplier, luckyDustMult: 1 - (one('luckyPokemonSettings')?.powerUpStardustDiscountPercent ?? 0.5), overrides: upOverrides },
    xp: pl.requiredExperience,
    levelCap: pl.defaultLevelCap,
    maxEncounterLevel: pl.maxEncounterPlayerLevel, maxEggLevel: pl.maxEggPlayerLevel, maxQuestLevel: pl.maxQuestEncounterPlayerLevel,
    weather,
    weatherBonus: { level: wb.cpBaseLevelBonus, minIv: wb.guaranteedIndividualValues, dust: wb.stardustBonusMultiplier, attack: wb.attackBonusMultiplier, raidMinIv: wb.raidEncounterGuaranteedIndividualValues },
    friendship, levelRewards, buddyLevels, megaLevels,
    combat: {
      stab: combat.sameTypeAttackBonusMultiplier, pvpBonus: combat.fastAttackBonusMultiplier,
      shadowAtk: combat.shadowPokemonAttackBonusMultiplier, shadowDef: combat.shadowPokemonDefenseBonusMultiplier,
      maxEnergy: combat.maxEnergy, turnSeconds: combat.turnDurationSeconds,
      buffMultipliers: stages.attackBuffMultiplier, minStage: stages.minimumStatStage, maxStage: stages.maximumStatStage,
    },
    maxMoves, maxMoveLevels, leagues,
  };

  // ------------------------------------------------------------ rankings
  console.log('Compiling PvP rankings…');
  const pvpToOurs = {};
  for (const p of out) if (p.pvpoke) pvpToOurs[p.pvpoke] = p.id;
  const resolvePvp = (sid) => {
    if (pvpToOurs[sid]) return { id: pvpToOurs[sid], shadow: false };
    if (sid.endsWith('_shadow') && pvpToOurs[sid.replace(/_shadow$/, '')]) return { id: pvpToOurs[sid.replace(/_shadow$/, '')], shadow: true };
    return null;
  };
  const rankingSets = [
    { key: 'little', title: 'Little League', cup: 'all', cp: 500 },
    { key: 'great', title: 'Great League', cup: 'all', cp: 1500 },
    { key: 'ultra', title: 'Ultra League', cup: 'all', cp: 2500 },
    { key: 'master', title: 'Master League', cup: 'all', cp: 10000 },
  ];
  // Featured cups that PvPoke currently shows (skip hidden & the main 4)
  for (const f of pvp.formats || []) {
    if (!f.showCup || f.hideRankings || f.cup === 'all') continue;
    if (rankingSets.length >= 14) break;
    rankingSets.push({ key: `${f.cup}-${f.cp}`, title: f.title, cup: f.cup, cp: f.cp });
  }
  const rankIndex = [];
  for (const rs of rankingSets) {
    const data = await fetchCached(`rank_${rs.cup}_${rs.cp}.json`, SRC.pvpokeRank(rs.cup, 'overall', rs.cp), { optional: true });
    if (!data) continue;
    const rows = [];
    for (const r of data) {
      const res = resolvePvp(r.speciesId);
      if (!res) continue;
      rows.push({
        id: res.id, sh: res.shadow ? 1 : undefined, pv: r.speciesId,
        s: r.score, r: r.scores,
        m: (r.moveset || []).map((x) => pvpMoveMap[x] || x),
        mu: (r.matchups || []).slice(0, 5).map((x) => [x.opponent, x.rating]),
        c: (r.counters || []).slice(0, 5).map((x) => [x.opponent, x.rating]),
        sp: r.stats?.product,
      });
    }
    write(`rankings/${rs.key}.json`, rows);
    rankIndex.push({ key: rs.key, title: rs.title, cp: rs.cp, cup: rs.cup, count: rows.length });
  }
  settings.rankings = rankIndex;
  // PvPoke id → [our id, shadow] for resolving matchup names
  settings.pvpIds = Object.fromEntries(Object.entries(pvpToOurs));

  // ------------------------------------------------------------ live snapshot
  console.log('Snapshotting live feeds…');
  for (const f of ['events', 'raids', 'research', 'eggs', 'rocketLineups']) {
    const d = await fetchCached(`sd_${f}.json`, SRC.scrapedDuck(f), { optional: true });
    if (d) write(`live/${f}.json`, d);
  }

  // ------------------------------------------------------------ write
  console.log('Writing output…');
  write('pokemon.json', out);
  write('costumes.json', costumeList);
  write('moves.json', moves);
  write('types.json', typeChart);
  write('settings.json', settings);
  write('reference.json', { medals, items });

  const rel = out.filter((p) => p.released);
  console.log(`Done: ${out.length} Pokémon entries (${rel.length} released), ${costumeList.length} costumes, ${Object.keys(moves).length} moves, ${medals.length} medals, ${items.length} items, ${rankIndex.length} ranking sets.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
