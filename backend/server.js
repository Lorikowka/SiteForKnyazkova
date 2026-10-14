/**
 * Точка входа: запуск HTTP-сервера и корректное завершение работы.
 */
import { buildApp } from './src/app.js';
import config from './src/config/index.js';
import db from './src/db/index.js';
import logger from './src/utils/logger.js';

async function start() {
  const app = await buildApp();

  try {
    await app.listen({ port: config.app.port, host: '0.0.0.0' });
    logger.info(`Сервер запущен: http://localhost:${config.app.port} (${config.app.nodeEnv})`);
    logger.info(`Оплата: ${config.app.mockMode ? 'MOCK-режим' : 'ЮKassa'}`);
  } catch (error) {
    logger.error(`Ошибка запуска: ${error.message}`);
    process.exit(1);
  }

  const shutdown = async (signal) => {
    logger.info(`Получен ${signal}, завершаем работу...`);
    try {
      await app.close();
    } catch (error) {
      logger.error(`Ошибка при остановке сервера: ${error.message}`);
    }
    db.close();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  return app;
}

start();
