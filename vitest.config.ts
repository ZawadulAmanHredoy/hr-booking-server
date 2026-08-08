import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    testTimeout: 15_000,
    clearMocks: true,
    // Integration suites share one live MongoDB, so files run one at a time.
    fileParallelism: false,
  },
})
