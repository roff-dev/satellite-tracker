import type { Hover, Selection } from '../globe';

/** What's selected on the globe and what the pointer rests on, with the actions the panel can take. */
export const selection = $state<{
  current: Selection | null;
  hover: Hover | null;
  choose: (index: number) => void;
  close: () => void;
  /** Screen space the panel covers when at rest, CSS px. */
  insets: { right: number; bottom: number };
}>({ current: null, hover: null, choose: () => {}, close: () => {}, insets: { right: 0, bottom: 0 } });
