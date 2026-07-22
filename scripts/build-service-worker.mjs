import { generateSW } from 'workbox-build';

const { count, size, warnings } = await generateSW({
  globDirectory: 'dist',
  globPatterns: ['**/*.{css,html,js,png,svg,webmanifest}'],
  swDest: 'dist/sw.js',
  navigateFallback: '/index.html',
  cleanupOutdatedCaches: true,
  clientsClaim: true,
  skipWaiting: true,
  mode: 'production',
});

for (const warning of warnings) console.warn(warning);
console.log(`Service worker precached ${count} files (${size} bytes).`);
