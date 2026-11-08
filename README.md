# PoGo Companion

A personal Pokémon GO companion web app. It covers live game info, a full Pokédex, raid and PvP battle tools, calculators, collection tracking and reference material. It's an installable PWA, so it works on desktop and can be added to an Android/iOS home screen. Your data stays on your device.

## Features

**Today dashboard**: live and upcoming events with countdowns, Community Day / Spotlight Hour / Raid Hour highlights, current raid bosses, a weather-boost lookup, and your collection progress.

**Live** (from Leek Duck via ScrapedDuck, refreshed every 30 min, with an offline snapshot)
- Events calendar: live, upcoming and ended events, with spawns, bonuses and raid bosses
- Raid bosses by tier: CP ranges, weather boosts, weaknesses and top counters
- Field research tasks and rewards
- Egg pools by distance
- Team GO Rocket lineups (grunts, leaders, Giovanni) with counters
- Max Battles: Dynamax/Gigantamax mechanics, Max Moves, upgrade costs, best Dynamax attackers

**Pokédex**
- 1,100+ released Pokémon, including regional forms, Megas and Primals, with filters and grid/table views
- Per-Pokémon page:
  - base stats and max CP (L40/L50/L51)
  - type matchups
  - encounter "hundo" CPs
  - evolution tree with requirements (items, lures, quests, buddy, time of day)
  - Mega Energy costs
  - buddy distance, second-move and purification costs, size thresholds
  - neutral raid DPS/TDO for every moveset
  - PvP ranks and rank-1 IVs for each league
  - full PvE/PvP move tables
- Moves database: raid and Trainer Battle stats, buff effects, and who learns each move (regular and Elite TM)
- Type chart with defensive and offensive calculators

**Battle**
- Raid counters for any boss: tier, weather, friendship, Mega boost, shadows, Elite TM moves, attacker level, DPS/TDO/ER, best attackers per type, and an estimate of how many trainers you need
- PvP rankings (Little/Great/Ultra/Master plus current cups) with role scores, movesets, and key wins and losses
- PvP IV ranker: stat-product rank and %, family view, top-IV search strings, bulk check
- Team builder: coverage, threats, suggestions
- 1v1 battle simulator: shields, buffs, CMP, shield-scenario matrix, breakpoints

**Tools**: IV calculator (CP/HP/dust/appraisal, saves to My Pokémon), CP calculator and charts, power-up costs (shadow/purified/lucky, XL), evolution and candy planner, trade cost calculator, XP and leveling calculator, Mega Evolution calculator, and an in-game search-string builder.

**Collection**: a personal dex checklist (caught, shiny, lucky, hundo, shadow, purified, XXL/XXS, shundo, Dynamax, Gigantamax) and a "My Pokémon" box with IVs, PvP ranks and raid ratings. Includes CSV/JSON export and import.

**Reference**: weather boosts, trainer levels and rewards (up to level 80), friendship and buddy levels, medals with a progress tracker, items, and a game mechanics guide (formulas, CPM table, catch rates, IV floors, PvP buffs).

**App**: Ctrl+K / `/` command palette, dark/light themes, backup and restore, and offline support.

## Running it

Requires Node 18+.

```bash
npm install
npm run dev        # http://localhost:5173
```

Build a static production bundle (output in `dist/`):

```bash
npm run build
npm run preview    # serve the production build at http://localhost:4173
```

### Updating game data

Static game data (stats, moves, costs, rankings) is compiled from public sources into `public/data/`:

```bash
npm run data       # downloads the latest sources, then rebuild
```

Use `node scripts/build-data.mjs --offline` to rebuild from the cached downloads in `.cache/`.

Live data (events, raids, research, eggs, Rocket) is fetched in the browser at runtime, so it doesn't need a rebuild.

### Using it on your phone

The app is a static site with relative paths. To install it as an app:

1. Host `dist/` anywhere that serves HTTPS, such as Netlify Drop, GitHub Pages, Cloudflare Pages, or any static host.
2. Open it in Chrome on Android and choose **Add to Home screen / Install app**.

Your collection lives in that browser's storage. Use **Settings → Backup** to move it between devices.

## Data sources

- [PokeMiners game master](https://github.com/PokeMiners/game_masters) and [pogo_assets](https://github.com/PokeMiners/pogo_assets): stats, moves, costs, settings, English text, sprites
- [PvPoke](https://github.com/pvpoke/pvpoke): release and shadow availability, PvP rankings and recommended movesets
- [Leek Duck](https://leekduck.com) via [ScrapedDuck](https://github.com/bigfoott/ScrapedDuck): events, raids, research, eggs, Rocket lineups

PvPoke updates faster than the public game-master dumps. So the data build uses PvPoke's Trainer Battle move values and fills in any moves the game master is missing from a Pokémon's move pool. Raid move values still come from the game master.

The battle simulator agrees with PvPoke's published win/loss results in about 80–85% of the matchups tested (1 shield each). It has no look-ahead and doesn't model form changes other than Mimikyu's Disguise.

Raid DPS uses the community "comprehensive DPS" model. Some values are community-researched estimates rather than published by Niantic, such as catch-rate multipliers and shiny odds. The app labels these where they appear.

## Project layout

```
scripts/build-data.mjs   data pipeline → public/data/*.json
scripts/make-icons.mjs   PWA icon rasteriser
public/sw.js             service worker (offline shell, data & sprite caching)
src/lib/                 data loading, formulas (pogo.ts), raid math (pve.ts), live feeds, storage
src/components/ui.tsx    shared UI components
src/pages/               feature pages (dex, live, battle, pvp, tools, collection, reference)
```

---

This is a personal fan project. Pokémon and Pokémon GO are trademarks of Nintendo, Creatures, GAME FREAK and Niantic.
