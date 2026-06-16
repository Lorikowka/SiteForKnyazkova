const db = require('../../database');
const logger = require('../utils/logger');
const config = require('../utils/config');
const crypto = require('crypto');
const { createYooKassaPayment, checkYooKassaPayment } = require('../services/paymentService');
const { sendVkBookingNotification } = require('../services/vkService');
const { scheduleController } = require('./scheduleController'); // We need some helpers from there

// Local helpers (duplicated or moved if common)
const getStoredPaymentMetadata = (p) => {
  if (!p?.metadata) return {};
  if (typeof p.metadata === 'object') return p.metadata;
  try { return JSON.parse(p.metadata); } catch (e) { return {}; }
};

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

// We'll need the schedule logic for availability checks
const { buildSlotUsageMap, getServiceConfig, getSlotStateFromEntries } = require('./scheduleController');

async function getSlotAvailability({ serviceId, serviceName, sessionDate, sessionTime, excludePaymentId = null }) {
  const service = getServiceConfig(serviceId, serviceName);
  const usageMap = await buildSlotUsageMap({ excludePaymentId });
  const entries = usageMap[`${sessionDate}|${sessionTime}`] || [];
  return getSlotStateFromEntries(service, entries);
}

const normalizeEmailValue = (value = '') => String(value || '').trim().toLowerCase();
const normalizePhoneValue = (value = '') => String(value || '').replace(/\D/g, '');

const hasSameCustomerIdentity = (left = {}, right = {}) => {
  const leftEmail = normalizeEmailValue(left.email);
  const rightEmail = normalizeEmailValue(right.email);
  const leftPhone = normalizePhoneValue(left.phone);
  const rightPhone = normalizePhoneValue(right.phone);
  return Boolean((leftEmail && rightEmail && leftEmail === rightEmail) || (leftPhone && rightPhone && leftPhone === rightPhone));
};

async function getDuplicateGroupBooking({ serviceId, serviceName, sessionDate, sessionTime, customerEmail, customerPhone, excludePaymentId = null }) {
  const service = getServiceConfig(serviceId, serviceName);
  if (service.type !== 'group') return null;
  const usageMap = await buildSlotUsageMap({ excludePaymentId });
  const entries = usageMap[`${sessionDate}|${sessionTime}`] || [];
  return entries.find(entry => hasSameCustomerIdentity({ email: entry.email, phone: entry.phone }, { email: customerEmail, phone: customerPhone })) || null;
}

const createPayment = async (req, res) => {
  try {
    const { amount = 3500, description = 'Консультация психолога', orderId, customerEmail, customerName, customerPhone, serviceId, serviceName, sessionDate, sessionTime, sessionDatetime, comment } = req.body;
    const orderNumber = orderId || `order_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const paymentId = `pay_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const statusToken = crypto.randomBytes(16).toString('hex');
    const cancelToken = crypto.randomBytes(16).toString('hex');
    
    const paymentMetadata = { orderId: orderNumber, statusToken, cancelToken, serviceId: serviceId || '', customerEmail: customerEmail || '', customerName: customerName || '', customerPhone: customerPhone || '', serviceName: serviceName || '', sessionDate: sessionDate || '', sessionTime: sessionTime || '', sessionDatetime: sessionDatetime || '', comment: comment || '' };

    if (sessionDatetime) {
      const duplicate = await getDuplicateGroupBooking({ serviceId, serviceName, sessionDate, sessionTime, customerEmail, customerPhone });
      if (duplicate) return res.status(409).json({ success: false, error: 'Вы уже записаны или бронируете место на этот групповой тренинг.', code: 'duplicate_group_booking' });

      const availability = await getSlotAvailability({ serviceId, serviceName, sessionDate, sessionTime });
      if (!availability.available) return res.status(409).json({ success: false, error: availability.code === 'group_full' ? 'На этот групповой тренинг мест больше нет.' : 'Выбранное время уже занято.', code: availability.code });
    }

    await db.createPayment({ id: paymentId, provider_payment_id: null, order_id: orderNumber, amount, currency: 'RUB', status: 'pending', description, customer_email: customerEmail || null, customer_phone: customerPhone || null, customer_name: customerName || null, service_id: serviceId || null, service_name: serviceName || null, comment: comment || null, metadata: paymentMetadata });

    if (config.app.mockMode) {
      await db.updatePaymentStatus(paymentId, 'succeeded', new Date().toISOString());
      await sendVkBookingNotification('payment_succeeded', { payment: { id: paymentId, amount, status: 'succeeded', customer_name: customerName, customer_phone: customerPhone, customer_email: customerEmail, service_name: serviceName, service_id: serviceId, comment, metadata: paymentMetadata }, status: 'pending_confirmation' });
      return res.json({ success: true, paymentId, confirmationUrl: `${config.app.siteUrl}/payment-check.html?mock=true&amount=${amount}&payment_id=${paymentId}&token=${statusToken}`, amount: amount.toString(), statusToken, mock: true });
    }

    const ykPayment = await createYooKassaPayment({ amount, description, metadata: paymentMetadata, returnUrl: `${config.app.siteUrl}/payment-check.html?payment_id=${paymentId}&token=${statusToken}`, idempotenceKey: orderNumber });
    await db.setPaymentProviderId(paymentId, ykPayment.id);
    res.json({ success: true, paymentId, providerPaymentId: ykPayment.id, confirmationUrl: ykPayment.confirmation.confirmation_url, amount: ykPayment.amount.value, statusToken });
  } catch (error) {
    logger.error(`Create payment error: ${error.message}`);
    res.status(500).json({ success: false, error: 'Не удалось создать платёж', details: error.message });
  }
};

