import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    testTimeout: 15_000,
    clearMocks: true,
    // Integration suites share one live MongoDB, so files run one at a time.
    fileParallelism: false,
    // Makes the Google integration "configured" so its code paths are reachable. No test hits
    // the network: suites without a seeded OAuth account fail before any request is made, and
    // the meeting suite stubs global fetch.
    env: {
      GOOGLE_CLIENT_ID: 'test-google-client-id',
      GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
      // Keeps test jobs out of the default `bull:` namespace. Without this a dev server running
      // against the same Redis consumes them before the assertions can see them.
      QUEUE_PREFIX: 'bull-test',
    },
  },
})
