<script lang="ts">
  import { selection } from '../selection.svelte';

  let stop = $state<HTMLButtonElement>();
  // Keyboard focus moves to the one control there is while riding along
  $effect(() => {
    if (selection.following) stop?.focus({ preventScroll: true });
  });
</script>

{#if selection.following}
  <div class="follow" role="status">
    <p>Riding with <strong>{selection.following}</strong></p>
    <button bind:this={stop} class="button" type="button" onclick={() => selection.stopFollowing()}>Stop following</button>
  </div>
{/if}

<style>
  .follow {
    position: fixed;
    z-index: 3;
    left: 50%;
    bottom: calc(var(--space-12) + env(safe-area-inset-bottom));
    translate: -50% 0;
    display: flex;
    align-items: center;
    gap: var(--space-4);
    max-width: calc(100vw - 2 * var(--gutter));
    padding: var(--space-2) var(--space-2) var(--space-2) var(--space-4);
    isolation: isolate;
    animation: rise 0.4s 0.6s cubic-bezier(0.2, 0.7, 0.2, 1) backwards;
  }

  .follow::before {
    content: '';
    position: absolute;
    inset: 0;
    z-index: -1;
    background: linear-gradient(155deg, var(--raise) 0 30%, var(--deck) 30% 100%);
    clip-path: var(--facet-cut);
  }

  @keyframes rise {
    from {
      opacity: 0;
      translate: -50% 8px;
    }
  }

  p {
    margin: 0;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--size-label);
    color: var(--muted);
  }

  strong {
    color: var(--ink);
    font-weight: 600;
  }

  .button {
    flex: none;
  }
</style>
