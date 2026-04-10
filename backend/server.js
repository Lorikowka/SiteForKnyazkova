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
const { body, validationResult } = require('express-validator');
const crypto = require('crypto');
const winston = require('winston');

// База данных
const db = require('./database');
const { escapeHtml, sanitizeInput, withRetry } = db;

const app = express();
const PORT = process.env.PORT || 1488;
const FRONTEND_PATH = path.join(__dirname, '..', 'frontend');

// Загружаем конфигурацию услуг
const config = require('./config.json');

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
const YOOKASSA_WEBHOOK_SECRET = process.env.YOOKASSA_WEBHOOK_SECRET;
const SITE_URL = process.env.SITE_URL || 'http://localhost:1488';
const MOCK_MODE = process.env.MOCK_MODE === 'true';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = process.env.SMTP_PORT || 587;
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER;
const API_KEY = process.env.API_KEY || ''; // Ключ для авторизации админ-запросов

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

// Редирект /payment-failed → payment-failed.html
app.get('/payment-failed', (req, res) => {
  res.sendFile(path.join(FRONTEND_PATH, 'payment-failed.html'));
});

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
// sanitizeInput импортирован из database.js

/**
 * Проверяет HMAC-SHA256 подпись webhook от ЮKassa
 */
function verifyWebhookSignature(body, signature) {
  if (!YOOKASSA_WEBHOOK_SECRET) {
    logger.warn('⚠️ YOOKASSA_WEBHOOK_SECRET не установлен — проверка подписи пропущена');
    return true; // Временно пропускаем если ключ не настроен
  }

  if (!signature) {
    logger.warn('⚠️ Отсутствует заголовок X-Yookassa-Signature');
    return false;
  }

  const hmac = crypto.createHmac('sha256', YOOKASSA_WEBHOOK_SECRET);
  hmac.update(JSON.stringify(body));
  const calculatedSignature = hmac.digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(calculatedSignature)
  );
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

/**
 * Middleware: проверка API-ключа для админ-эндпоинтов
 * Если API_KEY не установлен — пропускает все запросы (backward compatibility)
 */
function requireApiKey(req, res, next) {
  if (!API_KEY) {
    logger.warn('⚠️ API_KEY не установлен — админ-эндпоинты без защиты');
    return next();
  }

  const providedKey = req.headers['x-api-key'];
  if (!providedKey || providedKey !== API_KEY) {
    logger.warn('🚋 Неверный API-Key');
    return res.status(401).json({ success: false, error: 'Неверный ключ авторизации' });
  }
  next();
}

