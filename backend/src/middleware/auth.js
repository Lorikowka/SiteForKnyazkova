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
