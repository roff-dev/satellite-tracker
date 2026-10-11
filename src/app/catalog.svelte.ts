import type { CatalogStatus } from '../globe';

/** The catalogue's latest status, shared by everything that talks about it, and a way to ask for it again. */
export const catalog = $state<{ status: CatalogStatus | null; retry: () => void }>({ status: null, retry: () => {} });
