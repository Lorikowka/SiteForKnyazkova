/**
 * ═══════════════════════════════════════════════════════════
 * 🔒 Backend сервер для приёма платежей + база данных
 * ═══════════════════════════════════════════════════════════
 * Психолог Екатерина Князькова
 */

// ——————————————————————————————
// ЗАГРУЗКА ПЕРЕМЕННЫХ ОКРУЖЕНИЯ
// ——————————————————————————————
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

const NODE_ENV = process.env.NODE_ENV || 'development';
const envPath = path.join(__dirname, '.env');
dotenv.config({ path: envPath });

// ——————————————————————————————
// ИМПОРТЫ
// ——————————————————————————————
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { body, param, validationResult } = require('express-validator');
const crypto = require('crypto');
const axios = require('axios');
const winston = require('winston');
const cron = require('node-cron');

// База данных
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 1488;
const FRONTEND_PATH = path.join(__dirname, '..', 'frontend');

// ——————————————————————————————
// ЛОГИРОВАНИЕ
// ——————————————————————————————
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
  ),
  defaultMeta: { service: 'psixolog-payment' },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ]
});

// ——————————————————————————————
// КОНФИДЕНЦИАЛЬНЫЕ ДАННЫЕ
// ——————————————————————————————
const YOOKASSA_SHOP_ID = process.env.YOOKASSA_SHOP_ID;
const YOOKASSA_SECRET_KEY = process.env.YOOKASSA_SECRET_KEY;
const SITE_URL = process.env.SITE_URL || 'http://localhost:1488';
const MOCK_MODE = process.env.MOCK_MODE === 'true';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = process.env.SMTP_PORT || 587;
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER;

const YOOKASSA_BASE_URL = 'https://api.yookassa.ru/v3';
const AUTH_HEADER = Buffer.from(`${YOOKASSA_SHOP_ID}:${YOOKASSA_SECRET_KEY}`).toString('base64');

// ——————————————————————————————
// MIDDLEWARE
// ——————————————————————————————

app.use(helmet({
  contentSecurityPolicy: process.env.NODE_ENV === 'production' ? {
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
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:1488'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(rateLimit({
  windowMs: 60000,
  max: 100,
  message: { success: false, error: 'Слишком много запросов' }
}));

const strictLimiter = rateLimit({
  windowMs: 60000,
  max: 10,
  message: { success: false, error: 'Слишком много попыток' }
});

app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// ——————————————————————————————
// СТАТИКА
// ——————————————————————————————
app.use(express.static(FRONTEND_PATH));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  const filePath = path.join(FRONTEND_PATH, req.path);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    return res.sendFile(filePath);
  }
  res.sendFile(path.join(FRONTEND_PATH, 'index.html'));
});

// ——————————————————————————————
// HELPER ФУНКЦИИ
// ——————————————————————————————
function sanitizeInput(input) {
  if (typeof input !== 'string') return input;
  return input.replace(/[<>]/g, '').trim();
}

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: 'Некорректные данные',
      details: errors.array().map(e => e.msg)
    });
  }
  next();
};

async function sendTelegramNotification(message) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    await axios.post(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      { chat_id: TELEGRAM_CHAT_ID, text: sanitizeInput(message), parse_mode: 'HTML' },
      { timeout: 5000 }
    );
  } catch (error) {
    logger.error(`Telegram error: ${error.message}`);
  }
}

