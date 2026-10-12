import type { SatRec } from 'satellite.js';

/** An orbit as published, as text: objects with the same key are tracked as one. */
export function orbitKey(epoch: number, rec: Pick<SatRec, 'no' | 'ecco' | 'inclo' | 'nodeo' | 'argpo' | 'mo' | 'bstar'>) {
  return [epoch, rec.no, rec.ecco, rec.inclo, rec.nodeo, rec.argpo, rec.mo, rec.bstar].join('|');
}

/**
 * A station's modules and the craft docked to it are published with the station's own orbit. Groups of objects
 * sharing one orbit, each object (by slot) mapped to the slot of the one it's part of: the lowest catalogue number
 * in its group, the first catalogued.
 */
export function foldTwins(keys: string[], norads: number[]) {
  const groups = new Map<string, number[]>();
  keys.forEach((key, slot) => {
    const group = groups.get(key);
    if (group) group.push(slot);
    else groups.set(key, [slot]);
  });
  const hostOf = new Map<number, number>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const host = group.reduce((a, b) => (norads[b]! < norads[a]! ? b : a));
    for (const slot of group) if (slot !== host) hostOf.set(slot, host);
  }
  return hostOf;
}
