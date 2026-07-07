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
const {
  createApiKeyAuth,
  verifyWebhookSignature: verifyYooKassaWebhookSignature
} = require('./lib/security');
const { createSessionWithSlotGuard } = require('./lib/sessionBooking');
const { createVkNotifier } = require('./lib/vkNotifier');

// База данных
const db = require('./database');
const reviewsDb = require('./reviewsDatabase');
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
const VK_BOT_TOKEN = process.env.VK_BOT_TOKEN;
const VK_NOTIFY_PEER_IDS = process.env.VK_NOTIFY_PEER_IDS || process.env.VK_NOTIFY_PEER_ID;
const VK_API_VERSION = process.env.VK_API_VERSION || '5.199';
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = process.env.SMTP_PORT || 587;
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER;
const API_KEY = process.env.API_KEY || ''; // Ключ для авторизации админ-запросов

const ADMIN_API_KEYS = process.env.ADMIN_API_KEYS || API_KEY;
const BOT_API_KEYS = process.env.BOT_API_KEYS || process.env.BOT_API_KEY || API_KEY;

const YOOKASSA_BASE_URL = 'https://api.yookassa.ru/v3';
const AUTH_HEADER = Buffer.from(`${YOOKASSA_SHOP_ID}:${YOOKASSA_SECRET_KEY}`).toString('base64');
const vkNotifier = createVkNotifier({
  token: VK_BOT_TOKEN,
  peerIds: VK_NOTIFY_PEER_IDS,
  apiVersion: VK_API_VERSION,
  logger,
  sanitize: sanitizeInput
});

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
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Bot-API-Key']
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

app.use(express.json({
  limit: '10kb',
  verify: (req, res, buf) => {
    req.rawBody = buf.toString('utf8');
  }
}));
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
  return verifyYooKassaWebhookSignature({
    body,
    signature,
    secret: YOOKASSA_WEBHOOK_SECRET,
    logger
  });

  if (!YOOKASSA_WEBHOOK_SECRET) {
    logger.error('YOOKASSA_WEBHOOK_SECRET не установлен — webhook отклонён');
    return false;
  }

  if (!signature) {
    logger.warn('⚠️ Отсутствует заголовок X-Yookassa-Signature');
    return false;
  }

  const hmac = crypto.createHmac('sha256', YOOKASSA_WEBHOOK_SECRET);
  hmac.update(body);
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
const requireApiKey = createApiKeyAuth({
  logger,
  adminKeys: ADMIN_API_KEYS,
  botKeys: BOT_API_KEYS
});
function safeJsonParse(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;

  try {
    return JSON.parse(value);
  } catch (error) {
    logger.warn(`Не удалось распарсить JSON metadata: ${error.message}`);
    return fallback;
  }
}

function getStoredPaymentMetadata(paymentRow) {
  return safeJsonParse(paymentRow?.metadata, {});
}

function hasValidPaymentToken(paymentRow, providedToken) {
  if (!providedToken) return false;
  const metadata = getStoredPaymentMetadata(paymentRow);
  return Boolean(metadata.statusToken && providedToken === metadata.statusToken);
}

function getDateFromSessionDatetime(sessionDatetime) {
  return typeof sessionDatetime === 'string' && sessionDatetime.includes('T')
    ? sessionDatetime.split('T')[0]
    : '';
}

function getTimeFromSessionDatetime(sessionDatetime) {
  if (typeof sessionDatetime !== 'string' || !sessionDatetime.includes('T')) return '';
  return sessionDatetime.split('T')[1]?.slice(0, 5) || '';
}

function normalizeEmailValue(value = '') {
  return String(value || '').trim().toLowerCase();
}

function normalizePhoneValue(value = '') {
  return String(value || '').replace(/\D/g, '');
}

function hasSameCustomerIdentity(left = {}, right = {}) {
  const leftEmail = normalizeEmailValue(left.email);
  const rightEmail = normalizeEmailValue(right.email);
  const leftPhone = normalizePhoneValue(left.phone);
  const rightPhone = normalizePhoneValue(right.phone);

  return Boolean(
    (leftEmail && rightEmail && leftEmail === rightEmail)
    || (leftPhone && rightPhone && leftPhone === rightPhone)
  );
}

async function discardPaymentIfUnused(paymentId) {
  const payment = await db.getPayment(paymentId);
  if (!payment) {
    return { discarded: false, reason: 'not_found' };
  }

  if (!['canceled', 'expired'].includes(payment.status)) {
    return { discarded: false, reason: payment.status || 'unknown_status' };
  }

  const sessions = await db.getSessionsByPaymentId(paymentId);
  if (sessions.length > 0) {
    return { discarded: false, reason: 'has_sessions' };
  }

  const result = await db.deletePayment(paymentId);
  return { discarded: Boolean(result.changes) };
}

function getReservedSlotMetadata(paymentRow) {
  const metadata = getStoredPaymentMetadata(paymentRow);
  if (!metadata.sessionDate || !metadata.sessionTime || !metadata.sessionDatetime) {
    return null;
  }

  return {
    paymentId: paymentRow.id,
    status: paymentRow.status,
    serviceId: metadata.serviceId || paymentRow.service_id || '',
    serviceName: metadata.serviceName || paymentRow.service_name || '',
    sessionDate: getDateFromSessionDatetime(metadata.sessionDatetime) || metadata.sessionDate,
    sessionTime: getTimeFromSessionDatetime(metadata.sessionDatetime) || metadata.sessionTime,
    sessionDatetime: metadata.sessionDatetime
  };
}

