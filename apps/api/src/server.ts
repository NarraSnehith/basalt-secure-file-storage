import { createApp } from './app.js';
import { env } from './config/env.js';
import { assertDatabaseReachable, closeDatabase } from './db/client.js';
import { logger } from './lib/logger.js';
import { startMaintenanceLoop } from './maintenance.js';
import { initStorage } from './storage/index.js';

async function main(): Promise<void> {
  await assertDatabaseReachable().catch((err) => {
    logger.fatal({ err }, `cannot reach postgres at ${env.DATABASE_URL.replace(/:[^:@]+@/, ':***@')}`);
    process.exit(1);
  });
  await initStorage();

  const app = createApp();
  const server = app.listen(env.API_PORT, () => {
    logger.info(
      { port: env.API_PORT, env: env.NODE_ENV, storage: env.STORAGE_DRIVER },
      `basalt api listening on http://localhost:${env.API_PORT}`,
    );
  });

  // Long uploads must not be cut off by a default socket timeout.
  server.requestTimeout = 0;
  server.headersTimeout = 65_000;
  server.keepAliveTimeout = 61_000;

  startMaintenanceLoop();

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');

    // Stop accepting connections, let in-flight requests finish, then let go of
    // the pool. A hung request cannot hold the process hostage for longer than
    // the grace period.
    const timer = setTimeout(() => {
      logger.warn('graceful shutdown timed out — exiting anyway');
      process.exit(1);
    }, 15_000);
    timer.unref();

    server.close(() => {
      void closeDatabase()
        .catch((err) => logger.error({ err }, 'error closing database'))
        .finally(() => process.exit(0));
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => logger.error({ reason }, 'unhandled promise rejection'));
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'uncaught exception — exiting');
    process.exit(1);
  });
}

void main();
