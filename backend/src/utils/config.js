const config = require('../../config.json');

const YOOKASSA_SHOP_ID = process.env.YOOKASSA_SHOP_ID;
const YOOKASSA_SECRET_KEY = process.env.YOOKASSA_SECRET_KEY;
const YOOKASSA_WEBHOOK_SECRET = process.env.YOOKASSA_WEBHOOK_SECRET;
const SITE_URL = process.env.SITE_URL || 'http://localhost:1488';
const MOCK_MODE = process.env.MOCK_MODE === 'true';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const VK_BOT_TOKEN = process.env.VK_BOT_TOKEN;
const VK_NOTIFY_PEER_IDS = process.env.VK_NOTIFY_PEER_IDS || process.env.VK_NOTIFY_PEER_ID;
const VK_API_VERSION = process.env.VK_API_VERSION || '5.199';
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587', 10);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER;
const API_KEY = process.env.API_KEY || '';

const ADMIN_API_KEYS = process.env.ADMIN_API_KEYS || API_KEY;
const BOT_API_KEYS = process.env.BOT_API_KEYS || process.env.BOT_API_KEY || API_KEY;

module.exports = {
  yookassa: {
    shopId: YOOKASSA_SHOP_ID,
    secretKey: YOOKASSA_SECRET_KEY,
    webhookSecret: YOOKASSA_WEBHOOK_SECRET,
    baseUrl: 'https://api.yookassa.ru/v3',
    authHeader: Buffer.from(`${YOOKASSA_SHOP_ID}:${YOOKASSA_SECRET_KEY}`).toString('base64')
  },
  app: {
    port: process.env.PORT || 1488,
    siteUrl: SITE_URL,
    mockMode: MOCK_MODE,
    apiKey: API_KEY,
    adminApiKeys: ADMIN_API_KEYS,
    botApiKeys: BOT_API_KEYS,
    nodeEnv: process.env.NODE_ENV || 'development'
  },
  telegram: {
    token: TELEGRAM_BOT_TOKEN,
    chatId: TELEGRAM_CHAT_ID
  },
  vk: {
    token: VK_BOT_TOKEN,
    peerIds: VK_NOTIFY_PEER_IDS,
    apiVersion: VK_API_VERSION
  },
  smtp: {
    host: SMTP_HOST,
    port: SMTP_PORT,
    user: SMTP_USER,
    pass: SMTP_PASS,
    from: SMTP_FROM
  },
  services: config.services,
  schedule: config.schedule
};
