import pino from 'pino';
import { env, isProd, isTest } from '../config/env.js';

const redactions = [
  'req.headers.cookie',
  'req.headers.authorization',
  'res.headers["set-cookie"]',
  'password',
  'currentPassword',
  'newPassword',
  '*.password',
];

export const logger = pino({
  level: isTest ? 'silent' : env.LOG_LEVEL,
  redact: { paths: redactions, censor: '[redacted]' },
  base: { service: 'basalt-api' },
  ...(isProd
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname,service' },
        },
      }),
});

export type Logger = typeof logger;
