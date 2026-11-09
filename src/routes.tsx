import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

type Page = LazyExoticComponent<ComponentType>;
export interface RouteDef { path: string; page: Page; nav?: { group: string; label: string; icon: string; keywords?: string } }

const p = (f: () => Promise<{ default: ComponentType }>) => lazy(f);

export const ROUTES: RouteDef[] = [
  { path: '/', page: p(() => import('./pages/Home')), nav: { group: 'Today', label: 'Today', icon: '🏠', keywords: 'home dashboard' } },
  // Live
  { path: '/events', page: p(() => import('./pages/live/Events')), nav: { group: 'Live', label: 'Events', icon: '📅', keywords: 'community day spotlight hour calendar' } },
  { path: '/raids', page: p(() => import('./pages/live/Raids')), nav: { group: 'Live', label: 'Raid Bosses', icon: '⚔️', keywords: 'raids current bosses' } },
  { path: '/research', page: p(() => import('./pages/live/Research')), nav: { group: 'Live', label: 'Field Research', icon: '📋', keywords: 'quests tasks rewards' } },
  { path: '/eggs', page: p(() => import('./pages/live/Eggs')), nav: { group: 'Live', label: 'Eggs', icon: '🥚', keywords: 'hatch pool km' } },
  { path: '/rocket', page: p(() => import('./pages/live/Rocket')), nav: { group: 'Live', label: 'Team GO Rocket', icon: '🚀', keywords: 'grunt leader giovanni lineup shadow' } },
  { path: '/max', page: p(() => import('./pages/live/MaxBattles')), nav: { group: 'Live', label: 'Max Battles', icon: '🔴', keywords: 'dynamax gigantamax power spot max moves' } },
  // Pokédex
  { path: '/dex', page: p(() => import('./pages/dex/Pokedex')), nav: { group: 'Pokédex', label: 'Pokédex', icon: '📖', keywords: 'pokemon list stats' } },
  { path: '/dex/:id', page: p(() => import('./pages/dex/PokemonDetail')) },
  { path: '/moves', page: p(() => import('./pages/dex/Moves')), nav: { group: 'Pokédex', label: 'Moves', icon: '💥', keywords: 'attacks fast charged' } },
  { path: '/moves/:id', page: p(() => import('./pages/dex/MoveDetail')) },
  { path: '/types', page: p(() => import('./pages/battle/TypeChart')), nav: { group: 'Pokédex', label: 'Type Chart', icon: '🎯', keywords: 'effectiveness weakness resistance' } },
  // Battle
  { path: '/counters', page: p(() => import('./pages/battle/Counters')), nav: { group: 'Battle', label: 'Raid Counters', icon: '🛡️', keywords: 'best attackers dps tdo boss' } },
  { path: '/pvp', page: p(() => import('./pages/pvp/Rankings')), nav: { group: 'Battle', label: 'PvP Rankings', icon: '🏆', keywords: 'great ultra master league gbl meta' } },
  { path: '/pvp/ivs', page: p(() => import('./pages/pvp/PvpIvs')), nav: { group: 'Battle', label: 'PvP IV Ranker', icon: '📊', keywords: 'rank 1 stat product great league ivs' } },
  { path: '/pvp/team', page: p(() => import('./pages/pvp/TeamBuilder')), nav: { group: 'Battle', label: 'Team Builder', icon: '🧩', keywords: 'coverage threats party' } },
  { path: '/pvp/sim', page: p(() => import('./pages/pvp/Simulator')), nav: { group: 'Battle', label: 'Battle Simulator', icon: '🥊', keywords: 'matchup 1v1 shields breakpoints' } },
  // Tools
  { path: '/tools/iv', page: p(() => import('./pages/tools/IvCalculator')), nav: { group: 'Tools', label: 'IV Calculator', icon: '🧮', keywords: 'appraisal cp hp stardust' } },
  { path: '/tools/cp', page: p(() => import('./pages/tools/CpCalculator')), nav: { group: 'Tools', label: 'CP Calculator', icon: '📈', keywords: 'level cp chart hundo raid catch' } },
  { path: '/tools/powerup', page: p(() => import('./pages/tools/PowerUp')), nav: { group: 'Tools', label: 'Power-Up Cost', icon: '⬆️', keywords: 'stardust candy xl level' } },
  { path: '/tools/evolve', page: p(() => import('./pages/tools/EvolutionPlanner')), nav: { group: 'Tools', label: 'Evolution Planner', icon: '🧬', keywords: 'candy evolve xp lucky egg' } },
  { path: '/tools/trade', page: p(() => import('./pages/tools/TradeCalculator')), nav: { group: 'Tools', label: 'Trade Calculator', icon: '🔁', keywords: 'stardust cost lucky friendship' } },
  { path: '/tools/xp', page: p(() => import('./pages/tools/XpCalculator')), nav: { group: 'Tools', label: 'XP & Leveling', icon: '⭐', keywords: 'trainer level experience lucky egg' } },
  { path: '/tools/mega', page: p(() => import('./pages/tools/MegaCalculator')), nav: { group: 'Tools', label: 'Mega Evolution', icon: '💠', keywords: 'mega energy level bonus' } },
  { path: '/tools/search', page: p(() => import('./pages/tools/SearchStrings')), nav: { group: 'Tools', label: 'Search Strings', icon: '🔎', keywords: 'filter storage cleanup' } },
  // Collection
  { path: '/collection', page: p(() => import('./pages/collection/MyDex')), nav: { group: 'Collection', label: 'My Dex', icon: '✅', keywords: 'living dex shiny lucky hundo checklist' } },
  { path: '/collection/scan', page: p(() => import('./pages/collection/BoxScanner')), nav: { group: 'Collection', label: 'Box Scanner', icon: '📹', keywords: 'scan video screen recording import storage box automatic' } },
  { path: '/collection/mons', page: p(() => import('./pages/collection/MyPokemon')), nav: { group: 'Collection', label: 'My Pokémon', icon: '🎒', keywords: 'saved ivs box notes' } },
  // Reference
  { path: '/ref/weather', page: p(() => import('./pages/reference/Weather')), nav: { group: 'Reference', label: 'Weather Boosts', icon: '🌦️', keywords: 'weather boost types' } },
  { path: '/ref/levels', page: p(() => import('./pages/reference/TrainerLevels')), nav: { group: 'Reference', label: 'Trainer Levels', icon: '🎖️', keywords: 'xp level rewards' } },
  { path: '/ref/friendship', page: p(() => import('./pages/reference/Friendship')), nav: { group: 'Reference', label: 'Friendship & Buddy', icon: '🤝', keywords: 'friend levels buddy hearts' } },
  { path: '/ref/medals', page: p(() => import('./pages/reference/Medals')), nav: { group: 'Reference', label: 'Medals', icon: '🏅', keywords: 'badges achievements' } },
  { path: '/ref/items', page: p(() => import('./pages/reference/Items')), nav: { group: 'Reference', label: 'Items', icon: '🎒', keywords: 'balls berries potions' } },
  { path: '/ref/mechanics', page: p(() => import('./pages/reference/Mechanics')), nav: { group: 'Reference', label: 'Game Mechanics', icon: '📚', keywords: 'formulas cpm catch rate damage guide' } },
  // App
  { path: '/settings', page: p(() => import('./pages/Settings')), nav: { group: 'App', label: 'Settings & Backup', icon: '⚙️', keywords: 'preferences export import theme' } },
];

export const NAV_GROUPS = ['Today', 'Live', 'Pokédex', 'Battle', 'Tools', 'Collection', 'Reference', 'App'];
