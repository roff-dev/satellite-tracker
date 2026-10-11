/** Owner and launch-site names by catalogue code, loaded once when first needed. */
export const names = $state<{ table: { owners: Record<string, string>; sites: Record<string, string> } | null }>({ table: null });

let requested = false;
export function loadNames() {
  if (requested) return;
  requested = true;
  fetch('/owners.json')
    .then((r) => (r.ok ? r.json() : null))
    .then((table) => {
      names.table = table;
    })
    .catch(() => undefined);
}