async function sendEmailConfirmation({ email, name, amount, serviceName, sessionDate, sessionTime, paymentId }) {
  if (!SMTP_USER || !SMTP_PASS) {
    logger.warn('SMTP не настроен. Email не отправлен.');
    return;
  }

  const nodemailer = require('nodemailer');

  try {
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS
      }
    });

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #667eea;">✅ Оплата прошла успешно!</h2>
        <p>Здравствуйте, <strong>${sanitizeInput(name)}</strong>!</p>
        <p>Ваша оплата принята. Детали записи:</p>
        
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          <tr>
            <td style="padding: 10px; border-bottom: 1px solid #eee; color: #666;">Услуга:</td>
            <td style="padding: 10px; border-bottom: 1px solid #eee;"><strong>${sanitizeInput(serviceName)}</strong></td>
          </tr>
          <tr>
            <td style="padding: 10px; border-bottom: 1px solid #eee; color: #666;">Дата:</td>
            <td style="padding: 10px; border-bottom: 1px solid #eee;">${sanitizeInput(sessionDate || '—')}</td>
          </tr>
          <tr>
            <td style="padding: 10px; border-bottom: 1px solid #eee; color: #666;">Время:</td>
            <td style="padding: 10px; border-bottom: 1px solid #eee;">${sanitizeInput(sessionTime || '—')}</td>
          </tr>
          <tr>
            <td style="padding: 10px; border-bottom: 1px solid #eee; color: #666;">Сумма:</td>
            <td style="padding: 10px; border-bottom: 1px solid #eee;"><strong style="color: #4CAF50;">${amount} ₽</strong></td>
          </tr>
          <tr>
            <td style="padding: 10px; border-bottom: 1px solid #eee; color: #666;">ID платежа:</td>
            <td style="padding: 10px; border-bottom: 1px solid #eee;">${paymentId}</td>
          </tr>
        </table>
        
        <p style="margin-top: 30px; padding-top: 20px; border-top: 2px solid #eee; color: #999; font-size: 14px;">
          Мы свяжемся с вами для подтверждения записи.<br>
          Если у вас есть вопросы, напишите нам в 
          <a href="https://t.me/Ekaterina_K" style="color: #667eea;">Telegram</a>
        </p>
      </div>
    `;

    await transporter.sendMail({
      from: `"Екатерина Князькова" <${SMTP_FROM}>`,
      to: email,
      subject: '✅ Оплата принята — Консультация психолога',
      html: htmlContent
    });

    logger.info(`📧 Email отправлен на ${email}`);
  } catch (error) {
    logger.error(`❌ Ошибка отправки email: ${error.message}`);
  }
}

// ——————————————————————————————
// API: СОЗДАТЬ ПЛАТЁЖ
// ——————————————————————————————
app.post('/api/create-payment',
  strictLimiter,
  [
    body('amount').optional().isFloat({ min: 10, max: 250000 }),
    body('description').optional().isString().isLength({ max: 200 }),
    body('orderId').optional().isString().isLength({ max: 50 }).matches(/^[a-zA-Z0-9_-]+$/),
    body('customerEmail').optional().isEmail().normalizeEmail(),
    body('customerName').optional().isString().isLength({ max: 200 }),
    body('customerPhone').optional().isString().isLength({ max: 20 }),
    body('serviceName').optional().isString().isLength({ max: 100 }),
    body('sessionDate').optional().isString(),
    body('sessionTime').optional().isString(),
    body('sessionDatetime').optional().isString(),
    body('comment').optional().isString().isLength({ max: 500 }),
    handleValidationErrors
  ],
  async (req, res) => {
    const startTime = Date.now();

    try {
      const {
        amount = 3500,
        description = 'Консультация психолога',
        orderId,
        customerEmail,
        customerName,
        customerPhone,
        serviceName,
        sessionDate,
        sessionTime,
        sessionDatetime,
        comment
      } = req.body;

      const orderNumber = orderId || `order_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      const paymentId = `pay_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

      logger.info(`📝 Создание платежа: ${orderNumber}, сумма: ${amount}₽`);

      // Сохраняем платёж в БД
      await db.createPayment({
        id: paymentId,
        order_id: orderNumber,
        amount,
        currency: 'RUB',
        status: 'pending',
        description,
        customer_email: customerEmail,
        customer_phone: customerPhone,
        customer_name: customerName,
        service_name: serviceName,
        metadata: JSON.stringify({ sessionDate, sessionTime, comment })
      });

      // MOCK режим
      if (MOCK_MODE) {
        // Обновляем статус на succeeded (в MOCK режиме платёж считается успешным)
        await db.updatePaymentStatus(paymentId, 'succeeded', new Date().toISOString());

        const mockConfirmationUrl = `${SITE_URL}/payment-success.html?mock=true&amount=${amount}&payment_id=${paymentId}`;

        // Сохраняем сеанс в БД
        if (sessionDatetime && customerName && customerPhone) {
          await db.createSession({
            payment_id: paymentId,
            client_name: customerName,
            client_phone: customerPhone,
            client_email: customerEmail,
            service_name: serviceName || description,
            session_date: sessionDate,
            session_time: sessionTime,
            session_datetime: sessionDatetime,
            amount,
            comment
          });
          logger.info(`✅ Сеанс сохранён в БД: ${sessionDatetime}`);
        }

        // Отправляем email подтверждение
        if (customerEmail) {
          await sendEmailConfirmation({
            email: customerEmail,
            name: customerName,
            amount,
            serviceName: serviceName || description,
            sessionDate,
            sessionTime,
            paymentId
          });
        }

        logger.info(`✅ MOCK платёж создан: ${paymentId}`);
        return res.json({
          success: true,
          paymentId,
          confirmationUrl: mockConfirmationUrl,
          amount: amount.toString(),
          mock: true
        });
      }

      // Реальный платёж через ЮKassa
      const response = await axios.post(
        `${YOOKASSA_BASE_URL}/payments`,
        {
          amount: { value: amount.toString(), currency: 'RUB' },
          description,
          metadata: { order_id: orderNumber },
          confirmation: {
            type: 'redirect',
            return_url: `${SITE_URL}/payment-success.html?payment_id=${paymentId}`
          },
          capture: true,
          paid: false
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Idempotence-Key': orderNumber,
            'Authorization': `Basic ${AUTH_HEADER}`
          },
          timeout: 10000
        }
      );

      const payment = response.data;
      logger.info(`✅ Платёж создан в ЮKassa: ${payment.id}`);

      // Обновляем ID платежа на реальный ID от ЮKassa
      await new Promise((resolve, reject) => {
        db.db.run('UPDATE payments SET id = ? WHERE id = ?', [payment.id, paymentId], function(err) {
          if (err) reject(err);
          else resolve();
        });
      });

      res.json({
        success: true,
        paymentId: payment.id,
        confirmationUrl: payment.confirmation.confirmation_url,
        amount: payment.amount.value
      });

    } catch (error) {
      logger.error(`❌ Ошибка создания платежа:`, error.message);
      res.status(error.response?.status || 500).json({
        success: false,
        error: 'Не удалось создать платёж',
        details: error.message
      });
    }
  }
);

// ——————————————————————————————
// API: ПОЛУЧИТЬ ИНФОРМАЦИЮ О ПЛАТЕЖЕ
// ——————————————————————————————
app.get('/api/payment/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const payment = await db.getPayment(id);

    if (!payment) {
      return res.status(404).json({ success: false, error: 'Платёж не найден' });
    }

    // Если статус pending и не MOCK — проверяем через API ЮKassa
    if (payment.status === 'pending' && !MOCK_MODE) {
      try {
        const ykResponse = await axios.get(
          `${YOOKASSA_BASE_URL}/payments/${id}`,
          {
            headers: {
              'Authorization': `Basic ${AUTH_HEADER}`
            },
            timeout: 5000
          }
        );

        const ykPayment = ykResponse.data;
        if (ykPayment.status === 'succeeded' || ykPayment.paid) {
          // Обновляем статус в БД
          await db.updatePaymentStatus(id, 'succeeded', ykPayment.paid_at);
          payment.status = 'succeeded';
          payment.paid_at = ykPayment.paid_at;
        } else if (ykPayment.status === 'canceled' || ykPayment.status === 'expired') {
          await db.updatePaymentStatus(id, ykPayment.status);
          payment.status = ykPayment.status;
        }
      } catch (ykError) {
        logger.warn(`Не удалось проверить платёж через ЮKassa: ${ykError.message}`);
      }
    }

    res.json({ success: true, payment });
  } catch (error) {
    logger.error(`❌ Ошибка получения платежа:`, error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ——————————————————————————————
// API: WEBHOOK ОТ ЮKASSA
// ——————————————————————————————
app.post('/api/webhook', async (req, res) => {
  try {
    const event = req.body;
    const object = event.object;

    if (!event.event || !object) {
      return res.status(400).send('Invalid event format');
    }

    logger.info(`📩 Webhook: ${event.event} ${object.id}`);

    if (event.event === 'payment.succeeded') {
      // Обновляем статус платежа в БД
      await db.updatePaymentStatus(object.id, 'succeeded', object.paid_at);

      // Получаем метаданные
      const metadata = object.metadata ? JSON.parse(object.metadata) : {};

      // Если есть данные о сеансе — сохраняем и отправляем email
      if (metadata.sessionDatetime && metadata.customerPhone) {
        await db.createSession({
          payment_id: object.id,
          client_name: metadata.customerName,
          client_phone: metadata.customerPhone,
          client_email: metadata.customerEmail,
          service_name: metadata.serviceName,
          session_date: metadata.sessionDate,
          session_time: metadata.sessionTime,
          session_datetime: metadata.sessionDatetime,
          amount: object.amount.value,
          comment: metadata.comment
        });

        // Отправляем email подтверждение
        if (metadata.customerEmail) {
          await sendEmailConfirmation({
            email: metadata.customerEmail,
            name: metadata.customerName,
            amount: object.amount.value,
            serviceName: metadata.serviceName,
            sessionDate: metadata.sessionDate,
            sessionTime: metadata.sessionTime,
            paymentId: object.id
          });
        }
      }

      await sendTelegramNotification(
        `✅ <b>Оплата получена!</b>\n\n` +
        `💰 Сумма: ${object.amount.value} ₽\n` +
        `🆔 ID: ${object.id}`
      );
    } else if (event.event === 'payment.canceled' || event.event === 'payment.expired') {
      // Обновляем статус в БД, но НЕ сохраняем сеанс
      await db.updatePaymentStatus(object.id, object.status);

      logger.info(`❌ Платёж отменён/истёк: ${object.id}. Сеанс НЕ сохранён в БД.`);

      await sendTelegramNotification(
        `❌ <b>Оплата отменена!</b>\n\n` +
        `🆔 ID: ${object.id}\n` +
        `📝 Причина: ${object.cancellation_details?.reason || 'не указана'}`
      );
    }

    res.status(200).send('OK');
  } catch (error) {
    logger.error('❌ Webhook error:', error.message);
    res.status(500).send('Webhook error');
  }
});

// ——————————————————————————————
// API: ПОЛУЧИТЬ ВСЕ СЕАНСЫ (для бота)
// ——————————————————————————————
app.get('/api/sessions', async (req, res) => {
  try {
    const { limit = 100, past = 'false' } = req.query;
    const sessions = past === 'true'
      ? await db.getPastSessions(parseInt(limit))
      : await db.getAllSessions(parseInt(limit));

    res.json({ success: true, sessions });
  } catch (error) {
    logger.error(`❌ Ошибка получения сеансов:`, error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ——————————————————————————————
// API: ПОЛУЧИТЬ ВСЕ ПЛАТЕЖИ (для бота)
// ——————————————————————————————
app.get('/api/payments', async (req, res) => {
  try {
    const { limit = 50 } = req.query;
    const payments = await db.getAllPayments(parseInt(limit));
    res.json({ success: true, payments });
  } catch (error) {
    logger.error(`❌ Ошибка получения платежей:`, error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ——————————————————————————————
// API: УДАЛИТЬ СЕАНС (для бота)
// ——————————————————————————————
app.delete('/api/sessions/:id', async (req, res) => {
  try {
    await db.deleteSession(parseInt(req.params.id));
    res.json({ success: true });
  } catch (error) {
    logger.error(`❌ Ошибка удаления сеанса:`, error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ——————————————————————————————
// HEALTH CHECK
// ——————————————————————————————
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'psixolog-payment-backend',
    version: '1.0.0',
    environment: NODE_ENV,
    payment_mode: MOCK_MODE ? 'MOCK' : 'YooKassa',
    port: PORT
  });
});

// ——————————————————————————————
// CRON: НАПОМИНАНИЯ О СЕАНСАХ
// ——————————————————————————————
// Проверяем каждый час
cron.schedule('0 * * * *', async () => {
  logger.info('🔔 Проверка напоминаний о сеансах...');

  try {
    const sessions = await db.getSessionsForReminder();

    for (const session of sessions) {
      const message = `
