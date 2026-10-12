<script lang="ts">
  import { onMount } from 'svelte';
  import { view } from '../view.svelte';
  import { loadNames, names } from '../names.svelte';
  import type { SearchResult } from '../../data/protocol';
  import Scrollbar from './Scrollbar.svelte';

  let { compact = false }: { compact?: boolean } = $props();

  const KIND = { payload: 'Satellite', rocket: 'Rocket body', debris: 'Debris' } as const;
  const ORBIT = { leo: 'low orbit', meo: 'medium orbit', geo: 'geosynchronous', heo: 'highly elliptical' } as const;

  let query = $state('');
  let results = $state<SearchResult[]>([]);
  let searched = $state(false);
  let active = $state(0);
  let open = $state(false);
  let expanded = $state(false);
  let input = $state<HTMLInputElement>();
  let list = $state<HTMLElement>();

  $effect(() => {
    view.resultsOpen = open && searched;
    return () => (view.resultsOpen = false);
  });

  // Each keystroke waits briefly, and only the latest search is shown
  let latest = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  function onInput() {
    loadNames();
    clearTimeout(timer);
    const q = query.trim();
    if (!q) {
      results = [];
      searched = false;
      return;
    }
    timer = setTimeout(async () => {
      const ticket = ++latest;
      const found = await view.search(q);
      if (ticket !== latest) return;
      results = found;
      searched = true;
      active = 0;
      open = true;
    }, 120);
  }

  function choose(result: SearchResult) {
    view.selectFound(result);
    query = '';
    results = [];
    searched = false;
    open = false;
    expanded = false;
    input?.blur();
  }

  function onKey(event: KeyboardEvent) {
    if (event.key === 'ArrowDown' && results.length) active = (active + 1) % results.length;
    else if (event.key === 'ArrowUp' && results.length) active = (active - 1 + results.length) % results.length;
    else if (event.key === 'Enter' && results[active]) choose(results[active]!);
    else if (event.key === 'Escape') {
      if (query) query = '';
      else {
        expanded = false;
        input?.blur();
      }
      results = [];
      searched = false;
    } else return;
    event.preventDefault();
    // Keep the globe's own keys (Escape deselects) out of the way while typing
    event.stopPropagation();
  }

  function describe(result: SearchResult) {
    const kind = result.station ? 'Space station' : KIND[result.type];
    // The short form of the owner here; the panel gives the full one
    const owner = (names.table?.owners[result.country] ?? result.country).replace(/ \(.*\)$/, '');
    return [kind, owner, ORBIT[result.orbitClass]].filter(Boolean).join(', ');
  }

  // "/" anywhere puts the cursor in the search field
  onMount(() => {
    const slash = (event: KeyboardEvent) => {
      if (event.key !== '/' || (event.target instanceof Element && event.target.closest('input, textarea, [contenteditable]'))) return;
      event.preventDefault();
      expanded = true;
      queueMicrotask(() => input?.focus());
    };
    addEventListener('keydown', slash);
    return () => removeEventListener('keydown', slash);
  });
</script>

