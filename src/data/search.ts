import type { ObjectType } from '../orbit/brightness';
import { STATION, VISUAL } from './pick';

export interface Searchable {
  norad: number;
  name: string;
  cospar: string;
  type: ObjectType;
  lists: number;
}

/** Upper case without accents, so "Ørsted" and "orsted" both find ØRSTED. */
export function normalise(text: string) {
  return text.normalize('NFD').replace(/\p{M}/gu, '').replace(/Ø/gi, 'O').toUpperCase().trim();
}

/** Where a match was found, best first. */
const Tier = { Number: 0, NameStart: 1, WordStart: 2, Designator: 3, Inside: 4 } as const;
type Tier = (typeof Tier)[keyof typeof Tier];

/**
 * Finds objects by name, catalogue number or international designator. Matches at the start of the name rank
 * above matches at the start of a word, which rank above matches anywhere inside it; within each, stations, the
 * brightest and working satellites come first, then shorter names.
 */
export function createSearch(objects: Searchable[]) {
  const names: string[] = [];
  const indexed = () => {
    // Objects only ever get added, so the index just extends
    for (let slot = names.length; slot < objects.length; slot++) names.push(normalise(objects[slot]!.name));
    return names;
  };

  return function search(query: string, limit = 20): number[] {
    const q = normalise(query);
    if (!q) return [];
    const all = indexed();
    const digits = /^\d+$/.test(q) ? Number(q) : null;
    const found: { slot: number; tier: Tier; rank: number }[] = [];
    for (let slot = 0; slot < all.length; slot++) {
      const name = all[slot]!;
      const info = objects[slot]!;
      let tier: Tier | null = null;
      if (digits !== null && info.norad === digits) tier = Tier.Number;
      else if (name.startsWith(q)) tier = Tier.NameStart;
      else if (name.includes(' ' + q) || name.includes('(' + q) || name.includes('-' + q)) tier = Tier.WordStart;
      else if (info.cospar.startsWith(q)) tier = Tier.Designator;
      else if (name.includes(q)) tier = Tier.Inside;
      if (tier === null) continue;
      const preference = (info.lists & STATION ? 0 : 4) + (info.lists & VISUAL ? 0 : 2) + (info.type === 'payload' ? 0 : 1);
      found.push({ slot, tier, rank: preference * 1000 + Math.min(name.length, 999) });
    }
    found.sort((a, b) => a.tier - b.tier || a.rank - b.rank || all[a.slot]!.localeCompare(all[b.slot]!));
    return found.slice(0, limit).map((f) => f.slot);
  };
}
