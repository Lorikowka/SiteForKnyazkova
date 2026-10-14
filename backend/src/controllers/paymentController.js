const crypto = require('crypto');
const db = require('../../database');
const logger = require('../utils/logger');
const config = require('../utils/config');
const { createYooKassaPayment, checkYooKassaPayment } = require('../services/paymentService');
const { sendVkBookingNotification } = require('../services/vkService');
const { sendTelegramNotification, escapeTelegramHtml } = require('../services/notificationService');
const {
  buildSlotUsageMap,
  getServiceConfig,
  getSlotStateFromEntries,
  getStoredPaymentMetadata
} = require('./scheduleController');

const hasValidPaymentToken = (paymentRow, providedToken) => {
  if (!providedToken) return false;
  const metadata = getStoredPaymentMetadata(paymentRow);
  return Boolean(metadata.statusToken && providedToken === metadata.statusToken);
};

const canAccessPaymentDetails = (req, paymentRow) => {
  const providedApiKey = req.headers['x-api-key'];
  if (config.app.apiKey && providedApiKey === config.app.apiKey) return true;
  const providedToken = typeof req.query.token === 'string' ? req.query.token : '';
  return hasValidPaymentToken(paymentRow, providedToken);
};

/** Доступность слота для конкретной услуги, даты и времени. */
async function getSlotAvailability({ serviceId, serviceName, sessionDate, sessionTime, excludePaymentId = null }) {
  const service = getServiceConfig(serviceId, serviceName);
  const usageMap = await buildSlotUsageMap({ excludePaymentId });
  const entries = usageMap[`${sessionDate}|${sessionTime}`] || [];
  return getSlotStateFromEntries(service, entries);
}

const normalizeEmail = (value = '') => String(value || '').trim().toLowerCase();
const normalizePhone = (value = '') => String(value || '').replace(/\D/g, '');

const hasSameCustomerIdentity = (left = {}, right = {}) => {
  const leftEmail = normalizeEmail(left.email);
  const rightEmail = normalizeEmail(right.email);
  const leftPhone = normalizePhone(left.phone);
  const rightPhone = normalizePhone(right.phone);
  return Boolean(
    (leftEmail && rightEmail && leftEmail === rightEmail)
    || (leftPhone && rightPhone && leftPhone === rightPhone)
  );
};

/** Ищет повторную запись того же клиента на групповую сессию. */
async function getDuplicateGroupBooking({
  serviceId,
  serviceName,
  sessionDate,
  sessionTime,
  customerEmail,
  customerPhone,
  excludePaymentId = null
}) {
  const service = getServiceConfig(serviceId, serviceName);
  if (service.type !== 'group') return null;

  const usageMap = await buildSlotUsageMap({ excludePaymentId });
  const entries = usageMap[`${sessionDate}|${sessionTime}`] || [];
  return entries.find(entry => hasSameCustomerIdentity(
    { email: entry.email, phone: entry.phone },
    { email: customerEmail, phone: customerPhone }
  )) || null;
}

