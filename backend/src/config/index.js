/**
 * Централизованная конфигурация приложения.
 *
 * Переменные окружения валидируются схемой zod; бизнес-данные (услуги и
 * параметры расписания) читаются из `config.json`. Приложение обращается к
 * настройкам только через этот модуль, а не к `process.env` напрямую.
 */
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

import { BACKEND_ROOT } from './env.js';

const envSchema = z.object({
  NODE_ENV: z.string().default('development'),
  LOG_LEVEL: z.string().default('info'),

  PORT: z.coerce.number().int().positive().default(1488),
  SITE_URL: z.string().default(''),
  MOCK_MODE: z.string().default(''),

  API_KEY: z.string().default(''),
  ADMIN_API_KEYS: z.string().default(''),
  BOT_API_KEYS: z.string().default(''),
  BOT_API_KEY: z.string().default(''),
  ALLOWED_ORIGINS: z.string().default(''),

  YOOKASSA_SHOP_ID: z.string().default(''),
  YOOKASSA_SECRET_KEY: z.string().default(''),
  YOOKASSA_WEBHOOK_SECRET: z.string().default(''),

  TELEGRAM_BOT_TOKEN: z.string().default(''),
  TELEGRAM_CHAT_ID: z.string().default(''),

  VK_BOT_TOKEN: z.string().default(''),
  VK_NOTIFY_PEER_IDS: z.string().default(''),
  VK_NOTIFY_PEER_ID: z.string().default(''),
  VK_API_VERSION: z.string().default('5.199'),

  SMTP_HOST: z.string().default('smtp.gmail.com'),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().default(''),
  SMTP_PASS: z.string().default(''),
  SMTP_FROM: z.string().default('')
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  // Конфигурацию невозможно разобрать — продолжать работу небезопасно.
  console.error('Некорректные переменные окружения:', parsed.error.issues);
  process.exit(1);
}
const env = parsed.data;

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(BACKEND_ROOT, file), 'utf8'));
}

const businessConfig = readJson('config.json');
const { version } = readJson('package.json');

const port = env.PORT;
const siteUrl = (env.SITE_URL || `http://localhost:${port}`).replace(/\/+$/, '');

/** Разбирает строку со списком значений, разделённых запятыми. */
export function splitList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

const allowedOrigins = splitList(env.ALLOWED_ORIGINS);

const config = {
  app: {
    version,
    port,
    siteUrl,
    mockMode: env.MOCK_MODE === 'true',
    nodeEnv: env.NODE_ENV,
    logLevel: env.LOG_LEVEL,
    // Пустой API_KEY означает, что админ-эндпоинты закрыты (503), а не открыты.
    apiKey: env.API_KEY,
    adminApiKeys: env.ADMIN_API_KEYS || env.API_KEY,
    botApiKeys: env.BOT_API_KEYS || env.BOT_API_KEY || env.API_KEY,
    allowedOrigins: allowedOrigins.length
      ? allowedOrigins
      : [
        `http://localhost:${port}`,
        'http://127.0.0.1:1488',
        'http://localhost:5500',
        'http://127.0.0.1:5500'
      ]
  },

  yookassa: {
    shopId: env.YOOKASSA_SHOP_ID,
    secretKey: env.YOOKASSA_SECRET_KEY,
    webhookSecret: env.YOOKASSA_WEBHOOK_SECRET,
    baseUrl: 'https://api.yookassa.ru/v3',
    authHeader: Buffer.from(`${env.YOOKASSA_SHOP_ID}:${env.YOOKASSA_SECRET_KEY}`).toString('base64'),
    isConfigured: Boolean(env.YOOKASSA_SHOP_ID && env.YOOKASSA_SECRET_KEY)
  },

  telegram: {
    token: env.TELEGRAM_BOT_TOKEN,
    chatId: env.TELEGRAM_CHAT_ID
  },

  vk: {
    token: env.VK_BOT_TOKEN,
    peerIds: env.VK_NOTIFY_PEER_IDS || env.VK_NOTIFY_PEER_ID,
    apiVersion: env.VK_API_VERSION
  },

  smtp: {
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
    from: env.SMTP_FROM || env.SMTP_USER
  },

  // Бизнес-данные (услуги и параметры расписания) из config.json.
  services: businessConfig.services,
  schedule: businessConfig.schedule
};

export default Object.freeze(config);
