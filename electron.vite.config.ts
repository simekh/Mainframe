import { defineConfig } from 'electron-vite';
import solid from 'vite-plugin-solid';

export default defineConfig({
  main: {},
  // The preload runs sandboxed, so it may require nothing but `electron`: bundle every dependency.
  preload: { build: { externalizeDeps: false } },
  renderer: { plugins: [solid()] },
});