const createPayment = async (req, res) => {
  try {
    const {
      amount,
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

    // Цену определяет сервер по конфигурации услуги, а не клиент:
    // иначе стоимость можно подменить в теле запроса.
    const serviceConfig = getServiceConfig(serviceId, serviceName);
    const requestedAmount = Number(amount);
    const resolvedAmount = Number.isFinite(serviceConfig.price) && serviceConfig.price > 0
      ? serviceConfig.price
      : (Number.isFinite(requestedAmount) && requestedAmount > 0 ? requestedAmount : 3500);

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

    // Проверяем занятость слота до создания платежа.
    if (sessionDatetime) {
      const blocked = await db.getScheduleException(sessionDate);
      if (blocked) {
        return res.status(409).json({ success: false, error: 'Эта дата закрыта для записи', code: 'date_blocked' });
      }

      const duplicate = await getDuplicateGroupBooking({ serviceId, serviceName, sessionDate, sessionTime, customerEmail, customerPhone });
      if (duplicate) {
        return res.status(409).json({ success: false, error: 'Вы уже записаны или бронируете место на этот групповой тренинг.', code: 'duplicate_group_booking' });
      }

      const availability = await getSlotAvailability({ serviceId, serviceName, sessionDate, sessionTime });
      if (!availability.available) {
        return res.status(409).json({
          success: false,
          error: availability.code === 'group_full' ? 'На этот групповой тренинг мест больше нет.' : 'Выбранное время уже занято.',
          code: availability.code
        });
      }
    }

    await db.createPayment({
      id: paymentId,
      order_id: orderNumber,
      amount: resolvedAmount,
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

    if (config.app.mockMode) {
      await db.updatePaymentStatus(paymentId, 'succeeded', new Date().toISOString());
      return res.json({
        success: true,
        paymentId,
        confirmationUrl: `${config.app.siteUrl}/payment-check.html?mock=true&amount=${resolvedAmount}&payment_id=${paymentId}&token=${statusToken}`,
        amount: resolvedAmount.toString(),
        statusToken,
        mock: true
      });
    }

    if (!config.yookassa.isConfigured) {
      return res.status(503).json({
        success: false,
        error: 'Оплата временно недоступна (ЮKassa не настроена)',
        code: 'yookassa_not_configured'
      });
    }

    const ykPayment = await createYooKassaPayment({
      amount: resolvedAmount,
      description,
      metadata: paymentMetadata,
      returnUrl: `${config.app.siteUrl}/payment-check.html?payment_id=${paymentId}&token=${statusToken}`,
      idempotenceKey: orderNumber
    });

    await db.setPaymentProviderId(paymentId, ykPayment.id);
    res.json({
      success: true,
      paymentId,
      providerPaymentId: ykPayment.id,
      confirmationUrl: ykPayment.confirmation.confirmation_url,
      amount: ykPayment.amount.value,
      statusToken
    });
  } catch (error) {
    logger.error(`Create payment error: ${error.message}`);
    res.status(500).json({ success: false, error: 'Не удалось создать платёж' });
  }
};

const getPayment = async (req, res) => {
  try {
    const { id } = req.params;
    const payment = await db.getPayment(id);
    if (!payment) return res.status(404).json({ success: false, error: 'Платёж не найден' });
    if (!canAccessPaymentDetails(req, payment)) return res.status(403).json({ success: false, error: 'Доступ запрещён' });

    // Если платёж ещё не подтверждён, уточняем статус в ЮKassa.
    if (payment.status === 'pending' && !config.app.mockMode && config.yookassa.isConfigured) {
      try {
        const ykPayment = await checkYooKassaPayment(payment.provider_payment_id || id);

        if (ykPayment.status === 'succeeded' || ykPayment.paid) {
          await db.updatePaymentStatus(id, 'succeeded', ykPayment.paid_at);
          payment.status = 'succeeded';
          payment.paid_at = ykPayment.paid_at;

          const metadata = getStoredPaymentMetadata(payment);
          const message = [
            '✅ <b>Оплата получена!</b>',
            '',
            `👤 Клиент: ${escapeTelegramHtml(payment.customer_name || '—')}`,
            `📞 Телефон: ${escapeTelegramHtml(payment.customer_phone || '—')}`,
            `💎 Услуга: ${escapeTelegramHtml(payment.service_name || '—')}`,
            `📅 Дата: ${escapeTelegramHtml(`${metadata.sessionDate || ''} ${metadata.sessionTime || ''}`.trim() || '—')}`,
            `💰 Сумма: ${escapeTelegramHtml(String(payment.amount))} ₽`
          ].join('\n');

          sendTelegramNotification(message).catch(() => {});
        } else if (['canceled', 'expired'].includes(ykPayment.status)) {
          await db.updatePaymentStatus(id, ykPayment.status);
          payment.status = ykPayment.status;
        }
      } catch (e) {
        logger.warn(`Check YooKassa payment error: ${e.message}`);
      }
    }

    res.json({
      success: true,
      payment: {
        id: payment.id,
        status: payment.status,
        amount: payment.amount,
        currency: payment.currency,
        description: payment.description,
        created_at: payment.created_at,
        paid_at: payment.paid_at,
        service_name: payment.service_name
      }
    });
  } catch (error) {
    logger.error(`Get payment error: ${error.message}`);
    res.status(500).json({ success: false, error: 'Не удалось получить данные платежа' });
  }
};

const getAllPayments = async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const offset = (page - 1) * limit;
    const [payments, total] = await Promise.all([db.getAllPayments(limit, offset), db.countPayments()]);

    res.json({
      success: true,
      payments,
      pagination: { page, limit, total, totalPages: Math.max(Math.ceil(total / limit), 1) }
    });
  } catch (error) {
    logger.error(`Get all payments error: ${error.message}`);
    res.status(500).json({ success: false, error: 'Не удалось получить платежи' });
  }
};

const deletePayment = async (req, res) => {
  try {
    const { id } = req.params;
    const payment = await db.getPayment(id);
    if (!payment) return res.status(404).json({ success: false, error: 'Платёж не найден' });

    const deletedSessions = await db.deleteSessionsByPaymentId(id);
    const deletedPayment = await db.deletePayment(id);
    logger.info(`Удалён платёж ${id} и связанные записи (${deletedSessions.changes})`);

    res.json({ success: true, deletedPayment: deletedPayment.changes, deletedSessions: deletedSessions.changes });
  } catch (error) {
    logger.error(`Delete payment error: ${error.message}`);
    res.status(500).json({ success: false, error: 'Не удалось удалить платёж' });
  }
};

const discardPayment = async (req, res) => {
  try {
    const { id } = req.params;
    const { token } = req.body;
    const payment = await db.getPayment(id);
    if (!payment) return res.json({ success: true, discarded: false, reason: 'not_found' });
    if (!hasValidPaymentToken(payment, token)) return res.status(403).json({ success: false, error: 'Неверный токен' });

    if (payment.status === 'pending' && !config.app.mockMode && config.yookassa.isConfigured) {
      try {
        const ykPayment = await checkYooKassaPayment(payment.provider_payment_id || id);
        if (ykPayment.status === 'succeeded' || ykPayment.paid) {
          await db.updatePaymentStatus(id, 'succeeded', ykPayment.paid_at);
          return res.json({ success: true, discarded: false, reason: 'succeeded' });
        }
        if (['canceled', 'expired'].includes(ykPayment.status)) {
          await db.updatePaymentStatus(id, ykPayment.status);
          payment.status = ykPayment.status;
        }
      } catch (e) {
        logger.warn(`Discard payment check error: ${e.message}`);
      }
    }

    if (!['canceled', 'expired'].includes(payment.status)) {
      return res.json({ success: true, discarded: false, reason: payment.status });
    }

    const sessions = await db.getSessionsByPaymentId(id);
    if (sessions.length > 0) return res.json({ success: true, discarded: false, reason: 'has_sessions' });

    const result = await db.deletePayment(id);
    res.json({ success: true, discarded: Boolean(result.changes), status: payment.status });
  } catch (error) {
    logger.error(`Discard payment error: ${error.message}`);
    res.status(500).json({ success: false, error: 'Не удалось очистить платёж' });
  }
};

module.exports = {
  createPayment,
  getPayment,
  getAllPayments,
  deletePayment,
  discardPayment,
  getSlotAvailability,
  getDuplicateGroupBooking,
  hasValidPaymentToken,
  getStoredPaymentMetadata
};