async function sendTelegramNotification(message) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: sanitizeInput(message), parse_mode: 'HTML' }),
        signal: controller.signal
      }
    );
    clearTimeout(timeout);
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
        <p>Здравствуйте, <strong>${escapeHtml(name)}</strong>!</p>
        <p>Ваша оплата принята. Детали записи:</p>

        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          <tr>
            <td style="padding: 10px; border-bottom: 1px solid #eee; color: #666;">Услуга:</td>
            <td style="padding: 10px; border-bottom: 1px solid #eee;"><strong>${escapeHtml(serviceName)}</strong></td>
          </tr>
          <tr>
            <td style="padding: 10px; border-bottom: 1px solid #eee; color: #666;">Дата:</td>
            <td style="padding: 10px; border-bottom: 1px solid #eee;">${escapeHtml(sessionDate || '—')}</td>
          </tr>
          <tr>
            <td style="padding: 10px; border-bottom: 1px solid #eee; color: #666;">Время:</td>
            <td style="padding: 10px; border-bottom: 1px solid #eee;">${escapeHtml(sessionTime || '—')}</td>
          </tr>
          <tr>
            <td style="padding: 10px; border-bottom: 1px solid #eee; color: #666;">Сумма:</td>
            <td style="padding: 10px; border-bottom: 1px solid #eee;"><strong style="color: #4CAF50;">${escapeHtml(amount.toString())} ₽</strong></td>
          </tr>
          <tr>
            <td style="padding: 10px; border-bottom: 1px solid #eee; color: #666;">ID платежа:</td>
            <td style="padding: 10px; border-bottom: 1px solid #eee;">${escapeHtml(paymentId)}</td>
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

        const mockConfirmationUrl = `${SITE_URL}/payment-check.html?mock=true&amount=${amount}&payment_id=${paymentId}`;

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
      const ykController = new AbortController();
      const ykTimeout = setTimeout(() => ykController.abort(), 10000);
      const ykResponse = await fetch(
        `${YOOKASSA_BASE_URL}/payments`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotence-Key': orderNumber,
            'Authorization': `Basic ${AUTH_HEADER}`
          },
          body: JSON.stringify({
            amount: { value: amount.toString(), currency: 'RUB' },
            description,
            metadata: { order_id: orderNumber },
            confirmation: {
              type: 'redirect',
              return_url: `${SITE_URL}/payment-check.html?payment_id=${paymentId}`
            },
            capture: true,
            paid: false
          }),
          signal: ykController.signal
        }
      );
      clearTimeout(ykTimeout);

      const payment = await ykResponse.json();
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
        const checkController = new AbortController();
        const checkTimeout = setTimeout(() => checkController.abort(), 5000);
        const ykResponse = await fetch(
          `${YOOKASSA_BASE_URL}/payments/${id}`,
          {
            headers: { 'Authorization': `Basic ${AUTH_HEADER}` },
            signal: checkController.signal
          }
        );
        clearTimeout(checkTimeout);

        const ykPayment = await ykResponse.json();
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

    // Проверяем HMAC-SHA256 подпись
    const signature = req.headers['x-yookassa-signature'];
    if (!verifyWebhookSignature(event, signature)) {
      logger.warn('🚨 Неверная подпись webhook! Запрос отклонён.');
      return res.status(401).send('Invalid signature');
    }

    // Защита от дублирования: проверяем, не обрабатывали уже этот event
    const eventId = event.id || `${event.event}_${object.id}_${event.created_at}`;
    const existingPayment = await db.getPayment(object.id);

    logger.info(`📩 Webhook: ${event.event} ${object.id} (event: ${eventId})`);

    if (event.event === 'payment.succeeded') {
      // Если уже обработан — пропускаем
      if (existingPayment && existingPayment.status === 'succeeded') {
        logger.info(`⏭️ Платёж ${object.id} уже обработан — пропускаем`);
        return res.status(200).send('OK');
      }

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
      // Если уже отменён — пропускаем
      if (existingPayment && (existingPayment.status === 'canceled' || existingPayment.status === 'expired')) {
        logger.info(`⏭️ Платёж ${object.id} уже отменён — пропускаем`);
        return res.status(200).send('OK');
      }

      // Обновляем статус в БД
      await db.updatePaymentStatus(object.id, object.status);

      // Отменяем связанный сеанс (если есть)
      try {
        const sessions = await new Promise((resolve, reject) => {
          db.db.all('SELECT id FROM sessions WHERE payment_id = ?', [object.id], (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
          });
        });

        for (const session of sessions) {
          await db.updateSessionStatus(session.id, 'cancelled');
          logger.info(`❌ Сеанс #${session.id} отменён (платёж ${object.id})`);
        }
      } catch (sessionError) {
        logger.warn(`⚠️ Не удалось отменить сеанс: ${sessionError.message}`);
      }

      logger.info(`❌ Платёж отменён/истёк: ${object.id}. Сеанс(ы) переведены в статус 'cancelled'.`);

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
app.get('/api/sessions',
  requireApiKey,
  rateLimit({ windowMs: 60000, max: 30 }),
  async (req, res) => {
    try {
      const { limit = 50, past = 'false', page = 1 } = req.query;
      const safeLimit = Math.min(parseInt(limit) || 50, 200);
      const safePage = Math.max(parseInt(page) || 1, 1);
      const offset = (safePage - 1) * safeLimit;

      const sessions = past === 'true'
        ? await db.getPastSessions(safeLimit)
        : await db.getAllSessions(safeLimit);

      res.json({ success: true, sessions, page: safePage, limit: safeLimit, total: sessions.length });
    } catch (error) {
      logger.error(`❌ Ошибка получения сеансов:`, error.message);
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

// ——————————————————————————————
// API: ПОЛУЧИТЬ ВСЕ ПЛАТЕЖИ (для бота)
// ——————————————————————————————
app.get('/api/payments',
  requireApiKey,
  rateLimit({ windowMs: 60000, max: 30 }),
  async (req, res) => {
    try {
      const { limit = 20, page = 1 } = req.query;
      const safeLimit = Math.min(parseInt(limit) || 20, 100);
      const safePage = Math.max(parseInt(page) || 1, 1);

      const payments = await db.getAllPayments(safeLimit);
      res.json({ success: true, payments, page: safePage, limit: safeLimit, total: payments.length });
    } catch (error) {
      logger.error(`❌ Ошибка получения платежей:`, error.message);
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

// ——————————————————————————————
// API: УДАЛИТЬ СЕАНС (для бота)
// ——————————————————————————————
app.delete('/api/sessions/:id',
  rateLimit({ windowMs: 60000, max: 10 }),
  async (req, res) => {
    try {
      const sessionId = parseInt(req.params.id);
      if (isNaN(sessionId)) {
        return res.status(400).json({ success: false, error: 'Некорректный ID' });
      }

      const session = await db.getSession(sessionId);
      if (!session) {
        return res.status(404).json({ success: false, error: 'Сеанс не найден' });
      }

      // Отменяем сеанс
      await db.updateSessionStatus(sessionId, 'cancelled');

      // Также отменяем связанный платёж (если есть и в MOCK режиме)
      if (MOCK_MODE && session.payment_id) {
        await db.updatePaymentStatus(session.payment_id, 'canceled');
      }

      logger.info(`❌ Сеанс #${sessionId} удалён через API`);
      res.json({ success: true, message: 'Сеанс отменён' });
    } catch (error) {
      logger.error(`❌ Ошибка удаления сеанса:`, error.message);
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

// ——————————————————————————————
// API: ОТМЕНИТЬ ЗАПИСЬ ПО PAYMENT_ID (для клиента)
// ——————————————————————————————
app.post('/api/cancel-booking',
  rateLimit({ windowMs: 60000, max: 5 }),
  [
    body('paymentId').isString().isLength({ max: 200 }),
    body('reason').optional().isString().isLength({ max: 500 }),
    handleValidationErrors
  ],
  async (req, res) => {
    try {
      const { paymentId, reason } = req.body;

      // Находим сеанс по payment_id
      const sessions = await new Promise((resolve, reject) => {
        db.db.all('SELECT id, status FROM sessions WHERE payment_id = ?', [paymentId], (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });

      if (!sessions || sessions.length === 0) {
        return res.status(404).json({ success: false, error: 'Запись не найдена' });
      }

      for (const session of sessions) {
        if (session.status === 'cancelled' || session.status === 'completed') {
          return res.status(400).json({
            success: false,
            error: `Невозможно отменить (статус: ${session.status})`
          });
        }
        await db.updateSessionStatus(session.id, 'cancelled');
      }

      // Отменяем платёж в MOCK режиме
      if (MOCK_MODE) {
        await db.updatePaymentStatus(paymentId, 'canceled');
      }

      logger.info(`🚫 Запись отменена клиентом: ${paymentId}${reason ? `. Причина: ${sanitizeInput(reason)}` : ''}`);

      res.json({ success: true, message: 'Запись отменена' });
    } catch (error) {
      logger.error(`❌ Ошибка отмены записи:`, error.message);
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

// ——————————————————————————————
// API: ПОЛУЧИТЬ СПИСОК УСЛУГ И ЦЕН
// ——————————————————————————————
app.get('/api/services', (req, res) => {
  res.json({ success: true, services: config.services, schedule: config.schedule });
});

// ——————————————————————————————
// API: РАСПИСАНИЕ (доступные слоты для фронтенда)
// ——————————————————————————————
app.get('/api/schedule', async (req, res) => {
  try {
    const { days } = req.query;
    const safeDays = Math.min(parseInt(days) || config.schedule.daysAhead, 90);

    const allTimes = config.schedule.timeSlots;

    // Получаем занятые слоты из БД
    const sessions = await db.getAllSessions(500);
    const busyMap = {};
    for (const s of sessions) {
      if (s.status === 'scheduled' || s.status === 'completed') {
        const dateStr = s.session_date;
        if (!busyMap[dateStr]) busyMap[dateStr] = [];
        busyMap[dateStr].push(s.session_time);
      }
    }

    // Генерируем свободные слоты
    const freeSlots = {};
    const now = new Date();
    for (let i = 1; i <= safeDays; i++) {
      const d = new Date(now);
      d.setDate(now.getDate() + i);
      const dow = d.getDay();
      if (config.schedule.excludeWeekends && (dow === 0 || dow === 6)) continue;

      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const busy = busyMap[key] || [];
      const available = allTimes.filter(t => !busy.includes(t));

      if (available.length > 0) {
        freeSlots[key] = available;
      }
    }

    res.json({ success: true, freeSlots, busySlots: busyMap });
  } catch (error) {
    logger.error(`❌ Ошибка получения расписания:`, error.message);
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

// Напоминания о сеансах отправляются через Telegram-бот (send_reminders)
// чтобы избежать дублирования уведомлений

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
