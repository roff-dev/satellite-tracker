<script lang="ts">
  import { GROUPS, type ColourBy } from '../../data/groups';
  import { view } from '../view.svelte';

  const COLOURS: { mode: ColourBy; label: string; key: [string, string][] }[] = [
    {
      mode: 'light',
      label: 'Sunlight',
      key: [
        ['var(--glint)', 'In sunlight'],
        ['var(--cool)', 'In Earth’s shadow'],
      ],
    },
    {
      mode: 'type',
      label: 'Type',
      key: [
        ['var(--glint)', 'Working satellite'],
        ['var(--muted)', 'Inactive satellite'],
        ['var(--flare)', 'Rocket body'],
        ['var(--faint)', 'Debris'],
      ],
    },
    {
      mode: 'orbit',
      label: 'Orbit',
      key: [
        ['var(--cool)', 'Low Earth orbit'],
        ['var(--glint)', 'Medium Earth orbit'],
        ['var(--flare)', 'Geosynchronous'],
        ['var(--ink)', 'Highly elliptical'],
      ],
    },
  ];

  let open = $state(false);
  let button = $state<HTMLButtonElement>();
  let panel = $state<HTMLElement>();

  function close(refocus = true) {
    open = false;
    if (refocus) button?.focus();
  }

  function onKey(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    close();
  }

  // A click anywhere outside closes it
  $effect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!panel?.contains(event.target as Node) && !button?.contains(event.target as Node)) close(false);
    };
    addEventListener('pointerdown', outside, true);
    return () => removeEventListener('pointerdown', outside, true);
  });

  const current = $derived(COLOURS.find((c) => c.mode === view.colourBy)!);
</script>

<div class="view-menu">
  <button
    bind:this={button}
    class="chip icon"
    type="button"
    aria-label="View options"
    aria-expanded={open}
    aria-controls="view-panel"
    disabled={!view.ready}
    onclick={() => {
      open = !open;
      // Reaching for the controls counts as exploring: the headline steps aside
      view.explore();
    }}
  >
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M12 3l9 5-9 5-9-5z" /><path fill="currentColor" d="M3 12.2l2.4-1.3L12 14.6l6.6-3.7 2.4 1.3-9 5z" opacity="0.7" /><path fill="currentColor" d="M3 16.2l2.4-1.3L12 18.6l6.6-3.7 2.4 1.3-9 5z" opacity="0.45" /></svg>
  </button>

  {#if open}
    <div bind:this={panel} id="view-panel" class="panel" role="dialog" aria-label="View options" tabindex="-1" onkeydown={onKey}>
      <section aria-labelledby="pick-title">
        <h3 id="pick-title">Pick out</h3>
        <div class="chips">
          {#each GROUPS as group (group.slug)}
            <button class="chip" class:on={view.group === group.slug} type="button" aria-pressed={view.group === group.slug} onclick={() => view.setGroup(view.group === group.slug ? null : group.slug)}>
              {group.label}
            </button>
          {/each}
        </div>
      </section>

      <section aria-labelledby="colour-title">
        <h3 id="colour-title">Colour by</h3>
        <div class="chips" role="radiogroup" aria-labelledby="colour-title">
          {#each COLOURS as option (option.mode)}
            <button class="chip" class:on={view.colourBy === option.mode} type="button" role="radio" aria-checked={view.colourBy === option.mode} onclick={() => view.setColourBy(option.mode)}>
              {option.label}
            </button>
          {/each}
        </div>
        <ul class="key">
          {#each current.key as [colour, label] (label)}
            <li><span class="swatch" style:background={colour}></span>{label}</li>
          {/each}
        </ul>
      </section>

    </div>
  {/if}
</div>

<style>
  .view-menu {
    position: relative;
  }

  .icon {
    width: 44px;
    justify-content: center;
    padding: 0;
  }

  .panel {
    position: absolute;
    top: calc(100% + var(--space-2));
    right: 0;
    z-index: 5;
    width: min(22rem, calc(100vw - 2 * var(--gutter)));
    max-height: calc(100svh - 7rem);
    overflow-y: auto;
    padding: var(--space-4) var(--space-4) var(--space-2);
    background: linear-gradient(155deg, var(--raise) 0 14%, var(--deck) 14% 100%);
    clip-path: var(--facet-cut);
    animation: open 0.2s cubic-bezier(0.2, 0.7, 0.2, 1);
  }

  .panel:focus {
    outline: none;
  }

  @keyframes open {
    from {
      opacity: 0;
      translate: 0 -6px;
    }
  }

  section {
    padding: var(--space-3) 0;
  }

  section + section {
    border-top: 1px solid var(--line);
  }

  h3 {
    margin: 0 0 var(--space-3);
    font-size: var(--size-label);
    font-weight: 600;
    color: var(--muted);
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .chips .chip {
    font-size: var(--size-label);
  }

  /* Chosen: the amber facet */
  .chip.on {
    color: var(--void);
  }

  .chip.on::before {
    background: linear-gradient(155deg, color-mix(in oklab, var(--glint), white 22%) 0 48%, var(--glint) 48% 100%);
  }

  .key {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-2) var(--space-4);
    margin: var(--space-3) 0 0;
    padding: 0;
    list-style: none;
    font-size: var(--size-label);
    color: var(--muted);
  }

  .key li {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  /* Each key colour as a small facet, the shape the points read as */
  .swatch {
    flex: none;
    width: 10px;
    height: 10px;
    clip-path: polygon(50% 0, 100% 50%, 50% 100%, 0 50%);
  }
</style>