🔔 <b>Напоминание о сеансе!</b>

👤 Клиент: ${session.client_name}
📞 Телефон: ${session.client_phone}
📧 Email: ${session.client_email || 'не указан'}

📅 Дата: ${session.session_date}
🕐 Время: ${session.session_time}
💰 Оплата: ${session.amount} ₽

${session.comment ? `📝 Комментарий: ${session.comment}` : ''}
      `.trim();

      await sendTelegramNotification(message);
      await db.markReminderSent(session.id);

      logger.info(`✅ Напоминание отправлено для сеанса #${session.id}`);
    }
  } catch (error) {
    logger.error(`❌ Ошибка отправки напоминаний:`, error.message);
  }
});

// ——————————————————————————————
// ЗАПУСК СЕРВЕРА
// ——————————————————————————————

// Создаём директорию для БД
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir);
}

const server = app.listen(PORT, () => {
  logger.info(`
╔═══════════════════════════════════════════════════════════╗
║   🚀 Сервер запущен + База данных                         ║
║                                                           ║
║   Порт: ${PORT}
║   Режим: ${NODE_ENV}
║   Платежи: ${MOCK_MODE ? '🔧 MOCK' : '💳 ЮKassa'}
║   База данных: ${dataDir}/payments.db
║                                                           ║
║   📱 Откройте: http://localhost:${PORT}                      ║
║                                                           ║
║   API:                                                     ║
║   POST /api/create-payment                                ║
║   GET  /api/sessions                                      ║
║   GET  /api/payments                                      ║
║   GET  /api/health                                        ║
╚═══════════════════════════════════════════════════════════╝
  `);
});

process.on('SIGTERM', () => {
  logger.info('📡 SIGTERM получен. Завершаем работу...');
  server.close(() => {
    db.db.close();
    logger.info('✅ Сервер остановлен');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('📡 SIGINT получен. Завершаем работу...');
  server.close(() => {
    db.db.close();
    logger.info('✅ Сервер остановлен');
    process.exit(0);
  });
});

module.exports = app;
