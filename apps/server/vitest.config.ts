import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 20_000,
    hookTimeout: 30_000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ?? 'postgres://sixfinger:sixfinger@127.0.0.1:5432/sixfinger_test',
      JWT_SECRET: 'test-secret-test-secret-test-secret-1234',
      LOG_LEVEL: 'silent',
    },
  },
});
