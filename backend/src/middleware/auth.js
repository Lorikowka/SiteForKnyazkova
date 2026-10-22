/**
 * Проверка API-ключа для защищённых (админских/ботовских) маршрутов.
 */
import config from '../config/index.js';
import { createApiKeyAuth } from '../lib/security.js';
import logger from '../utils/logger.js';

export const requireApiKey = createApiKeyAuth({
  logger,
  adminKeys: config.app.adminApiKeys,
  botKeys: config.app.botApiKeys
});

export const requireAdminKey = createApiKeyAuth({
  logger, adminKeys: config.app.adminApiKeys, botKeys: config.app.botApiKeys, adminOnly: true
});

/** Financial records are immutable through HTTP in production. */
export async function requireNonProduction(request, reply) {
  if (config.app.nodeEnv === 'production') {
    return reply.code(403).send({ success: false, error: 'Operation disabled in production' });
  }
}
