const crypto = require('crypto');

function splitKeys(value) {
  return String(value || '')
    .split(',')
    .map(key => key.trim())
    .filter(Boolean);
}

function timingSafeEqualString(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function createApiKeyAuth({ logger, adminKeys = [], botKeys = [] }) {
  const admins = splitKeys(adminKeys);
  const bots = splitKeys(botKeys);
  const allKeys = [...admins, ...bots];

  return function requireApiKey(req, res, next) {
    if (allKeys.length === 0) {
      logger.error('Admin API key is not configured; protected endpoint blocked');
      return res.status(503).json({ success: false, error: 'Admin API is temporarily unavailable' });
    }

    const providedKey = req.headers['x-api-key'] || req.headers['x-bot-api-key'];
    const role = admins.some(key => timingSafeEqualString(key, providedKey))
      ? 'admin'
      : bots.some(key => timingSafeEqualString(key, providedKey))
        ? 'bot'
        : null;

    if (!role) {
      logger.warn('Invalid API key attempt', {
        path: req.originalUrl,
        method: req.method,
        ip: req.ip
      });
      return res.status(401).json({ success: false, error: 'Invalid authorization key' });
    }

    req.authRole = role;
    logger.info('Admin API access', {
      path: req.originalUrl,
      method: req.method,
      role,
      ip: req.ip
    });
    next();
  };
}

function verifyWebhookSignature({ body, signature, secret, logger }) {
  if (!secret) {
    logger.error('YOOKASSA_WEBHOOK_SECRET is not configured; webhook rejected');
    return false;
  }

  if (!signature) {
    logger.warn('Missing X-Yookassa-Signature header');
    return false;
  }

  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(body);
  const calculatedSignature = hmac.digest('hex');

  return timingSafeEqualString(signature, calculatedSignature);
}

module.exports = {
  createApiKeyAuth,
  verifyWebhookSignature
};
