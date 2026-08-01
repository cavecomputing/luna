import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Node by default. Renderer tests opt in per file with:
    //   // @vitest-environment jsdom
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    restoreMocks: true,
  },
})
