import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    // Forked workers inherit NODE_EXTRA_CA_CERTS set by the global setup.
    pool: 'forks',
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
