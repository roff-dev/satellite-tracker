<script lang="ts">
  import { Kind } from '../../data/protocol';
  import { catalog } from '../catalog.svelte';
  import { selection } from '../selection.svelte';
  import { view } from '../view.svelte';

  const number = new Intl.NumberFormat('en-GB');
  // Each kind with its colour in the "by type" key; phones show the short name
  const KINDS = [
    { kind: Kind.Active, label: 'Working satellites', short: 'Working', colour: 'var(--glint)' },
    { kind: Kind.Dead, label: 'Inactive satellites', short: 'Inactive', colour: 'var(--muted)' },
    { kind: Kind.Rocket, label: 'Rocket bodies', short: 'Rockets', colour: 'var(--flare)' },
    { kind: Kind.Debris, label: 'Debris', short: 'Debris', colour: 'var(--faint)' },
  ];
  const counts = $derived(catalog.status?.kinds);

  function toggle(kind: number, on: boolean) {
    view.setKinds(on ? view.kinds | (1 << kind) : view.kinds & ~(1 << kind));
  }
</script>

<!-- The marks are the colour key when colouring by type, so switching a kind off and reading the key are one thing -->
<!-- With one object shown alone, the kinds have nothing to switch -->
<fieldset class="types" class:keyed={view.colourBy === 'type'} class:tucked={selection.sheetOpen} disabled={!view.ready || selection.solo}>
  <legend class="visually-hidden">Show</legend>
  {#each KINDS as { kind, label, short, colour } (kind)}
    {@const on = (view.kinds & (1 << kind)) !== 0}
    <label class="type" class:on style:--key={colour}>
      <input type="checkbox" checked={on} aria-label={label} onchange={(e) => toggle(kind, e.currentTarget.checked)} />
      <svg class="mark" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M6 .9 11.1 6 6 11.1.9 6z" /></svg>
      <span class="full">{label}</span>
      <span class="short">{short}</span>
      {#if counts}<span class="count">{number.format(counts[kind] ?? 0)}</span>{/if}
    </label>
  {/each}
</fieldset>

<style>
  /* Wide screens: a quiet list in the space under the headline, just above the timeline (and any sheet under it) */
  /* Tapped quickly they toggle; their labels never get highlighted */
  .types {
    -webkit-user-select: none;
    user-select: none;
    position: fixed;
    left: var(--gutter);
    bottom: calc(var(--sheet, 0px) + var(--timeline, 7rem) + var(--space-6) + env(safe-area-inset-bottom));
    display: flex;
    flex-direction: column;
    min-width: 14rem;
    margin: 0;
    padding: 0;
    border: 0;
    pointer-events: none;
  }

  .type {
    position: relative;
    isolation: isolate;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-height: 34px;
    font-size: var(--size-label);
    font-weight: 600;
    color: var(--muted);
    cursor: pointer;
    pointer-events: auto;
    transition: color 0.2s;
  }

  .type.on,
  .type:hover {
    color: var(--ink);
  }

  /* An open sheet means attention is on one object; the kinds step out of the globe's way, as the timeline does */
  .tucked {
    display: none;
  }

  .types:disabled .type {
    cursor: default;
    opacity: 0.5;
  }

  .type input {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
  }

  .type:has(input:focus-visible) {
    outline: 2px solid var(--glint);
    outline-offset: 3px;
  }

  /* A facet with no light when off; lit when on, in amber, or in its key colour when colouring by type */
  .mark {
    flex: none;
    color: var(--muted);
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    transition: color 0.2s, fill 0.2s;
  }

  .on .mark {
    color: var(--glint);
    fill: currentColor;
  }

  .keyed .on .mark {
    color: var(--key);
  }

  .short {
    display: none;
  }

  .count {
    margin-left: auto;
    padding-left: var(--space-4);
    font-weight: 450;
    font-variant-numeric: tabular-nums;
    color: var(--faint);
  }

  @media (pointer: coarse) {
    .type {
      min-height: 44px;
    }
  }

  /* Tablets held upright have the globe behind the list, so it sits on a panel */
  @media (orientation: portrait) and (min-width: 700px) {
    .types {
      padding: var(--space-2) var(--space-4);
      background: linear-gradient(155deg, var(--raise) 0 14%, var(--deck) 14% 100%);
      clip-path: var(--facet-cut);
      pointer-events: auto;
    }
  }

  /* Phones: one row of facet chips under the search and view buttons, there once the headline steps aside */
  @media (max-width: 699px), (orientation: landscape) and (max-height: 500px) {
    .types {
      position: static;
      align-self: stretch;
      flex-direction: row;
      gap: var(--space-1);
      min-width: 0;
      max-width: 26rem;
      overflow-x: auto;
      scrollbar-width: none;
      transition: opacity 0.5s ease;
    }

    .types::-webkit-scrollbar {
      display: none;
    }

    :global(html:not(.exploring)) .types {
      visibility: hidden;
      opacity: 0;
    }

    /* Sized to fit four across a 360 px phone; wider ones share out the spare room */
    .type {
      flex: 1 1 auto;
      justify-content: center;
      gap: 6px;
      min-height: 44px;
      padding: 0 6px;
      white-space: nowrap;
    }

    .type::before {
      content: '';
      position: absolute;
      inset: 0;
      z-index: -1;
      background: linear-gradient(155deg, var(--raise) 0 48%, var(--deck) 48% 100%);
      clip-path: var(--facet-cut);
    }

    .full,
    .count {
      display: none;
    }

    .short {
      display: inline;
    }
  }
</style>