const getPayment = async (req, res) => {
  try {
    const { id } = req.params;
    const payment = await db.getPayment(id);
    if (!payment) return res.status(404).json({ success: false, error: 'Платёж не найден' });
    if (!canAccessPaymentDetails(req, payment)) return res.status(403).json({ success: false, error: 'Доступ запрещён' });

    if (payment.status === 'pending' && !config.app.mockMode) {
      try {
        const ykPayment = await checkYooKassaPayment(payment.provider_payment_id || id);
        if (ykPayment.status === 'succeeded' || ykPayment.paid) {
          await db.updatePaymentStatus(id, 'succeeded', ykPayment.paid_at);
          
          // Отправляем уведомления только при успешном переходе
          const { sendEmailConfirmation } = require('../services/emailService');
          const { sendTelegramNotification } = require('../services/notificationService');
          const metadata = getStoredPaymentMetadata(payment);
          
          const notifyData = {
            email: payment.customer_email,
            name: payment.customer_name,
            amount: payment.amount,
            serviceName: payment.service_name,
            sessionDate: metadata.sessionDate,
            sessionTime: metadata.sessionTime,
            paymentId: id
          };

          // Email клиенту
          if (payment.customer_email) {
            sendEmailConfirmation(notifyData).catch(e => logger.error(`Email error: ${e.message}`));
          }
          
          // Telegram админу
          const msg = `✅ <b>Новая оплата!</b>\n\n` +
                      `👤 Клиент: ${payment.customer_name}\n` +
                      `📞 Тел: ${payment.customer_phone}\n` +
                      `💎 Услуга: ${payment.service_name}\n` +
                      `📅 Дата: ${metadata.sessionDate} ${metadata.sessionTime}\n` +
                      `💰 Сумма: ${payment.amount} ₽`;
          sendTelegramNotification(msg).catch(e => logger.error(`TG error: ${e.message}`));

          payment.status = 'succeeded';
          payment.paid_at = ykPayment.paid_at;
        } else if (['canceled', 'expired'].includes(ykPayment.status)) {
          await db.updatePaymentStatus(id, ykPayment.status);
          payment.status = ykPayment.status;
        }
      } catch (e) { logger.warn(`Check YK payment error: ${e.message}`); }
    }
    res.json({ success: true, payment: { id: payment.id, status: payment.status, amount: payment.amount, currency: payment.currency, description: payment.description, created_at: payment.created_at, paid_at: payment.paid_at, service_name: payment.service_name } });
  } catch (error) {
    logger.error(`Get payment error: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
};

const getAllPayments = async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const offset = (page - 1) * limit;
    const [payments, total] = await Promise.all([db.getAllPayments(limit, offset), db.countPayments()]);
    res.json({ success: true, payments, pagination: { page, limit, total, totalPages: Math.max(Math.ceil(total / limit), 1) } });
  } catch (error) {
    logger.error(`Get all payments error: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
};

const deletePayment = async (req, res) => {
  try {
    const { id } = req.params;
    const payment = await db.getPayment(id);
    if (!payment) return res.status(404).json({ success: false, error: 'Платёж не найден' });
    const deletedSessions = await db.deleteSessionsByPaymentId(id);
    const deletedPayment = await db.deletePayment(id);
    logger.info(`🧹 Удалён платёж ${id} и связанные записи (${deletedSessions.changes} sessions)`);
    res.json({ success: true, deletedPayment: deletedPayment.changes, deletedSessions: deletedSessions.changes });
  } catch (error) {
    logger.error(`Delete payment error: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
};

const discardPayment = async (req, res) => {
  try {
    const { id } = req.params;
    const { token } = req.body;
    const payment = await db.getPayment(id);
    if (!payment) return res.json({ success: true, discarded: false, reason: 'not_found' });
    if (!hasValidPaymentToken(payment, token)) return res.status(403).json({ success: false, error: 'Неверный токен' });

    if (payment.status === 'pending' && !config.app.mockMode) {
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
      } catch (e) { logger.warn(`Discard check error: ${e.message}`); }
    }

    if (!['canceled', 'expired'].includes(payment.status)) return res.json({ success: true, discarded: false, reason: payment.status });

    const sessions = await db.getSessionsByPaymentId(id);
    if (sessions.length > 0) return res.json({ success: true, discarded: false, reason: 'has_sessions' });

    const result = await db.deletePayment(id);
    res.json({ success: true, discarded: Boolean(result.changes), status: payment.status });
  } catch (error) {
    logger.error(`Discard payment error: ${error.message}`);
    res.status(500).json({ success: false, error: 'Не удалось очистить платёж' });
  }
};

module.exports = { createPayment, getPayment, getAllPayments, deletePayment, discardPayment, getSlotAvailability, getDuplicateGroupBooking, hasValidPaymentToken, getStoredPaymentMetadata };
