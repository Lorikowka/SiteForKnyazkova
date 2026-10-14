/**
 * Централизованная конфигурация приложения.
 *
 * Значения читаются из переменных окружения (файл `.env`). Логика приложения
 * не обращается к `process.env` напрямую — только через этот модуль.
 */

const businessConfig = require('../../config.json');

function list(value) {
  return String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

const PORT = parseInt(process.env.PORT, 10) || 1488;

const YOOKASSA_SHOP_ID = process.env.YOOKASSA_SHOP_ID || '';
const YOOKASSA_SECRET_KEY = process.env.YOOKASSA_SECRET_KEY || '';
const YOOKASSA_WEBHOOK_SECRET = process.env.YOOKASSA_WEBHOOK_SECRET || '';

const API_KEY = process.env.API_KEY || '';

module.exports = {
  yookassa: {
    shopId: YOOKASSA_SHOP_ID,
    secretKey: YOOKASSA_SECRET_KEY,
    webhookSecret: YOOKASSA_WEBHOOK_SECRET,
    baseUrl: 'https://api.yookassa.ru/v3',
    authHeader: Buffer.from(`${YOOKASSA_SHOP_ID}:${YOOKASSA_SECRET_KEY}`).toString('base64'),
    isConfigured: Boolean(YOOKASSA_SHOP_ID && YOOKASSA_SECRET_KEY)
  },

  app: {
    port: PORT,
    // Публичный адрес сайта — используется для return_url и ссылок в уведомлениях.
    siteUrl: (process.env.SITE_URL || `http://localhost:${PORT}`).replace(/\/+$/, ''),
    // Если MOCK_MODE=true, оплата проходит без обращения к ЮKassa.
    mockMode: process.env.MOCK_MODE === 'true',
    nodeEnv: process.env.NODE_ENV || 'development',
    apiKey: API_KEY,
    adminApiKeys: process.env.ADMIN_API_KEYS || API_KEY,
    botApiKeys: process.env.BOT_API_KEYS || process.env.BOT_API_KEY || API_KEY,
    // Список origin, которым разрешены кросс-доменные запросы.
    allowedOrigins: list(process.env.ALLOWED_ORIGINS).length
      ? list(process.env.ALLOWED_ORIGINS)
      : [
        `http://localhost:${PORT}`,
        'http://127.0.0.1:1488',
        'http://localhost:5500',
        'http://127.0.0.1:5500'
      ]
  },

  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN || '',
    chatId: process.env.TELEGRAM_CHAT_ID || ''
  },

  vk: {
    token: process.env.VK_BOT_TOKEN || '',
    peerIds: process.env.VK_NOTIFY_PEER_IDS || process.env.VK_NOTIFY_PEER_ID || '',
    apiVersion: process.env.VK_API_VERSION || '5.199'
  },

  smtp: {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT, 10) || 587,
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || process.env.SMTP_USER || ''
  },

  // Бизнес-данные (услуги и параметры расписания) из config.json.
  services: businessConfig.services,
  schedule: businessConfig.schedule
};
