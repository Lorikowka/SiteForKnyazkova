/**
 * Безопасность: проверка API-ключей и подписи вебхука ЮKassa.
 */
import crypto from 'node:crypto';

function splitKeys(value) {
  return String(value || '')
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean);
}

/** Сравнение строк за постоянное время (защита от timing-атак). */
function timingSafeEqualString(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

/**
 * Создаёт Fastify-хук проверки API-ключа.
 *
 * Ключи разделены на «админские» и «ботовские»: и те и другие дают доступ,
 * но роль сохраняется в `request.authRole` для дальнейшей логики.
 */
export function createApiKeyAuth({ logger, adminKeys = [], botKeys = [] }) {
  const admins = splitKeys(adminKeys);
  const bots = splitKeys(botKeys);
  const allKeys = [...admins, ...bots];

  return async function requireApiKey(request, reply) {
    if (allKeys.length === 0) {
      logger.error('Admin API key is not configured; protected endpoint blocked');
      return reply.code(503).send({ success: false, error: 'Admin API is temporarily unavailable' });
    }

    const providedKey = request.headers['x-api-key'] || request.headers['x-bot-api-key'];
    const role = admins.some((key) => timingSafeEqualString(key, providedKey))
      ? 'admin'
      : bots.some((key) => timingSafeEqualString(key, providedKey))
        ? 'bot'
        : null;

    if (!role) {
      logger.warn({ path: request.url, method: request.method, ip: request.ip }, 'Invalid API key attempt');
      return reply.code(401).send({ success: false, error: 'Invalid authorization key' });
    }

    request.authRole = role;
    logger.info({ path: request.url, method: request.method, role, ip: request.ip }, 'Admin API access');
  };
}

/** Проверяет HMAC-подпись вебхука ЮKassa. */
export function verifyWebhookSignature({ body, signature, secret, logger }) {
  if (!secret) {
    logger.error('YOOKASSA_WEBHOOK_SECRET is not configured; webhook rejected');
    return false;
  }
  if (!signature) {
    logger.warn('Missing X-Yookassa-Signature header');
    return false;
  }

  const calculatedSignature = crypto.createHmac('sha256', secret).update(body).digest('hex');
  return timingSafeEqualString(signature, calculatedSignature);
}