<div class="search" class:compact class:expanded>
  {#if compact && !expanded}
    <button class="chip icon" type="button" aria-label="Search" onclick={() => ((expanded = true), queueMicrotask(() => input?.focus()))}>
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M7 3h6l4 4v6l-4 4H7l-4-4V7zm1.4 3L6 8.4v3.2L8.4 14h3.2L14 11.6V8.4L11.6 6z" /><path fill="currentColor" d="m15.6 14.2 6 6-1.4 1.4-6-6z" /></svg>
    </button>
  {:else}
    <div class="field">
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M7 3h6l4 4v6l-4 4H7l-4-4V7zm1.4 3L6 8.4v3.2L8.4 14h3.2L14 11.6V8.4L11.6 6z" /><path fill="currentColor" d="m15.6 14.2 6 6-1.4 1.4-6-6z" /></svg>
      <input
        bind:this={input}
        bind:value={query}
        oninput={onInput}
        onkeydown={onKey}
        onfocus={() => {
          open = true;
          view.explore();
        }}
        onblur={() => setTimeout(() => ((open = false), compact && !query && (expanded = false)), 150)}
        type="search"
        placeholder="Find by name or number"
        aria-label="Search satellites by name, catalogue number or international designator"
        role="combobox"
        aria-expanded={open && searched}
        aria-controls="search-results"
        aria-activedescendant={open && results.length ? `result-${active}` : undefined}
        autocomplete="off"
        spellcheck="false"
        disabled={!view.ready}
      />
      {#if compact}
        <button class="chip icon close" type="button" aria-label="Close search" onclick={() => ((expanded = false), (query = ''), (results = []), (searched = false))}>
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3 2 14 13l-1 1L2 3zM13 2l1 1L3 14l-1-1z" fill="currentColor" /></svg>
        </button>
      {/if}
    </div>
    {#if open && searched}
      <ul bind:this={list} id="search-results" role="listbox" aria-label="Search results">
        {#each results as result, i (result.slot)}
          <!-- The row is the option itself; keys reach it through the field (arrows and Enter, by aria-activedescendant),
               and pressing it never takes focus from the field -->
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <li
            id="result-{i}"
            class="result"
            role="option"
            tabindex="-1"
            aria-selected={i === active}
            class:active={i === active}
            onmousedown={(e) => e.preventDefault()}
            onclick={() => choose(result)}
            onmouseenter={() => (active = i)}
          >
            <span class="name">{result.match ?? result.name}</span>
            <span class="meta">{result.match ? `Docked with ${result.name}` : describe(result)}</span>
          </li>
        {:else}
          <li class="empty" role="option" aria-selected="false" aria-disabled="true">Nothing in orbit by that name. Try its catalogue number, like 25544 for the ISS.</li>
        {/each}
      </ul>
      {#if !compact}<Scrollbar target={list} offset={-8} top={8} />{/if}
    {/if}
  {/if}
</div>

<style>
  /* On wide screens the field and the two buttons beside it span the same 22rem as the menus they open */
  .search {
    position: relative;
    width: calc(22rem - 2 * 44px - 2 * var(--space-2));
  }

  .search.compact {
    width: auto;
  }

  /* Phones: the open field spans the top of the screen */
  .search.compact.expanded {
    position: fixed;
    top: calc(var(--space-4) + env(safe-area-inset-top));
    left: var(--gutter);
    right: var(--gutter);
    z-index: 5;
    width: auto;
  }

  .field {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 44px;
    padding: 0 var(--space-2) 0 var(--space-3);
    color: var(--muted);
    isolation: isolate;
    transition: color 0.2s;
  }

  .field::before {
    content: '';
    position: absolute;
    inset: 0;
    z-index: -1;
    background: var(--deck);
    clip-path: var(--facet-cut);
  }

  /* Focused, the field's facet lights and a thin amber edge draws in along its foot, up to the cut corner; the
     caret shows where you type, so it needs nothing louder */
  .field::after {
    content: '';
    position: absolute;
    left: 0;
    right: var(--chamfer);
    bottom: 0;
    height: 2px;
    background: var(--glint);
    scale: 0 1;
    transform-origin: left;
    transition: scale 0.38s var(--spring);
  }

  .field:focus-within {
    color: var(--ink);
  }

  .field:focus-within::before {
    background: linear-gradient(155deg, var(--raise) 0 30%, var(--deck) 30% 100%);
  }

  .field:focus-within::after {
    scale: 1 1;
  }

  input {
    flex: 1;
    min-width: 0;
    height: 44px;
    border: 0;
    background: none;
    color: var(--ink);
    font: 400 1rem / 1 var(--font-text);
    outline: none;
  }

  input::placeholder {
    color: var(--faint);
  }

  input::-webkit-search-cancel-button {
    display: none;
  }

  .icon {
    width: 44px;
    justify-content: center;
    padding: 0;
  }

  .close {
    min-height: 36px;
    width: 36px;
  }

  ul {
    position: absolute;
    top: calc(100% + var(--space-2));
    left: 0;
    right: 0;
    max-height: min(26rem, 60svh);
    overflow-y: auto;
    margin: 0;
    padding: var(--space-2);
    list-style: none;
    background: linear-gradient(155deg, var(--raise) 0 12%, var(--deck) 12% 100%);
    clip-path: var(--facet-cut);
  }

  /* Wide screens: results open as wide as the menus beside the field, lined up with them, with room on the right for
     the faceted scrollbar in place of the browser's */
  .search:not(.compact) ul {
    right: auto;
    width: 22rem;
    padding-right: var(--space-4);
    scrollbar-width: none;
  }

  .search:not(.compact) ul::-webkit-scrollbar {
    display: none;
  }

  .result {
    display: grid;
    gap: 2px;
    min-height: 44px;
    padding: var(--space-2) var(--space-3);
    color: var(--ink);
    cursor: pointer;
    clip-path: polygon(6px 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%, 0 6px);
  }

  .result.active {
    background: var(--raise);
  }

  .name {
    font-weight: 600;
    font-size: 0.9375rem;
    overflow-wrap: anywhere;
  }

  .meta {
    font-size: var(--size-label);
    color: var(--muted);
  }

  .empty {
    padding: var(--space-3);
    font-size: var(--size-label);
    color: var(--muted);
  }
</style>