function getServiceConfig(serviceId, serviceName = '') {
  const normalizedName = String(serviceName || '').toLowerCase();
  const service = config.services.find(item => item.id === serviceId)
    || config.services.find(item => normalizedName.includes(String(item.name || '').toLowerCase()))
    || config.services.find(item => item.id === 'consult')
    || config.services[0];

  return {
    ...service,
    type: service?.type || 'individual',
    capacity: Math.max(1, Number(service?.capacity) || 1)
  };
}

function getRowServiceConfig(row) {
  const metadata = row?.metadata ? getStoredPaymentMetadata(row) : {};
  return getServiceConfig(
    row?.service_id || metadata.serviceId || '',
    row?.service_name || metadata.serviceName || ''
  );
}

function getSlotStateFromEntries(service, entries = []) {
  const hasIndividual = entries.some(entry => entry.type !== 'group');
  const groupCount = entries.filter(entry => entry.type === 'group').length;

  if (service.type === 'group') {
    const remaining = Math.max(0, service.capacity - groupCount);
    return {
      available: !hasIndividual && remaining > 0,
      code: hasIndividual ? 'slot_taken' : (remaining > 0 ? 'available' : 'group_full'),
      occupied: groupCount,
      capacity: service.capacity,
      remaining
    };
  }

  return {
    available: entries.length === 0,
    code: entries.length === 0 ? 'available' : 'slot_taken',
    occupied: entries.length,
    capacity: 1,
    remaining: entries.length === 0 ? 1 : 0
  };
}

async function buildSlotUsageMap({ excludePaymentId = null } = {}) {
  const usageMap = {};
  const addEntry = (sessionDate, sessionTime, entry) => {
    if (!sessionDate || !sessionTime) return;
    const key = `${sessionDate}|${sessionTime}`;
    if (!usageMap[key]) usageMap[key] = [];
    usageMap[key].push(entry);
  };

  const sessions = await db.getAllSessions(1000);
  for (const session of sessions) {
    if (!['scheduled', 'completed'].includes(session.status)) continue;
    const service = getRowServiceConfig(session);
    addEntry(
      getDateFromSessionDatetime(session.session_datetime) || session.session_date,
      getTimeFromSessionDatetime(session.session_datetime) || session.session_time,
      {
      source: 'session',
      paymentId: session.payment_id,
      serviceId: service.id,
      type: service.type,
      email: session.client_email,
      phone: session.client_phone
      }
    );
  }

  const reservedPayments = await db.getPaymentsByStatuses(['pending', 'succeeded', 'waiting_for_capture'], 1000);
  for (const payment of reservedPayments) {
    if (excludePaymentId && payment.id === excludePaymentId) continue;

    const reserved = getReservedSlotMetadata(payment);
    if (!reserved) continue;

    const paymentSessions = await db.getSessionsByPaymentId(payment.id);
    if (paymentSessions.length > 0) continue;

    const service = getServiceConfig(reserved.serviceId || payment.service_id, reserved.serviceName || payment.service_name);
    addEntry(reserved.sessionDate, reserved.sessionTime, {
      source: 'payment',
      paymentId: payment.id,
      serviceId: service.id,
      type: service.type,
      email: payment.customer_email || getStoredPaymentMetadata(payment).customerEmail,
      phone: payment.customer_phone || getStoredPaymentMetadata(payment).customerPhone
    });
  }

  return usageMap;
}

async function getSlotAvailability({ serviceId, serviceName, sessionDate, sessionTime, excludePaymentId = null }) {
  const service = getServiceConfig(serviceId, serviceName);
  const usageMap = await buildSlotUsageMap({ excludePaymentId });
  const entries = usageMap[`${sessionDate}|${sessionTime}`] || [];
  return getSlotStateFromEntries(service, entries);
}

async function getDuplicateGroupBooking({ serviceId, serviceName, sessionDate, sessionTime, customerEmail, customerPhone, excludePaymentId = null }) {
  const service = getServiceConfig(serviceId, serviceName);
  if (service.type !== 'group') return null;

  const usageMap = await buildSlotUsageMap({ excludePaymentId });
  const entries = usageMap[`${sessionDate}|${sessionTime}`] || [];
  return entries.find(entry => hasSameCustomerIdentity(
    { email: entry.email, phone: entry.phone },
    { email: customerEmail, phone: customerPhone }
  )) || null;
}

