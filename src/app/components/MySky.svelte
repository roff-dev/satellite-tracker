<script lang="ts">
  import { tick } from 'svelte';
  import { sky } from '../sky.svelte';
  import { view } from '../view.svelte';
  import { findPlaces, type Place } from '../../location/places';
  import { fromPlace, locate, placeDetail, savedPlace } from '../../location/location';

  let button = $state<HTMLButtonElement>();
  let panel = $state<HTMLElement>();
  let field = $state<HTMLInputElement>();
  let query = $state('');
  let results = $state<Place[]>([]);
  let searched = $state(false);
  let locating = $state(false);
  let message = $state('');

  /** On: off again. Off: straight to the place last chosen, or the chooser the first time. */
  function toggle() {
    view.explore();
    if (sky.place) return sky.hide();
    const saved = savedPlace();
    if (saved) return sky.show(saved);
    sky.choosing = !sky.choosing;
  }

  async function useLocation() {
    locating = true;
    message = '';
    try {
      sky.show(await locate());
    } catch (reason) {
      message = reason === 'denied' ? 'No problem: search for a town instead.' : 'Your location isn’t available right now. Search for a town instead.';
      await tick();
      field?.focus();
    } finally {
      locating = false;
    }
  }

  // Each search waits for a pause in typing; an answer to an older query is dropped
  let typing: ReturnType<typeof setTimeout> | undefined;
  function onInput() {
    clearTimeout(typing);
    const asked = query;
    typing = setTimeout(async () => {
      const found = await findPlaces(asked, 6);
      if (asked !== query) return;
      results = found;
      searched = asked.trim().length >= 2;
    }, 120);
  }

  function close(refocus = true) {
    sky.choosing = false;
    if (refocus) button?.focus();
  }

  function onKey(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    event.preventDefault();
    close();
  }

  // Opened from the panel's "Change place" too: the first control takes focus, and a click outside closes it
  $effect(() => {
    if (!sky.choosing) return;
    message = '';
    void tick().then(() => panel?.querySelector<HTMLElement>('.button')?.focus());
    const outside = (event: PointerEvent) => {
      if (!panel?.contains(event.target as Node) && !button?.contains(event.target as Node)) close(false);
    };
    addEventListener('pointerdown', outside, true);
    return () => removeEventListener('pointerdown', outside, true);
  });
</script>

<div class="my-sky">
  <button bind:this={button} class="chip icon" type="button" aria-label="My sky" aria-pressed={!!sky.place} aria-haspopup="dialog" disabled={!view.ready} onclick={toggle}>
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path fill="currentColor" opacity="0.45" d="M3 17 5 10.6 9.4 6.6h5.2l4.4 4 2 6.4h-2.4l-1.6-5.2-3.4-3H10.4l-3.4 3L5.4 17z" />
      <path fill="currentColor" d="M12 12.6 14.4 15 12 17.4 9.6 15zM2 19.2h20v1.6H2z" />
    </svg>
  </button>

  {#if sky.choosing}
    <div bind:this={panel} class="chooser" role="dialog" aria-labelledby="chooser-title" tabindex="-1" onkeydown={onKey}>
      <h3 id="chooser-title">Your sky</h3>
      <p>See what’s above you right now, and when the space stations next pass over.</p>
      <button class="button" type="button" onclick={useLocation} disabled={locating}>{locating ? 'Finding you…' : 'Use my location'}</button>
      {#if message}<p class="message" role="status">{message}</p>{/if}

      <label for="place-query">Or find a town</label>
      <input bind:this={field} bind:value={query} oninput={onInput} id="place-query" type="search" placeholder="Town or city" autocomplete="off" spellcheck="false" />
      {#if results.length}
        <ul class="places">
          {#each results as place (place.name + place.lat + place.lon)}
            <li>
              <button type="button" onclick={() => sky.show(fromPlace(place))}>
                <span class="name">{place.name}</span>
                <span class="where">{placeDetail(place)}</span>
              </button>
            </li>
          {/each}
        </ul>
      {:else if searched}
        <p class="note">No town by that name. Try a nearby city.</p>
      {/if}
      <p class="note">Your location stays on this device.</p>
    </div>
  {/if}
</div>

<style>
  .my-sky {
    position: relative;
  }

  .icon {
    width: 44px;
    justify-content: center;
    padding: 0;
  }

  /* On: the amber facet */
  .icon[aria-pressed='true'] {
    color: var(--void);
  }

  .icon[aria-pressed='true']::before {
    background: linear-gradient(155deg, color-mix(in oklab, var(--glint), white 22%) 0 48%, var(--glint) 48% 100%);
  }

  /* Under the top bar at the right on every screen, so it never runs off a phone's edge */
  .chooser {
    position: fixed;
    z-index: 5;
    top: calc(var(--space-4) + env(safe-area-inset-top) + 44px + var(--space-2));
    right: var(--gutter);
    width: min(22rem, calc(100vw - 2 * var(--gutter)));
    max-height: calc(100svh - 6rem);
    overflow-y: auto;
    padding: var(--space-4);
    background: linear-gradient(155deg, var(--raise) 0 14%, var(--deck) 14% 100%);
    clip-path: var(--facet-cut);
    animation: open 0.2s cubic-bezier(0.2, 0.7, 0.2, 1);
  }

  .chooser:focus {
    outline: none;
  }

  @keyframes open {
    from {
      opacity: 0;
      translate: 0 -6px;
    }
  }

  h3 {
    margin: 0 0 var(--space-2);
    font-size: var(--size-label);
    font-weight: 600;
    color: var(--muted);
  }

  p {
    margin: 0 0 var(--space-3);
    font-size: 0.9375rem;
    text-wrap: pretty;
  }

  .button {
    width: 100%;
    justify-content: center;
  }

  .message {
    margin: var(--space-3) 0 0;
    font-size: var(--size-label);
    font-weight: 600;
    color: var(--glint);
  }

  label {
    display: block;
    margin: var(--space-4) 0 var(--space-2);
    font-size: var(--size-label);
    font-weight: 600;
    color: var(--muted);
  }

  /* A facet-cut field, like the search box */
  input {
    width: 100%;
    min-height: 44px;
    padding: 0 var(--space-3);
    border: 0;
    color: var(--ink);
    font: 400 1rem var(--font-text);
    background: var(--void);
    clip-path: var(--facet-cut);
  }

  input::placeholder {
    color: var(--faint);
  }

  input:focus-visible {
    outline: none;
    box-shadow: inset 0 0 0 2px var(--glint);
  }

  .places {
    margin: var(--space-2) 0 0;
    padding: 0;
    list-style: none;
  }

  .places button {
    display: flex;
    flex-direction: column;
    justify-content: center;
    width: 100%;
    min-height: 48px;
    padding: var(--space-1) var(--space-2);
    border: 0;
    border-bottom: 1px solid var(--line);
    background: none;
    color: var(--ink);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .places button:hover {
    background: var(--raise);
  }

  .name {
    font-weight: 600;
  }

  .where {
    font-size: var(--size-label);
    color: var(--muted);
  }

  .note {
    margin: var(--space-3) 0 0;
    font-size: var(--size-label);
    color: var(--muted);
  }
</style>
