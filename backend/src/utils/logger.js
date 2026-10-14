/**
 * Логгер приложения на базе pino.
 *
 * В development включается человекочитаемый вывод (pino-pretty), в остальных
 * окружениях — структурированный JSON (удобно для Docker/лог-сборщиков).
 */
import pino from 'pino';

import config from '../config/index.js';

const isDevelopment = config.app.nodeEnv === 'development';

const logger = pino({
  level: config.app.logLevel,
  base: { service: 'psixolog-payment' },
  ...(isDevelopment
    ? {
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
          ignore: 'pid,hostname,service'
        }
      }
    }
    : {})
});

export default logger;
