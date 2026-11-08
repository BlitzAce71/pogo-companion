import type { Pokemon } from './types';

const PM = 'https://raw.githubusercontent.com/PokeMiners/pogo_assets/master/Images/Pokemon/Addressable%20Assets/';
const LD = 'https://cdn.leekduck.com/assets/img/pokemon_icons/';

/** Ordered candidate URLs for a Pokémon sprite (first that loads wins). */
export function spriteUrls(p: Pick<Pokemon, 'img' | 'dex' | 'shinyImg'>, shiny = false): string[] {
  const s = shiny ? '.s' : '';
  const urls = [`${PM}${p.img}${s}.icon.png`, `${LD}${p.img}${s}.icon.png`];
  const base = `pm${p.dex}`;
  if (p.img !== base) urls.push(`${PM}${base}${s}.icon.png`);
  if (shiny) urls.push(`${PM}${p.img}.icon.png`);
  return urls;
}

export const typeIcon = (t: string) => `https://raw.githubusercontent.com/PokeMiners/pogo_assets/master/Images/Types/POKEMON_TYPE_${t.toUpperCase()}.png`;
