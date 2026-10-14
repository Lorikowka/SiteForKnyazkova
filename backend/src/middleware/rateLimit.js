/**
 * Настройки ограничения частоты запросов (@fastify/rate-limit).
 *
 * В тестовом окружении лимиты отключены, чтобы интеграционные тесты не
 * упирались в защиту от брутфорса.
 */
import config from '../config/index.js';

const isTest = config.app.nodeEnv === 'test';

/** Опции для глобального лимитера. */
export function globalRateLimitOptions() {
  return isTest ? { global: false } : { global: true, max: 100, timeWindow: '1 minute' };
}

/** Конфигурация маршрута со строгим лимитом (для чувствительных операций). */
export function limitOptions(max, timeWindow = '1 minute') {
  return isTest ? {} : { rateLimit: { max, timeWindow } };
}
