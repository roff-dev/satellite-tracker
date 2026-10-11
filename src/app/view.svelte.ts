import type { ColourBy } from '../data/groups';
import type { Candidate, SearchResult } from '../data/protocol';

/** How the globe is being shown, and the actions that change it. Filled in once the globe has loaded. */
export const view = $state<{
  ready: boolean;
  group: string | null;
  /** Members of the group with a position now. */
  groupCount: number;
  colourBy: ColourBy;
  debrisShown: boolean;
  /** Objects from the selected satellite's launch, while they're shown. */
  launchCount: number | null;
  /** Height of the timeline along the bottom, CSS px. */
  timelineHeight: number;
  setGroup: (slug: string | null) => void;
  setColourBy: (mode: ColourBy) => void;
  setDebrisShown: (shown: boolean) => void;
  search: (query: string) => Promise<SearchResult[]>;
  selectFound: (candidate: Candidate) => void;
  showLaunch: (on: boolean, cospar?: string) => void;
  isConstellation: (name: string) => boolean;
}>({
  ready: false,
  group: null,
  groupCount: 0,
  colourBy: 'light',
  debrisShown: true,
  launchCount: null,
  timelineHeight: 0,
  setGroup: () => {},
  setColourBy: () => {},
  setDebrisShown: () => {},
  search: async () => [],
  selectFound: () => {},
  showLaunch: () => {},
  isConstellation: () => false,
});
