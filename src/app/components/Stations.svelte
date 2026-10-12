<script lang="ts">
  import { selection } from '../selection.svelte';
  import { sky } from '../sky.svelte';
  import { view } from '../view.svelte';

  // The two crewed stations; riding with the ISS brings in NASA's model of it
  const STATIONS = [
    { norad: 25544, name: 'ISS' },
    { norad: 48274, name: 'Tiangong' },
  ];
  /** Room left between the row and the timeline on upright phones, CSS px (--space-3). */
  const GAP = 12;

  // Upright phones run them in a row above the timeline, so the globe frames itself above that row too
  let list = $state<HTMLElement>();
  $effect(() => {
    const element = list;
    if (!element) return;
    const phones = matchMedia('(max-width: 699px)');
    const measure = () => (view.stationsHeight = phones.matches ? element.offsetHeight + GAP : 0);
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    phones.addEventListener('change', measure);
    return () => {
      observer.disconnect();
      phones.removeEventListener('change', measure);
      view.stationsHeight = 0;
    };
  });
</script>

<!-- Out of the way of a panel, which takes the same corner (or the sheet, the same strip), and of riding along -->
{#if !selection.current && !selection.following && !sky.place}
  <section class="stations" aria-labelledby="stations-title" bind:this={list}>
    <h2 id="stations-title" class="title">Space stations</h2>
    <ul>
      {#each STATIONS as { norad, name } (norad)}
        <li class="station">
          <button class="name" type="button" disabled={!view.ready} onclick={() => view.showStation(norad, false)}>{name}</button>
          <button class="ride" type="button" aria-label="Follow {name}" disabled={!view.ready} onclick={() => view.showStation(norad, true)}>
            <span>Follow</span>
          </button>
        </li>
      {/each}
    </ul>
  </section>
{/if}

<style>
  /* Wide screens: a quiet list in the lower right, across from the kinds on the left, just above the timeline */
  .stations {
    -webkit-user-select: none;
    user-select: none;
    position: fixed;
    z-index: 1;
    right: var(--gutter);
    bottom: calc(var(--sheet, 0px) + var(--timeline, 7rem) + var(--space-6) + env(safe-area-inset-bottom));
    min-width: 11rem;
    margin: 0;
  }

  .title {
    margin: 0 0 var(--space-1);
    font-size: var(--size-label);
    font-weight: 600;
    color: var(--muted);
  }

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .station {
    display: flex;
    align-items: center;
    gap: var(--space-4);
  }

  button {
    min-height: 34px;
    padding: 0;
    border: 0;
    background: none;
    font: inherit;
    color: inherit;
    cursor: pointer;
  }

  button:disabled {
    cursor: default;
    opacity: 0.5;
  }

  .name {
    flex: 1 1 auto;
    min-width: 0;
    text-align: left;
    font-size: var(--size-label);
    font-weight: 600;
    color: var(--ink);
    text-decoration: underline;
    text-decoration-color: transparent;
    text-underline-offset: 0.25em;
    transition: text-decoration-color 0.2s;
  }

  .name:not(:disabled):hover {
    text-decoration-color: var(--line);
  }

  /* An amber tag, as on a pass's "Watch" in the sky panel */
  .ride span {
    display: block;
    padding: 0.2em 0.65em;
    font-size: var(--size-label);
    font-weight: 650;
    color: var(--void);
    background: var(--glint);
    clip-path: polygon(5px 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%, 0 5px);
    transition: filter 0.2s;
  }

  .ride:not(:disabled):hover span {
    filter: brightness(1.08);
  }

  .ride:not(:disabled):active span {
    filter: brightness(0.94);
  }

  @media (pointer: coarse) {
    button {
      min-height: 44px;
    }
  }

  /* Tablets held upright have the globe behind the list, so it sits on a panel, as the kinds do */
  @media (orientation: portrait) and (min-width: 700px) {
    .stations {
      padding: var(--space-2) var(--space-4);
      background: linear-gradient(155deg, var(--raise) 0 14%, var(--deck) 14% 100%);
      clip-path: var(--facet-cut);
    }
  }

  /* Upright phones: a row of two facet cards above the timeline, there once the headline steps aside */
  @media (max-width: 699px) {
    .stations {
      left: var(--gutter);
      bottom: calc(var(--timeline, 7rem) + var(--space-3) + env(safe-area-inset-bottom));
      min-width: 0;
      transition: opacity 0.5s ease;
    }

    :global(html:not(.exploring)) .stations {
      visibility: hidden;
      opacity: 0;
    }

    .title {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }

    ul {
      display: flex;
      gap: var(--space-2);
    }

    button {
      min-height: 44px;
    }

    .station {
      position: relative;
      isolation: isolate;
      flex: 1 1 0;
      min-width: 0;
      gap: 0;
    }

    .station::before {
      content: '';
      position: absolute;
      inset: 0;
      z-index: -1;
      background: linear-gradient(155deg, var(--raise) 0 48%, var(--deck) 48% 100%);
      clip-path: var(--facet-cut);
    }

    .name {
      padding: 0 var(--space-2) 0 var(--space-4);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .ride {
      flex: none;
      padding: 0 var(--space-2) 0 0;
    }
  }
</style>
