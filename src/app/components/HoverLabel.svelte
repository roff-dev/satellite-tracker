<script lang="ts">
  import { selection } from '../selection.svelte';

  const hover = $derived(selection.hover);
</script>

{#if hover}
  <p class="hover" style:transform="translate({hover.x + 14}px, {hover.y + 14}px)" aria-hidden="true">{hover.name}</p>
{/if}

<style>
  /* The name of whatever a resting mouse is over: a small facet-cut label that follows the pointer */
  .hover {
    position: fixed;
    z-index: 4;
    top: 0;
    left: 0;
    margin: 0;
    padding: var(--space-1) var(--space-3);
    max-width: 18rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--size-label);
    font-weight: 600;
    color: var(--ink);
    pointer-events: none;
    isolation: isolate;
  }

  .hover::before {
    content: '';
    position: absolute;
    inset: 0;
    z-index: -1;
    background: linear-gradient(155deg, var(--raise) 0 40%, var(--deck) 40% 100%);
    clip-path: polygon(6px 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%, 0 6px);
  }
</style>
