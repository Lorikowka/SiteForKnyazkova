const rateLimit = require('express-rate-limit');
const config = require('../utils/config');

/**
 * Фабрика лимитеров запросов.
 *
 * В тестовом окружении лимиты отключены, чтобы интеграционные тесты не
 * упирались в защиту от брутфорса.
 */
function createLimiter(options) {
  if (config.app.nodeEnv === 'test') {
    return (req, res, next) => next();
  }
  return rateLimit(options);
}

// Общий лимит для всех API-запросов.
const globalLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Слишком много запросов' }
});

// Строгий лимит для чувствительных операций (создание платежа, отзывы и т.п.).
const strictLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: 10,
  message: { success: false, error: 'Слишком много попыток' }
});

// Лимит для публичных операций отмены брони.
const cancelLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: 5,
  message: { success: false, error: 'Слишком много попыток' }
});

module.exports = { createLimiter, globalLimiter, strictLimiter, cancelLimiter };
