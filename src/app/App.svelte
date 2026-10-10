<script lang="ts">
  import { PORTFOLIO_URL } from '../site';
</script>

<footer class="byline">
  <a href={PORTFOLIO_URL}>Kieron Oates · More of my work →</a>
</footer>

<style>
  .byline {
    position: fixed;
    right: var(--gutter);
    bottom: calc(var(--space-4) + env(safe-area-inset-bottom));
    font-size: var(--size-label);
    color: var(--faint);
  }

  .byline a {
    text-decoration: none;
  }

  .byline a:hover {
    color: var(--ink);
  }
</style>
