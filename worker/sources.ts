export const USER_AGENT = 'Overhead satellite globe (personal, non-commercial project)';

const COLUMNS = [
  'OBJECT_NAME',
  'OBJECT_ID',
  'NORAD_CAT_ID',
  'EPOCH',
  'MEAN_MOTION',
  'ECCENTRICITY',
  'INCLINATION',
  'RA_OF_ASC_NODE',
  'ARG_OF_PERICENTER',
  'MEAN_ANOMALY',
  'BSTAR',
  'MEAN_MOTION_DOT',
  'MEAN_MOTION_DDOT',
  'OBJECT_TYPE',
  'RCS_SIZE',
  'COUNTRY_CODE',
  'LAUNCH_DATE',
].join(',');

// Only objects still in orbit with an element set from the last ten days, as Space-Track recommends
const gp = (typeFilter: string) =>
  `/basicspacedata/query/class/gp/decay_date/null-val/epoch/%3Enow-10/OBJECT_TYPE/${typeFilter}/orderby/NORAD_CAT_ID/predicates/${COLUMNS}/format/csv`;

export const SPACETRACK = {
  base: 'https://www.space-track.org',
  queries: {
    payloads: gp('PAYLOAD'),
    debris: gp('%3C%3EPAYLOAD'),
  },
} as const;

const celestrak = (group: string) => `https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=csv`;

export const CELESTRAK = {
  visual: celestrak('visual'),
  stations: celestrak('stations'),
  active: celestrak('active'),
  satcat: 'https://celestrak.org/satcat/records.php?GROUP=active&FORMAT=CSV',
  groups: ['gnss', 'weather', 'science', 'geo'].map((g) => [g, celestrak(g)] as const),
};

/** Every GP and SATCAT CSV starts with this column. Anything else is an error page. */
export const CSV_HEADER = 'OBJECT_NAME,';
