<script lang="ts">
  const pads = Array.from({ length: 12 }, (_, index) => index + 1);
</script>

<main class="app-shell">
  <header>
    <div>
      <p class="eyebrow">Makey Makey</p>
      <h1>Sampler</h1>
    </div>
    <span class="status">Ready</span>
  </header>

  <section class="pad-grid" aria-label="Sampler pads">
    {#each pads as pad (pad)}
      <button class="pad" type="button" disabled aria-label={`Pad ${pad}`}>
        <span>{pad}</span>
        <small>Empty</small>
      </button>
    {/each}
  </section>

  <nav aria-label="Sampler tools">
    <button type="button" disabled>Sounds</button>
    <button type="button" disabled>Record</button>
    <button type="button" disabled>Loop</button>
  </nav>
</main>
