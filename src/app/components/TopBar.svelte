<script lang="ts">
  import { onMount } from 'svelte';
  import { GROUPS } from '../../data/groups';
  import { PHONE, view } from '../view.svelte';
  import { selection } from '../selection.svelte';
  import Search from './Search.svelte';
  import ViewMenu from './ViewMenu.svelte';
  import MySky from './MySky.svelte';
  import TypeFilter from './TypeFilter.svelte';

  const number = new Intl.NumberFormat('en-GB');
  const group = $derived(view.group ? GROUPS.find((g) => g.slug === view.group) : null);

  // Narrow screens tuck search behind a button
  let compact = $state(false);
  let phone = $state(false);
  onMount(() => {
    const narrow = matchMedia('(max-width: 699px)');
    const phones = matchMedia(PHONE);
    const update = () => {
      compact = narrow.matches;
      phone = phones.matches;
    };
    update();
    narrow.addEventListener('change', update);
    phones.addEventListener('change', update);
    return () => {
      narrow.removeEventListener('change', update);
      phones.removeEventListener('change', update);
    };
  });

  // On phones the controls run across the top, so the globe centres itself below them
  let bar = $state<HTMLElement>();
  $effect(() => {
    const top = bar;
    if (!top || !phone) return;
    const observer = new ResizeObserver(() => (view.topInset = Math.round(top.getBoundingClientRect().bottom)));
    observer.observe(top);
    return () => {
      observer.disconnect();
      view.topInset = 0;
    };
  });
</script>

{#if !selection.following}
  <div class="top-bar" bind:this={bar}>
    <div class="row">
      {#if group && !compact}
        <button class="chip filter" type="button" onclick={() => view.setGroup(null)} aria-label="Show everything again ({group.label} picked out)">
          {group.label}<span class="count">{number.format(view.groupCount)}</span>
          <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M3 2 14 13l-1 1L2 3zM13 2l1 1L3 14l-1-1z" fill="currentColor" /></svg>
        </button>
      {/if}
      <Search {compact} />
      <MySky />
      <ViewMenu />
    </div>
    <!-- An open sheet has the object's details; the group chip and kinds step aside so its path stays in view -->
    {#if group && compact && !selection.sheetOpen}
      <button class="chip filter" type="button" onclick={() => view.setGroup(null)} aria-label="Show everything again ({group.label} picked out)">
        {group.label}<span class="count">{number.format(view.groupCount)}</span>
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M3 2 14 13l-1 1L2 3zM13 2l1 1L3 14l-1-1z" fill="currentColor" /></svg>
      </button>
    {/if}
    <TypeFilter />
  </div>
{/if}

<style>
  .top-bar {
    position: fixed;
    z-index: 4;
    top: calc(var(--space-4) + env(safe-area-inset-top));
    right: var(--gutter);
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: var(--space-2);
  }

  /* Phones: the bar spans the screen so the kinds can run across it; touches between controls reach the globe */
  @media (max-width: 699px), (orientation: landscape) and (max-height: 500px) {
    .top-bar {
      left: var(--gutter);
      pointer-events: none;
    }

    .top-bar > :global(*:not(.types)) {
      pointer-events: auto;
    }
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  /* The group being picked out, in amber, so it's clear why the rest is dim */
  .filter {
    gap: var(--space-2);
    color: var(--void);
    font-size: var(--size-label);
  }

  .filter::before {
    background: linear-gradient(155deg, color-mix(in oklab, var(--glint), white 22%) 0 48%, var(--glint) 48% 100%);
  }

  .count {
    font-variant-numeric: tabular-nums;
    font-weight: 500;
  }
</style>
