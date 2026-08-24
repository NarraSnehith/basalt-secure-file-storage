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
      // supertest talks to the app over loopback on an ephemeral port. Some
      // sandboxed environments route outbound HTTP through a proxy that will
      // happily intercept that too, answering with its own error, so tell every
      // layer that honours these to leave loopback alone.
      NO_PROXY: '127.0.0.1,localhost,::1',
      no_proxy: '127.0.0.1,localhost,::1',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://basalt:basalt@localhost:5432/basalt_test',
      // Local disk by default, but overridable so the same suite can be run
      // against a real S3-compatible server:
      //   STORAGE_DRIVER=s3 S3_BUCKET=… S3_ENDPOINT=… npm test
      // The storage port is the one piece of infrastructure a unit test cannot
      // stand in for, so it is worth being able to exercise for real.
      STORAGE_DRIVER: process.env.STORAGE_DRIVER ?? 'local',
      STORAGE_LOCAL_ROOT: process.env.STORAGE_LOCAL_ROOT ?? './var/test-blobs',
      ...(process.env.S3_BUCKET ? { S3_BUCKET: process.env.S3_BUCKET } : {}),
      ...(process.env.S3_REGION ? { S3_REGION: process.env.S3_REGION } : {}),
      ...(process.env.S3_ENDPOINT ? { S3_ENDPOINT: process.env.S3_ENDPOINT } : {}),
      ...(process.env.S3_ACCESS_KEY_ID ? { S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID } : {}),
      ...(process.env.S3_SECRET_ACCESS_KEY ? { S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY } : {}),
      ...(process.env.S3_FORCE_PATH_STYLE ? { S3_FORCE_PATH_STYLE: process.env.S3_FORCE_PATH_STYLE } : {}),
      ...(process.env.S3_ACL ? { S3_ACL: process.env.S3_ACL } : {}),
      MAX_UPLOAD_BYTES: '2097152', // 2 MB — keeps the limit tests quick
      DEFAULT_QUOTA_BYTES: '5242880', // 5 MB
      MAX_FILES_PER_UPLOAD: '5',
      LOG_LEVEL: 'silent',
      ACCESS_TOKEN_SECRET: 'test-access-secret-test-access-secret-1234',
      REFRESH_TOKEN_PEPPER: 'test-refresh-pepper-test-refresh-pepper-12',
    },
  },
});
