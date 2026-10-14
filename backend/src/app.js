/**
 * Сборка Fastify-приложения.
 *
 * Экспортируется фабрика `buildApp()`, чтобы приложение можно было запускать
 * как из `server.js`, так и из тестов (на произвольном порту).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';

import config from './config/index.js';
import { globalRateLimitOptions } from './middleware/rateLimit.js';
import adminRoutes from './routes/admin.js';
import paymentRoutes from './routes/payments.js';
import reviewRoutes from './routes/reviews.js';
import scheduleRoutes from './routes/schedule.js';
import serviceRoutes from './routes/services.js';
import sessionRoutes from './routes/sessions.js';
import logger from './utils/logger.js';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_PATH = path.resolve(MODULE_DIR, '..', '..', 'frontend');
const API_PREFIX = '/api';

const CSP_DIRECTIVES = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'"],
  styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
  fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
  imgSrc: ["'self'", 'data:', 'https:'],
  connectSrc: ["'self'", 'https://api.yookassa.ru'],
  frameSrc: ["'self'", 'https://yookassa.ru'],
  objectSrc: ["'none'"],
  baseUri: ["'self'"],
  formAction: ["'self'"]
};

export async function buildApp() {
  const app = Fastify({
    logger: false,
    disableRequestLogging: true,
    trustProxy: true,
    bodyLimit: 10240,
    ignoreTrailingSlash: true
  });

  const hasFrontend = fs.existsSync(FRONTEND_PATH);
  const allowedOrigins = new Set(config.app.allowedOrigins);
  const siteOrigin = (() => {
    try {
      return new URL(config.app.siteUrl).origin;
    } catch {
      return null;
    }
  })();
  const isOriginAllowed = (origin) => !origin || allowedOrigins.has(origin) || origin === siteOrigin;

  // —————————————————————————————— Тело запроса ——————————————————————————————
  // Разбираем JSON как строку, чтобы сохранить сырое тело для проверки
  // подписи вебхука ЮKassa.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (request, body, done) => {
    request.rawBody = body;
    if (!body) return done(null, {});
    try {
      done(null, JSON.parse(body));
    } catch (error) {
      error.statusCode = 400;
      done(error);
    }
  });

  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (request, body, done) => {
    try {
      done(null, Object.fromEntries(new URLSearchParams(body || '')));
    } catch (error) {
      done(error);
    }
  });

  // —————————————————————————————— Безопасность ——————————————————————————————
  await app.register(helmet, {
    contentSecurityPolicy: config.app.nodeEnv === 'production' ? { directives: CSP_DIRECTIVES } : false,
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false
  });

  await app.register(cors, {
    origin: (origin, callback) => callback(null, isOriginAllowed(origin)),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Bot-API-Key']
  });

  // Явно отклоняем запросы с запрещённого источника (как и раньше — 403).
  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin;
    if (origin && !isOriginAllowed(origin) && request.method !== 'OPTIONS') {
      return reply.code(403).send({ success: false, error: 'Источник не разрешён' });
    }
  });

  await app.register(rateLimit, {
    errorResponseBuilder: () => ({ success: false, error: 'Слишком много запросов' }),
    ...globalRateLimitOptions()
  });

  // —————————————————————————————— Логирование API ——————————————————————————————
  app.addHook('onRequest', async (request) => {
    if (request.url.startsWith(`${API_PREFIX}/`)) {
      logger.info(`[API] ${request.method} ${request.url}`);
    }
  });

  // —————————————————————————————— Маршруты ——————————————————————————————
  await app.register(serviceRoutes, { prefix: API_PREFIX });
  await app.register(scheduleRoutes, { prefix: `${API_PREFIX}/schedule` });
  await app.register(paymentRoutes, { prefix: `${API_PREFIX}/payments` });
  await app.register(sessionRoutes, { prefix: `${API_PREFIX}/sessions` });
  await app.register(reviewRoutes, { prefix: `${API_PREFIX}/reviews` });
  await app.register(adminRoutes, { prefix: `${API_PREFIX}/admin` });

  // —————————————————————————————— Статика и SPA ——————————————————————————————
  if (hasFrontend) {
    await app.register(fastifyStatic, { root: FRONTEND_PATH, wildcard: false });
  }

  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith(API_PREFIX)) {
      return reply.code(404).send({ success: false, error: 'Маршрут не найден' });
    }

    if (!hasFrontend) {
      return reply.code(404).send({
        success: false,
        message: 'API-сервер запущен. Фронтенд размещён отдельно.',
        endpoints: ['/api/health', '/api/services', '/api/schedule']
      });
    }

    if (request.method === 'GET') {
      const urlPath = decodeURIComponent(request.url.split('?')[0]);
      const requested = path.join(FRONTEND_PATH, path.normalize(urlPath));
      if (requested.startsWith(FRONTEND_PATH) && fs.existsSync(requested) && fs.statSync(requested).isFile()) {
        return reply.sendFile(path.relative(FRONTEND_PATH, requested));
      }
      return reply.sendFile('index.html');
    }

    return reply.code(404).send({ success: false, error: 'Не найдено' });
  });

  // —————————————————————————————— Обработка ошибок ——————————————————————————————
  app.setErrorHandler((error, request, reply) => {
    if (error.code === 'CORS_NOT_ALLOWED') {
      return reply.code(403).send({ success: false, error: 'Источник не разрешён' });
    }

    const isClientError = error.statusCode >= 400 && error.statusCode < 500;
    if (!isClientError) {
      logger.error({ err: error, path: request.url }, `Unhandled error: ${error.message}`);
      return reply.code(500).send({ success: false, error: 'Внутренняя ошибка сервера' });
    }

    const payload = { success: false, error: error.message };
    if (error.code && error.code !== 'VALIDATION_ERROR') payload.code = error.code;
    if (error.details) payload.details = error.details;
    return reply.code(error.statusCode).send(payload);
  });

  return app;
}
