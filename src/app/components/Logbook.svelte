<script lang="ts">
  import { onMount } from 'svelte';
  import { clock } from '../../time/clock';

  const format = new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  let entry = $state(format.format(clock.time));

  onMount(() => {
    const id = setInterval(() => (entry = format.format(clock.time)), 250);
    return () => clearInterval(id);
  });
</script>

<p class="logbook"><time datetime={new Date(clock.time).toISOString()}>{entry}</time></p>

<style>
  .logbook {
    position: fixed;
    z-index: 2;
    left: var(--gutter);
    bottom: calc(var(--space-4) + env(safe-area-inset-bottom));
    margin: 0;
    font: italic 400 1.0625rem / 1 var(--font-display);
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
</style>
