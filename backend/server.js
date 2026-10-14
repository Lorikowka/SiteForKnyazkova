const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const helmet = require('helmet');
const dotenv = require('dotenv');

// Переменные окружения: сначала корневой .env, затем backend/.env (переопределяет).
dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '.env') });

const logger = require('./src/utils/logger');
const config = require('./src/utils/config');
const { globalLimiter } = require('./src/middleware/rateLimit');
const db = require('./database');

const FRONTEND_PATH = path.join(__dirname, '..', 'frontend');
const app = express();

// Доверяем первому прокси, чтобы rate-limit и req.ip работали корректно.
app.set('trust proxy', 1);
app.disable('x-powered-by');

// —————————————————————————————— MIDDLEWARE ——————————————————————————————

app.use(helmet({
  contentSecurityPolicy: config.app.nodeEnv === 'production'
    ? {
      directives: {
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
      }
    }
    : false,
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: false
}));

const allowedOrigins = new Set(config.app.allowedOrigins);
const siteOrigin = (() => {
  try {
    return new URL(config.app.siteUrl).origin;
  } catch {
    return null;
  }
})();

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.has(origin) || origin === siteOrigin) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Bot-API-Key']
}));

app.use(globalLimiter);

app.use(express.json({
  limit: '10kb',
  verify: (req, res, buf) => {
    // Сырое тело нужно для проверки подписи вебхука ЮKassa.
    req.rawBody = buf.toString('utf8');
  }
}));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// Логирование API-запросов.
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    logger.info(`[API] ${req.method} ${req.path}`);
  }
  next();
});

// Перед обработкой любого API-запроса убеждаемся, что схема БД готова.
app.use('/api', async (req, res, next) => {
  try {
    await db.ready;
    next();
  } catch (err) {
    logger.error(`Database initialization failed: ${err.message}`);
    res.status(500).json({ success: false, error: 'Database initialization failed' });
  }
});

// —————————————————————————————— ROUTES ——————————————————————————————

app.use('/api/reviews', require('./src/routes/reviewRoutes'));
app.use('/api/payments', require('./src/routes/paymentRoutes'));
app.use('/api/sessions', require('./src/routes/sessionRoutes'));
app.use('/api/schedule', require('./src/routes/scheduleRoutes'));
app.use('/api/admin', require('./src/routes/adminRoutes'));
app.use('/api', require('./src/routes/serviceRoutes')); // services, diplomas, health

// Неизвестные API-маршруты — JSON 404 (а не HTML).
app.use('/api', (req, res) => {
  res.status(404).json({ success: false, error: 'Маршрут не найден' });
});

// —————————————————————————————— STATIC / SPA ——————————————————————————————

if (fs.existsSync(FRONTEND_PATH)) {
  app.use(express.static(FRONTEND_PATH, { extensions: ['html'] }));
}

app.get('*', (req, res) => {
  if (!fs.existsSync(FRONTEND_PATH)) {
    return res.status(404).json({
      success: false,
      message: 'API-сервер запущен. Фронтенд размещён отдельно.',
      endpoints: ['/api/health', '/api/services', '/api/schedule']
    });
  }

  const requested = path.join(FRONTEND_PATH, path.normalize(req.path));
  if (requested.startsWith(FRONTEND_PATH) && fs.existsSync(requested) && fs.statSync(requested).isFile()) {
    return res.sendFile(requested);
  }
  return res.sendFile(path.join(FRONTEND_PATH, 'index.html'));
});

// —————————————————————————————— ERRORS ——————————————————————————————

app.use((err, req, res, next) => {
  if (err && err.message === 'Not allowed by CORS') {
    return res.status(403).json({ success: false, error: 'Источник не разрешён' });
  }
  logger.error(`Unhandled error: ${err.message}`);
  res.status(500).json({ success: false, error: 'Внутренняя ошибка сервера' });
});

// —————————————————————————————— START / SHUTDOWN ——————————————————————————————

function startServer() {
  const server = app.listen(config.app.port, () => {
    logger.info(`Сервер запущен: http://localhost:${config.app.port} (${config.app.nodeEnv})`);
    logger.info(`Оплата: ${config.app.mockMode ? 'MOCK-режим' : 'ЮKassa'}`);
  });

  const shutdown = (signal) => {
    logger.info(`Получен ${signal}, завершаем работу...`);
    server.close(() => {
      db.close().finally(() => process.exit(0));
    });
    // Форсированное завершение, если соединения не закрылись за 10 секунд.
    setTimeout(() => process.exit(1), 10000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  return server;
}

if (require.main === module) {
  db.ready
    .then(startServer)
    .catch((error) => {
      logger.error(`Ошибка запуска: ${error.message}`);
      process.exit(1);
    });
}

module.exports = app;
module.exports.startServer = startServer;
