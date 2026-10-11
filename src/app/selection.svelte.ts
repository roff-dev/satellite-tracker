import type { Described, Hover, Selection } from '../globe';

/** What's selected on the globe and what the pointer rests on, with the actions the panel can take. */
export const selection = $state<{
  current: Selection | null;
  /** Details and live position of the selected object, once the worker has answered. */
  described: Described | null;
  hover: Hover | null;
  choose: (index: number) => void;
  close: () => void;
  /** Screen space the panel covers when at rest, CSS px. */
  insets: { right: number; bottom: number };
}>({ current: null, described: null, hover: null, choose: () => {}, close: () => {}, insets: { right: 0, bottom: 0 } });
