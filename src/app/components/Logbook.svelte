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

  let time = $state(clock.time);

  onMount(() => {
    const id = setInterval(() => (time = clock.time), 250);
    return () => clearInterval(id);
  });
</script>

<p class="logbook"><time datetime={new Date(time).toISOString()}>{format.format(time)}</time></p>

<style>
  .logbook {
    position: fixed;
    z-index: 2;
    left: var(--gutter);
    bottom: calc(var(--space-4) + env(safe-area-inset-bottom));
    margin: 0;
    font: 450 0.9375rem / 1 var(--font-data);
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
</style>