function canAccessPaymentDetails(req, paymentRow) {
  const providedApiKey = req.headers['x-api-key'];
  if (API_KEY && providedApiKey === API_KEY) {
    return true;
  }

  const providedToken = typeof req.query.token === 'string' ? req.query.token : '';
  return hasValidPaymentToken(paymentRow, providedToken);
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

function buildBookingNotificationEvent(type, { payment = {}, session = {}, status, reason, comment } = {}) {
  const metadata = getStoredPaymentMetadata(payment);
  const sessionDate = session.session_date || metadata.sessionDate || getDateFromSessionDatetime(metadata.sessionDatetime);
  const sessionTime = session.session_time || metadata.sessionTime || getTimeFromSessionDatetime(metadata.sessionDatetime);

  return {
    type,
    clientName: session.client_name || payment.customer_name || metadata.customerName,
    serviceName: session.service_name || payment.service_name || metadata.serviceName,
    sessionDate,
    sessionTime,
    status: status || session.status || 'scheduled',
    paymentStatus: payment.status,
    paymentId: payment.id,
    sessionId: session.id,
    amount: payment.amount || session.amount,
    reason,
    comment: comment || session.comment || payment.comment || metadata.comment
  };
}

function sendVkBookingNotification(type, data = {}) {
  vkNotifier.sendEvent(buildBookingNotificationEvent(type, data)).catch(error => {
    logger.error(`VK notification error: ${error.message}`);
  });
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
app.post('/api/reviews',
  strictLimiter,
  [
    body('rating').isInt({ min: 1, max: 5 }),
    body('name').isString().trim().isLength({ min: 2, max: 120 }),
    body('contact').isString().trim().isLength({ min: 3, max: 160 }),
    body('message').isString().trim().isLength({ min: 10, max: 2000 }),
    handleValidationErrors
  ],
  async (req, res) => {
    try {
      const rating = Number(req.body.rating);
      const name = sanitizeInput(req.body.name);
      const contact = sanitizeInput(req.body.contact);
      const message = sanitizeInput(req.body.message);

      const review = await reviewsDb.createReview({
        rating,
        name,
        contact,
        message,
        source: 'site'
      });

      await sendTelegramNotification([
        'Новый отзыв с сайта',
        `ID: ${review.id}`,
        `Оценка: ${rating}/5`,
        `Имя: ${name}`,
        `Контакт: ${contact}`,
        `Отзыв: ${message}`
      ].join('\n'));

      logger.info(`Review created: #${review.id}, rating: ${rating}, contact: ${contact}`);
      res.status(201).json({ success: true, id: review.id });
    } catch (error) {
      logger.error(`Review error: ${error.message}`);
      res.status(500).json({
        success: false,
        error: 'Не удалось отправить отзыв'
      });
    }
  }
);

app.post('/api/create-payment',
  strictLimiter,
  [
    body('amount').optional().isFloat({ min: 10, max: 250000 }),
    body('description').optional().isString().isLength({ max: 200 }),
    body('orderId').optional().isString().isLength({ max: 50 }).matches(/^[a-zA-Z0-9_-]+$/),
    body('customerEmail').optional({ values: 'falsy' }).isEmail().normalizeEmail(),
    body('customerName').optional().isString().trim().isLength({ min: 2, max: 200 }),
    body('customerPhone').optional().isString().trim().isLength({ min: 5, max: 20 }),
    body('serviceId').optional().isString().trim().isLength({ min: 2, max: 50 }),
    body('serviceName').optional().isString().trim().isLength({ min: 2, max: 100 }),
    body('sessionDate').optional().isString().trim().isLength({ min: 8, max: 20 }),
    body('sessionTime').optional().isString().trim().isLength({ min: 4, max: 10 }),
    body('sessionDatetime').optional().isString().trim().isLength({ min: 16, max: 40 }),
    body('comment').optional().isString().isLength({ max: 500 }),
    handleValidationErrors
  ],
  async (req, res) => {
    try {
      const {
        amount = 3500,
        description = 'Консультация психолога',
        orderId,
        customerEmail,
        customerName,
        customerPhone,
        serviceId,
        serviceName,
        sessionDate,
        sessionTime,
        sessionDatetime,
        comment
      } = req.body;

      const orderNumber = orderId || `order_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      const paymentId = `pay_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      const statusToken = crypto.randomBytes(16).toString('hex');
      const cancelToken = crypto.randomBytes(16).toString('hex');
      const paymentMetadata = {
        orderId: orderNumber,
        statusToken,
        cancelToken,
        serviceId: serviceId || '',
        customerEmail: customerEmail || '',
        customerName: customerName || '',
        customerPhone: customerPhone || '',
        serviceName: serviceName || '',
        sessionDate: sessionDate || '',
        sessionTime: sessionTime || '',
        sessionDatetime: sessionDatetime || '',
        comment: comment || ''
      };

      logger.info(`📝 Создание платежа: ${orderNumber}, сумма: ${amount}₽`);

      // Сохраняем платёж в БД
      if (sessionDatetime) {
        const duplicateBooking = await getDuplicateGroupBooking({
          serviceId,
          serviceName,
          sessionDate,
          sessionTime,
          customerEmail,
          customerPhone
        });

        if (duplicateBooking) {
          return res.status(409).json({
            success: false,
            error: 'Вы уже записаны или бронируете место на этот групповой тренинг. Одному участнику доступно одно место.',
            code: 'duplicate_group_booking'
          });
        }

        const availability = await getSlotAvailability({
          serviceId,
          serviceName,
          sessionDate,
          sessionTime
        });

        if (!availability.available) {
          const isGroupFull = availability.code === 'group_full';
          return res.status(409).json({
            success: false,
            error: isGroupFull
              ? 'На этот групповой тренинг мест больше нет. Пожалуйста, выберите другой слот.'
              : 'Выбранное время уже занято. Пожалуйста, выберите другой слот.',
            code: availability.code
          });
        }
      }

      await db.createPayment({
        id: paymentId,
        provider_payment_id: null,
        order_id: orderNumber,
        amount,
        currency: 'RUB',
        status: 'pending',
        description,
        customer_email: customerEmail || null,
        customer_phone: customerPhone || null,
        customer_name: customerName || null,
        service_id: serviceId || null,
        service_name: serviceName || null,
        comment: comment || null,
        metadata: paymentMetadata
      });

      // MOCK режим
      if (MOCK_MODE) {
        await db.updatePaymentStatus(paymentId, 'succeeded', new Date().toISOString());
        await sendVkBookingNotification('payment_succeeded', {
          payment: {
            id: paymentId,
            amount,
            status: 'succeeded',
            customer_name: customerName,
            customer_phone: customerPhone,
            customer_email: customerEmail,
            service_name: serviceName,
            service_id: serviceId,
            comment,
            metadata: paymentMetadata
          },
          status: 'pending_confirmation'
        });

        const mockConfirmationUrl = `${SITE_URL}/payment-check.html?mock=true&amount=${amount}&payment_id=${paymentId}&token=${statusToken}`;

        logger.info(`✅ MOCK платёж создан: ${paymentId}`);
        return res.json({
          success: true,
          paymentId,
          confirmationUrl: mockConfirmationUrl,
          amount: amount.toString(),
          statusToken,
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
            metadata: paymentMetadata,
            confirmation: {
              type: 'redirect',
              return_url: `${SITE_URL}/payment-check.html?payment_id=${paymentId}&token=${statusToken}`
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

      // Сохраняем внешний ID ЮKassa отдельно, внутренний ID оставляем стабильным
      await db.setPaymentProviderId(paymentId, payment.id);

      res.json({
        success: true,
        paymentId,
        providerPaymentId: payment.id,
        confirmationUrl: payment.confirmation.confirmation_url,
        amount: payment.amount.value,
        statusToken
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

    if (!canAccessPaymentDetails(req, payment)) {
      logger.warn(`🚫 Запрещён доступ к платёжным данным ${id}`);
      return res.status(403).json({ success: false, error: 'Доступ запрещён' });
    }

    // Если статус pending и не MOCK — проверяем через API ЮKassa
    if (payment.status === 'pending' && !MOCK_MODE) {
      try {
        const checkController = new AbortController();
        const checkTimeout = setTimeout(() => checkController.abort(), 5000);
        const externalPaymentId = payment.provider_payment_id || id;
        const ykResponse = await fetch(
          `${YOOKASSA_BASE_URL}/payments/${externalPaymentId}`,
          {
            headers: { 'Authorization': `Basic ${AUTH_HEADER}` },
            signal: checkController.signal
          }
        );
        clearTimeout(checkTimeout);

        const ykPayment = await ykResponse.json();
        if (ykPayment.status === 'succeeded' || ykPayment.paid) {
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

    const publicPayment = {
      id: payment.id,
      status: payment.status,
      amount: payment.amount,
      currency: payment.currency,
      description: payment.description,
      created_at: payment.created_at,
      paid_at: payment.paid_at,
      service_name: payment.service_name
    };

    res.json({ success: true, payment: publicPayment });
  } catch (error) {
    logger.error(`❌ Ошибка получения платежа:`, error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ——————————————————————————————
// API: WEBHOOK ОТ ЮKASSA
// ——————————————————————————————
app.post('/api/payments/:id/discard',
  strictLimiter,
  [
    body('token').isString().isLength({ min: 10, max: 200 }),
    handleValidationErrors
  ],
  async (req, res) => {
    try {
      const { id } = req.params;
      const { token } = req.body;
      const payment = await db.getPayment(id);

      if (!payment) {
        return res.json({ success: true, discarded: false, reason: 'not_found' });
      }

      if (!hasValidPaymentToken(payment, token)) {
        return res.status(403).json({ success: false, error: 'Неверный токен подтверждения' });
      }

      if (payment.status === 'pending' && !MOCK_MODE) {
        try {
          const checkController = new AbortController();
          const checkTimeout = setTimeout(() => checkController.abort(), 5000);
          const externalPaymentId = payment.provider_payment_id || id;
          const ykResponse = await fetch(
            `${YOOKASSA_BASE_URL}/payments/${externalPaymentId}`,
            {
              headers: { 'Authorization': `Basic ${AUTH_HEADER}` },
              signal: checkController.signal
            }
          );
          clearTimeout(checkTimeout);

          const ykPayment = await ykResponse.json();
          if (ykPayment.status === 'succeeded' || ykPayment.paid) {
            await db.updatePaymentStatus(id, 'succeeded', ykPayment.paid_at);
            return res.json({ success: true, discarded: false, reason: 'succeeded' });
          }

          if (ykPayment.status === 'canceled' || ykPayment.status === 'expired') {
            await db.updatePaymentStatus(id, ykPayment.status);
            payment.status = ykPayment.status;
          }
        } catch (error) {
          logger.warn(`Не удалось уточнить статус платежа ${id} перед очисткой: ${error.message}`);
        }
      }

      if (!['canceled', 'expired'].includes(payment.status)) {
        return res.json({ success: true, discarded: false, reason: payment.status || 'unknown_status' });
      }

      const result = await discardPaymentIfUnused(id);
      res.json({ success: true, ...result, status: payment.status });
    } catch (error) {
      logger.error(`❌ Ошибка очистки платежа: ${error.message}`);
      res.status(500).json({ success: false, error: 'Не удалось очистить платёж' });
    }
  }
);

app.post('/api/webhook', async (req, res) => {
  try {
    const event = req.body;
    const object = event.object;

    if (!event.event || !object) {
      return res.status(400).send('Invalid event format');
    }

    // Проверяем HMAC-SHA256 подпись
    const signature = req.headers['x-yookassa-signature'];
    if (!verifyWebhookSignature(req.rawBody || '', signature)) {
      logger.warn('🚨 Неверная подпись webhook! Запрос отклонён.');
      return res.status(401).send('Invalid signature');
    }

    // Защита от дублирования: проверяем, не обрабатывали уже этот event
    const eventId = event.id || `${event.event}_${object.id}_${event.created_at}`;
    const existingPayment = await db.getPaymentByProviderId(object.id);

    logger.info(`📩 Webhook: ${event.event} ${object.id} (event: ${eventId})`);

    if (event.event === 'payment.succeeded') {
      // Если уже обработан — пропускаем
      if (existingPayment && existingPayment.status === 'succeeded') {
        logger.info(`⏭️ Платёж ${object.id} уже обработан — пропускаем`);
        return res.status(200).send('OK');
      }

      // Обновляем статус платежа в БД
      if (!existingPayment) {
        logger.warn(`⚠️ Платёж YooKassa ${object.id} не найден в локальной БД`);
        return res.status(404).send('Payment not found');
      }

      await db.updatePaymentStatus(existingPayment.id, 'succeeded', object.paid_at);
      await sendVkBookingNotification('payment_succeeded', {
        payment: {
          ...existingPayment,
          status: 'succeeded',
          amount: existingPayment.amount || object.amount?.value
        },
        status: 'pending_confirmation'
      });

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
      if (!existingPayment) {
        logger.warn(`⚠️ Платёж YooKassa ${object.id} не найден в локальной БД`);
        return res.status(404).send('Payment not found');
      }

      await db.updatePaymentStatus(existingPayment.id, object.status);
      await sendVkBookingNotification('payment_canceled', {
        payment: {
          ...existingPayment,
          status: object.status,
          amount: existingPayment.amount || object.amount?.value
        },
        status: object.status,
        reason: object.cancellation_details?.reason || ''
      });
      const cleanupResult = await discardPaymentIfUnused(existingPayment.id);
      if (cleanupResult.discarded) {
        logger.info(`🧹 Удалён неиспользованный платёж после ${object.status}: ${existingPayment.id}`);
      }
      logger.info(`❌ Платёж отменён/истёк: ${object.id}`);

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
      const { limit = 50, past = 'false', page = 1, from = '', to = '', status = '' } = req.query;
      const isPast = past === 'true';
      const safeLimit = Math.min(parseInt(limit) || 50, 200);
      const safePage = Math.max(parseInt(page) || 1, 1);
      const offset = (safePage - 1) * safeLimit;
      const filters = {
        past: from || to ? null : isPast,
        from: String(from || '').slice(0, 40),
        to: String(to || '').slice(0, 40),
        status: ['scheduled', 'completed', 'cancelled'].includes(status) ? status : ''
      };

      const [sessions, total] = await Promise.all([
        db.getSessionsByRange(filters, safeLimit, offset),
        db.countSessionsByRange(filters)
      ]);

      res.json({
        success: true,
        sessions,
        pagination: {
          page: safePage,
          limit: safeLimit,
          total,
          totalPages: Math.max(Math.ceil(total / safeLimit), 1)
        }
      });
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
      const offset = (safePage - 1) * safeLimit;

      const [payments, total] = await Promise.all([
        db.getAllPayments(safeLimit, offset),
        db.countPayments()
      ]);

      res.json({
        success: true,
        payments,
        pagination: {
          page: safePage,
          limit: safeLimit,
          total,
          totalPages: Math.max(Math.ceil(total / safeLimit), 1)
        }
      });
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
  requireApiKey,
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
      await sendVkBookingNotification('booking_cancelled', {
        payment: session.payment_id ? await db.getPayment(session.payment_id) : {},
        session: { ...session, status: 'cancelled' },
        status: 'cancelled'
      });

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

app.delete('/api/payments/:id',
  requireApiKey,
  rateLimit({ windowMs: 60000, max: 10 }),
  async (req, res) => {
    try {
      const { id } = req.params;
      const payment = await db.getPayment(id);

      if (!payment) {
        return res.status(404).json({ success: false, error: 'Платёж не найден' });
      }

      const deletedSessions = await db.deleteSessionsByPaymentId(id);
      const deletedPayment = await db.deletePayment(id);

      logger.info(`🧹 Безопасно удалён платёж ${id} и связанные записи (${deletedSessions.changes} sessions)`);
      res.json({
        success: true,
        deletedPayment: deletedPayment.changes,
        deletedSessions: deletedSessions.changes
      });
    } catch (error) {
      logger.error(`❌ Ошибка безопасного удаления платежа: ${error.message}`);
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

app.post('/api/admin/database/cleanup',
  requireApiKey,
  rateLimit({ windowMs: 60000, max: 5 }),
  [
    body('scope').optional().isIn(['all', 'payment']),
    body('paymentId').optional().isString().isLength({ max: 200 }),
    body('confirm').optional().isString().isLength({ max: 50 }),
    handleValidationErrors
  ],
  async (req, res) => {
    try {
      const { scope = 'all', paymentId, confirm } = req.body;

      if (scope === 'payment') {
        if (!paymentId) {
          return res.status(400).json({ success: false, error: 'Укажите paymentId для точечной очистки' });
        }

        const payment = await db.getPayment(paymentId);
        if (!payment) {
          return res.status(404).json({ success: false, error: 'Платёж не найден' });
        }

        const deletedSessions = await db.deleteSessionsByPaymentId(paymentId);
        const deletedPayment = await db.deletePayment(paymentId);

        logger.info(`🧹 Точечная очистка БД для платежа ${paymentId}`);
        return res.json({
          success: true,
          scope,
          deletedPayment: deletedPayment.changes,
          deletedSessions: deletedSessions.changes
        });
      }

      if (confirm !== 'DELETE_ALL') {
        return res.status(400).json({
          success: false,
          error: 'Для полной очистки передайте confirm=DELETE_ALL'
        });
      }

      const deletedSessions = await db.deleteAllSessions();
      const deletedPayments = await db.deleteAllPayments();

      logger.warn(`🧨 Выполнена полная очистка БД: sessions=${deletedSessions.changes}, payments=${deletedPayments.changes}`);
      res.json({
        success: true,
        scope: 'all',
        deletedSessions: deletedSessions.changes,
        deletedPayments: deletedPayments.changes
      });
    } catch (error) {
      logger.error(`❌ Ошибка очистки БД: ${error.message}`);
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

app.post('/api/payments/:id/confirm-booking',
  strictLimiter,
  [
    body('token').isString().isLength({ min: 10, max: 200 }),
    body('customerEmail').optional({ values: 'falsy' }).isEmail().normalizeEmail(),
    body('customerName').optional().isString().trim().isLength({ min: 2, max: 200 }),
    body('customerPhone').optional().isString().trim().isLength({ min: 5, max: 20 }),
    body('serviceId').optional().isString().trim().isLength({ min: 2, max: 50 }),
    body('serviceName').optional().isString().trim().isLength({ min: 2, max: 100 }),
    body('sessionDate').optional().isString().trim().isLength({ min: 8, max: 20 }),
    body('sessionTime').optional().isString().trim().isLength({ min: 4, max: 10 }),
    body('sessionDatetime').optional().isString().trim().isLength({ min: 16, max: 40 }),
    body('comment').optional().isString().isLength({ max: 500 }),
    handleValidationErrors
  ],
  async (req, res) => {
    try {
      const { id } = req.params;
      const payment = await db.getPayment(id);

      if (!payment) {
        return res.status(404).json({ success: false, error: 'Платёж не найден' });
      }

      const {
        token,
        customerEmail,
        customerName,
        customerPhone,
        serviceId,
        serviceName,
        sessionDate,
        sessionTime,
        sessionDatetime,
        comment
      } = req.body;

      if (!hasValidPaymentToken(payment, token)) {
        return res.status(403).json({ success: false, error: 'Неверный токен подтверждения' });
      }

      if (payment.status !== 'succeeded' && payment.status !== 'waiting_for_capture') {
        return res.status(409).json({
          success: false,
          error: 'Запись можно подтвердить только после успешной оплаты'
        });
      }

      const existingSessions = await db.getSessionsByPaymentId(id);
      if (existingSessions.length > 0) {
        return res.json({ success: true, alreadyConfirmed: true, sessionId: existingSessions[0].id });
      }

      if (!customerName || !customerPhone || !serviceName || !sessionDate || !sessionTime || !sessionDatetime) {
        return res.status(400).json({
          success: false,
          error: 'Не хватает данных для подтверждения записи'
        });
      }

      const storedMetadata = getStoredPaymentMetadata(payment);
      const resolvedServiceId = serviceId || storedMetadata.serviceId || payment.service_id || '';
      const duplicateBooking = await getDuplicateGroupBooking({
        serviceId: resolvedServiceId,
        serviceName,
        sessionDate,
        sessionTime,
        customerEmail,
        customerPhone,
        excludePaymentId: id
      });

      if (duplicateBooking) {
        return res.status(409).json({
          success: false,
          error: 'Вы уже записаны на этот групповой тренинг. Одному участнику доступно одно место.',
          code: 'duplicate_group_booking'
        });
      }

      const availability = await getSlotAvailability({
        serviceId: resolvedServiceId,
        serviceName,
        sessionDate,
        sessionTime,
        excludePaymentId: id
      });

      if (!availability.available) {
        const isGroupFull = availability.code === 'group_full';
        return res.status(409).json({
          success: false,
          error: isGroupFull
            ? 'На этот групповой тренинг мест больше нет. Напишите нам, чтобы мы помогли с переносом или возвратом.'
            : 'Выбранное время уже занято. Пожалуйста, выберите другой слот.',
          code: availability.code
        });
      }

      const metadata = {
        ...storedMetadata,
        serviceId: resolvedServiceId,
        customerEmail: customerEmail || '',
        customerName,
        customerPhone,
        serviceName,
        sessionDate,
        sessionTime,
        sessionDatetime,
        comment: comment || ''
      };

      const serviceForGuard = getServiceConfig(resolvedServiceId, serviceName);
      const createdSession = await createSessionWithSlotGuard(db, {
        payment_id: id,
        client_name: customerName,
        client_phone: customerPhone,
        client_email: customerEmail || null,
        service_id: resolvedServiceId || null,
        service_name: serviceName,
        session_date: sessionDate,
        session_time: sessionTime,
        session_datetime: sessionDatetime,
        amount: payment.amount,
        comment: comment || null,
        status: 'scheduled'
      }, {
        serviceType: serviceForGuard.type,
        capacity: serviceForGuard.capacity,
        paymentUpdate: {
          customer_email: customerEmail || null,
          customer_phone: customerPhone,
          customer_name: customerName,
          service_id: resolvedServiceId || null,
          service_name: serviceName,
          comment: comment || null,
          metadata
        }
      });

      if (customerEmail) {
        await sendEmailConfirmation({
          email: customerEmail,
          name: customerName,
          amount: payment.amount,
          serviceName,
          sessionDate,
          sessionTime,
          paymentId: id
        });
      }

      logger.info(`✅ Запись подтверждена после оплаты: ${sessionDatetime} (${id})`);
      await sendVkBookingNotification('booking_created', {
        payment: { ...payment, metadata },
        session: {
          ...createdSession,
          client_name: customerName,
          client_phone: customerPhone,
          client_email: customerEmail || null,
          service_id: resolvedServiceId || null,
          service_name: serviceName,
          session_date: sessionDate,
          session_time: sessionTime,
          session_datetime: sessionDatetime,
          amount: payment.amount,
          comment: comment || null,
          status: 'scheduled'
        },
        status: 'scheduled'
      });

      res.json({ success: true, sessionId: createdSession.id });
    } catch (error) {
      if (['SLOT_FULL', 'SLOT_TAKEN', 'DUPLICATE_GROUP_BOOKING', 'SQLITE_CONSTRAINT'].includes(error.code)) {
        const isDuplicate = error.code === 'DUPLICATE_GROUP_BOOKING';
        return res.status(409).json({
          success: false,
          error: isDuplicate
            ? '?? ??? ???????? ?? ???? ????????? ???????.'
            : '????????? ????? ??? ??????. ??????????, ???????? ?????? ????.',
          code: error.code
        });
      }
      logger.error(`❌ Ошибка подтверждения записи: ${error.message}`);
      res.status(500).json({
        success: false,
        error: 'Не удалось подтвердить запись'
      });
    }
  }
);

// ——————————————————————————————————————————————
// API: ОБНОВИТЬ СТАТУС СЕАНСА (для админ-клиента / будущего VK-бота)
// ——————————————————————————————————————————————
app.patch('/api/sessions/:id/status',
  requireApiKey,
  rateLimit({ windowMs: 60000, max: 30 }),
  [
    body('status').isIn(['scheduled', 'completed', 'cancelled']),
    handleValidationErrors
  ],
  async (req, res) => {
    try {
      const sessionId = parseInt(req.params.id, 10);
      const { status } = req.body;

      if (isNaN(sessionId)) {
        return res.status(400).json({ success: false, error: 'Некорректный ID' });
      }

      const session = await db.getSession(sessionId);
      if (!session) {
        return res.status(404).json({ success: false, error: 'Сеанс не найден' });
      }

      await db.updateSessionStatus(sessionId, status);
      await sendVkBookingNotification('booking_status_changed', {
        payment: session.payment_id ? await db.getPayment(session.payment_id) : {},
        session: { ...session, status },
        status
      });
      logger.info(`🛠️ Статус сеанса #${sessionId} обновлён: ${session.status} -> ${status}`);

      res.json({ success: true, message: 'Статус обновлён', sessionId, status });
    } catch (error) {
      logger.error(`❌ Ошибка обновления статуса сеанса:`, error.message);
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
    body('token').isString().isLength({ min: 16, max: 200 }),
    body('reason').optional().isString().isLength({ max: 500 }),
    handleValidationErrors
  ],
  async (req, res) => {
    try {
      const { paymentId, token, reason } = req.body;
      const payment = await db.getPayment(paymentId);

      if (!payment) {
        return res.status(404).json({ success: false, error: 'Платёж не найден' });
      }

      const metadata = getStoredPaymentMetadata(payment);
      if (!metadata.cancelToken || metadata.cancelToken !== token) {
        logger.warn(`🚫 Неверный токен отмены для платежа ${paymentId}`);
        return res.status(403).json({ success: false, error: 'Доступ запрещён' });
      }

      // Находим сеанс по payment_id
      const sessions = await new Promise((resolve, reject) => {
        db.db.all('SELECT * FROM sessions WHERE payment_id = ?', [paymentId], (err, rows) => {
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
        await sendVkBookingNotification('booking_cancelled', {
          payment: { ...payment, status: MOCK_MODE ? 'canceled' : payment.status },
          session: { ...session, status: 'cancelled' },
          status: 'cancelled',
          reason: sanitizeInput(reason || '')
        });
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

// ——————————————————————————————————————————————
// API: СЕАНСЫ ДЛЯ НАПОМИНАНИЙ
// ——————————————————————————————————————————————
app.get('/api/reminders/due',
  requireApiKey,
  rateLimit({ windowMs: 60000, max: 30 }),
  async (req, res) => {
    try {
      const sessions = await db.getSessionsForReminder();
      res.json({ success: true, sessions, total: sessions.length });
    } catch (error) {
      logger.error(`❌ Ошибка получения напоминаний:`, error.message);
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

app.post('/api/reminders/:id/mark-sent',
  requireApiKey,
  rateLimit({ windowMs: 60000, max: 30 }),
  async (req, res) => {
    try {
      const sessionId = parseInt(req.params.id, 10);
      if (isNaN(sessionId)) {
        return res.status(400).json({ success: false, error: 'Некорректный ID' });
      }

      const session = await db.getSession(sessionId);
      if (!session) {
        return res.status(404).json({ success: false, error: 'Сеанс не найден' });
      }

      await db.markReminderSent(sessionId);
      res.json({ success: true, message: 'Напоминание отмечено как отправленное', sessionId });
    } catch (error) {
      logger.error(`❌ Ошибка отметки напоминания:`, error.message);
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
// API: УПРАВЛЕНИЕ РАСПИСАНИЕМ (Исключения / Выходные)
// ——————————————————————————————
app.post('/api/admin/schedule/block',
  requireApiKey,
  async (req, res) => {
    try {
      const { date, reason } = req.body;
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ success: false, error: 'Формат даты должен быть YYYY-MM-DD' });
      }
      await new Promise((resolve, reject) => {
        db.db.run('INSERT OR REPLACE INTO schedule_exceptions (date, reason) VALUES (?, ?)', [date, reason || ''], (err) => {
          if (err) reject(err); else resolve();
        });
      });
      logger.info(`📅 Дата ${date} закрыта для записи. Причина: ${reason || 'не указана'}`);
      res.json({ success: true, message: `Дата ${date} закрыта` });
    } catch (error) {
      logger.error(`❌ Ошибка блокировки даты: ${error.message}`);
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

app.delete('/api/admin/schedule/block/:date',
  requireApiKey,
  async (req, res) => {
    try {
      const { date } = req.params;
      await new Promise((resolve, reject) => {
        db.db.run('DELETE FROM schedule_exceptions WHERE date = ?', [date], (err) => {
          if (err) reject(err); else resolve();
        });
      });
      logger.info(`📅 Дата ${date} снова открыта для записи.`);
      res.json({ success: true, message: `Дата ${date} открыта` });
    } catch (error) {
      logger.error(`❌ Ошибка разблокировки даты: ${error.message}`);
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

// ——————————————————————————————
// API: РАСПИСАНИЕ (доступные слоты для фронтенда)
// ——————————————————————————————
app.get('/api/schedule', async (req, res) => {
  try {
    const { days, service: serviceQuery, serviceId: serviceIdQuery } = req.query;
    const safeDays = Math.min(parseInt(days) || config.schedule.daysAhead, 90);

    const service = getServiceConfig(serviceIdQuery || serviceQuery || 'consult');
    const allTimes = config.schedule.timeSlots;
    const usageMap = await buildSlotUsageMap();

    // Получаем исключения из БД
    const exceptions = await new Promise((resolve) => {
      db.db.all('SELECT date FROM schedule_exceptions', [], (err, rows) => {
        resolve(rows ? rows.map(r => r.date) : []);
      });
    });

    // Генерируем свободные слоты
    const allSlots = {};
    const freeSlots = {};
    const busyMap = {};
    const slotDetails = {};
    const now = new Date();
    for (let i = 1; i <= safeDays; i++) {
      const d = new Date(now);
      d.setDate(now.getDate() + i);
      const dow = d.getDay();
      if (config.schedule.excludeWeekends && (dow === 0 || dow === 6)) continue;

      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      
      // Пропускаем дату, если она заблокирована администратором
      if (exceptions.includes(key)) continue;

      const available = [];
      allSlots[key] = allTimes;

      for (const time of allTimes) {
        const entries = usageMap[`${key}|${time}`] || [];
        const state = getSlotStateFromEntries(service, entries);

        if (state.available) {
          available.push(time);
        } else {
          if (!busyMap[key]) busyMap[key] = [];
          busyMap[key].push(time);
        }

        if (service.type === 'group') {
          if (!slotDetails[key]) slotDetails[key] = {};
          slotDetails[key][time] = {
            occupied: state.occupied,
            capacity: state.capacity,
            remaining: state.remaining,
            available: state.available
          };
        }
      }

      if (available.length > 0) freeSlots[key] = available;
    }

    res.json({
      success: true,
      service: {
        id: service.id,
        type: service.type,
        capacity: service.capacity
      },
      allSlots,
      freeSlots,
      busySlots: busyMap,
      slotDetails
    });
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

let server;
function startServer() {
  server = app.listen(PORT, () => {
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
    logger.error(`Database is not ready: ${error.message}`);
    process.exit(1);
  });
}

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

app.startServer = startServer;
module.exports = app;
