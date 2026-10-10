import type { CatalogStatus } from '../globe';

/** The catalogue's latest status, shared by everything that talks about it. */
export const catalog = $state<{ status: CatalogStatus | null }>({ status: null });
