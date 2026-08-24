import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/global-setup.ts'],
    // The suite shares one database; running files in parallel would have them
    // truncating tables under each other.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://basalt:basalt@localhost:5432/basalt_test',
      STORAGE_DRIVER: 'local',
      STORAGE_LOCAL_ROOT: './var/test-blobs',
      MAX_UPLOAD_BYTES: '2097152', // 2 MB — keeps the limit tests quick
      DEFAULT_QUOTA_BYTES: '5242880', // 5 MB
      MAX_FILES_PER_UPLOAD: '5',
      LOG_LEVEL: 'silent',
      ACCESS_TOKEN_SECRET: 'test-access-secret-test-access-secret-1234',
      REFRESH_TOKEN_PEPPER: 'test-refresh-pepper-test-refresh-pepper-12',
    },
  },
});
