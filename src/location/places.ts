/** A town or city to show the sky from: GeoNames' places of 15,000 people or more. */
export interface Place {
  name: string;
  /** State, province or region, to tell places of the same name apart. */
  region: string;
  /** ISO 3166 country code. */
  country: string;
  lat: number;
  lon: number;
  population: number;
  /** IANA time zone, so pass times read on the place's own clock. */
  timeZone: string;
}

const FOLDS: Record<string, string> = { ø: 'o', æ: 'ae', œ: 'oe', ß: 'ss', ł: 'l', đ: 'd', ð: 'd', þ: 'th', ı: 'i' };

/** Lower case without accents or punctuation, so "São Paulo", "sao paulo" and "Sao-Paulo" all match. */
export function fold(text: string) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[øæœßłđðþı]/g, (c) => FOLDS[c]!)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Places are split into files by the first two letters of their name, so a search loads one small file. */
export function placeKey(text: string) {
  const letters = fold(text).replace(/[^a-z]/g, '');
  return letters.length >= 2 ? letters.slice(0, 2) : null;
}

type Indexed = Place & { folded: string };
const shards = new Map<string, Promise<Indexed[]>>();

function load(key: string) {
  let shard = shards.get(key);
  if (!shard) {
    shard = fetch(`/places/${key}.tsv`)
      .then((response) => (response.ok ? response.text() : ''))
      .then((text) =>
        text
          .split(/\r?\n/)
          .filter(Boolean)
          .map((line) => {
            const [name = '', region = '', country = '', lat = '0', lon = '0', population = '0', timeZone = ''] = line.split('\t');
            return { name, region, country, lat: Number(lat), lon: Number(lon), population: Number(population), timeZone, folded: fold(name) };
          }),
      )
      // A failed fetch can be tried again with the next keystroke
      .catch(() => (shards.delete(key), []));
    shards.set(key, shard);
  }
  return shard;
}

/** Places whose name starts with the query, most populous first; each file is already in that order. */
export async function findPlaces(query: string, limit = 8): Promise<Place[]> {
  const key = placeKey(query);
  if (!key) return [];
  const wanted = fold(query);
  const found: Place[] = [];
  for (const { folded, ...place } of await load(key)) {
    if (!folded.startsWith(wanted)) continue;
    found.push(place);
    if (found.length === limit) break;
  }
  return found;
}
