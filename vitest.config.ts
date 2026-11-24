import { defineConfig } from 'vitest/config';

// Windows starts processes several times slower than macOS and Linux, and many tests run git (or npm) a dozen times or
// more: on CI's Windows runners such tests take 1–5 s, at Vitest's default 5 s test and 10 s hook limits, and a slower
// runner tips them over. Windows gets more room; elsewhere the defaults still catch a test that has slowed down.
const windows = process.platform === 'win32';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs'],
    ...(windows && { testTimeout: 20_000, hookTimeout: 30_000 }),
  },
});
