const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

const logger = require('./src/utils/logger');
const config = require('./src/utils/config');
const db = require('./database');

const app = express();
const FRONTEND_PATH = path.join(__dirname, '..', 'frontend');

// Доверяем прокси (необходимо для Vercel и правильной работы rate-limit)
app.set('trust proxy', 1);

// ——————————————————————————————
// MIDDLEWARE
// ——————————————————————————————

// Простейшее логирование запросов
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    logger.info(`[API] ${req.method} ${req.path} - Query: ${JSON.stringify(req.query)}`);
  }
  next();
});

// Обеспечиваем готовность БД перед обработкой любого API запроса
app.use('/api', async (req, res, next) => {
  try {
    await db.ready;
    next();
  } catch (err) {
    logger.error('Database ready wait error: ' + err.message);
    // Отправляем текст ошибки клиенту для отладки
    res.status(500).json({ 
      success: false, 
      error: 'Database initialization failed',
      details: err.message,
      stack: config.app.nodeEnv === 'production' ? undefined : err.stack
    });
  }
});

app.use(helmet({
  contentSecurityPolicy: config.app.nodeEnv === 'production' ? {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://api.yookassa.ru"],
      frameSrc: ["'self'", "https://yookassa.ru"],
    },
  } : false,
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: false
}));

app.use(cors({
  origin: (origin, callback) => {
    const allowed = process.env.ALLOWED_ORIGINS?.split(',') || [
      'http://localhost:1488',
      'http://localhost:3000',
      'https://lorikowka.github.io'
    ];
    if (!origin || allowed.some(a => origin.startsWith(a))) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Bot-API-Key']
}));

app.use(rateLimit({
  windowMs: 60000,
  max: 100,
  message: { success: false, error: 'Слишком много запросов' }
}));

app.use(express.json({
  limit: '10kb',
  verify: (req, res, buf) => {
    req.rawBody = buf.toString('utf8');
  }
}));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// ——————————————————————————————
// ROUTES
// ——————————————————————————————
const reviewRoutes = require('./src/routes/reviewRoutes');
const paymentRoutes = require('./src/routes/paymentRoutes');
const sessionRoutes = require('./src/routes/sessionRoutes');
const scheduleRoutes = require('./src/routes/scheduleRoutes');
const adminRoutes = require('./src/routes/adminRoutes');
const serviceRoutes = require('./src/routes/serviceRoutes');

app.use('/api/reviews', reviewRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/schedule', scheduleRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', serviceRoutes); // services and health

// ——————————————————————————————
// STATIC FILES
// ——————————————————————————————
if (fs.existsSync(FRONTEND_PATH)) {
  app.use(express.static(FRONTEND_PATH));
}

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.get('/payment-failed', (req, res) => {
  if (fs.existsSync(path.join(FRONTEND_PATH, 'payment-failed.html'))) {
    res.sendFile(path.join(FRONTEND_PATH, 'payment-failed.html'));
  } else {
    res.status(404).json({ success: false, error: 'Payment failed page not found' });
  }
});

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  
  // Если фронтенда нет рядом (как на Vercel), просто отдаем 404 для не-API путей
  if (!fs.existsSync(FRONTEND_PATH)) {
    return res.status(404).json({ 
      success: false, 
      message: 'API Server is running. Frontend is hosted elsewhere.',
      endpoints: ['/api/schedule', '/api/services', '/api/reviews']
    });
  }

  const filePath = path.join(FRONTEND_PATH, req.path);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    return res.sendFile(filePath);
  }
  
  const indexFile = path.join(FRONTEND_PATH, 'index.html');
  if (fs.existsSync(indexFile)) {
    res.sendFile(indexFile);
  } else {
    res.status(404).send('Not Found');
  }
});

// ——————————————————————————————
// SERVER START
// ——————————————————————————————
const PORT = config.app.port;

function startServer() {
  const server = app.listen(PORT, () => {
    logger.info(`
╔═══════════════════════════════════════════════════════════╗
║   🚀 Модульный сервер запущен                             ║
║                                                           ║
║   Порт: ${PORT}
║   Режим: ${config.app.nodeEnv}
║   Платежи: ${config.app.mockMode ? '🔧 MOCK' : '💳 ЮKassa'}
║                                                           ║
║   📱 Адрес: http://localhost:${PORT}                       ║
╚═══════════════════════════════════════════════════════════╝
    `);
  });
  return server;
}

if (require.main === module) {
  db.ready.then(() => {
    return new Promise((resolve, reject) => {
      db.db.run(`CREATE TABLE IF NOT EXISTS schedule_exceptions (
        date TEXT PRIMARY KEY,
        reason TEXT
      )`, (err) => {
        if (err) reject(err); else resolve();
      });
    });
  }).then(startServer).catch((error) => {
    logger.error(`Server startup error: ${error.message}`);
    process.exit(1);
  });
}

module.exports = app;
