<script lang="ts">
  import { padNumbers } from '../lib/pads';
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
    {#each padNumbers as pad (pad)}
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
