/**
 * Платежи: создание, чтение, удаление и отмена брони.
 *
 * Цену всегда определяет сервер по конфигурации услуги — клиент не может
 * подменить стоимость в теле запроса.
 */
import crypto from 'node:crypto';

import config from '../config/index.js';
import db from '../db/index.js';
import { getServiceConfig, getStoredPaymentMetadata, hasValidPaymentToken } from '../domain/catalog.js';
import { getDuplicateGroupBooking, getSlotAvailability } from '../domain/slots.js';
import {
  escapeTelegramHtml,
  sendTelegramNotification,
  sendVkBookingNotification
} from '../services/notifications.js';
import { checkYooKassaPayment, createYooKassaPayment } from '../services/yookassa.js';
import { conflict, forbidden, notFound, serviceUnavailable } from '../utils/errors.js';
import logger from '../utils/logger.js';

function canAccessPaymentDetails(request, payment) {
  const providedApiKey = request.headers['x-api-key'];
  if (config.app.apiKey && providedApiKey === config.app.apiKey) return true;

  const providedToken = typeof request.query?.token === 'string' ? request.query.token : '';
  return hasValidPaymentToken(payment, providedToken);
}

export async function createPayment(request, reply) {
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
  } = request.body || {};

  // Цену определяет сервер по конфигурации услуги, а не клиент.
  const serviceConfig = getServiceConfig(serviceId, serviceName);
  const requestedAmount = Number(amount);
  const resolvedAmount = Number.isFinite(serviceConfig.price) && serviceConfig.price > 0
    ? serviceConfig.price
    : (Number.isFinite(requestedAmount) && requestedAmount > 0 ? requestedAmount : 3000);

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
    if (db.getScheduleException(sessionDate)) {
      throw conflict('Эта дата закрыта для записи', 'date_blocked');
    }

    if (getDuplicateGroupBooking({ serviceId, serviceName, sessionDate, sessionTime, customerEmail, customerPhone })) {
      throw conflict('Вы уже записаны или бронируете место на этот групповой тренинг.', 'duplicate_group_booking');
    }

    const availability = getSlotAvailability({ serviceId, serviceName, sessionDate, sessionTime });
    if (!availability.available) {
      throw conflict(
        availability.code === 'group_full'
          ? 'На этот групповой тренинг мест больше нет.'
          : 'Выбранное время уже занято.',
        availability.code
      );
    }
  }

  db.createPayment({
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
    db.updatePaymentStatus(paymentId, 'succeeded', new Date().toISOString());
    return reply.send({
      success: true,
      paymentId,
      confirmationUrl: `${config.app.siteUrl}/payment-check.html?mock=true&amount=${resolvedAmount}&payment_id=${paymentId}&token=${statusToken}`,
      amount: resolvedAmount.toString(),
      statusToken,
      mock: true
    });
  }

  if (!config.yookassa.isConfigured) {
    throw serviceUnavailable('Оплата временно недоступна (ЮKassa не настроена)', 'yookassa_not_configured');
  }

  const ykPayment = await createYooKassaPayment({
    amount: resolvedAmount,
    description,
    metadata: paymentMetadata,
    returnUrl: `${config.app.siteUrl}/payment-check.html?payment_id=${paymentId}&token=${statusToken}`,
    idempotenceKey: orderNumber
  });

  db.setPaymentProviderId(paymentId, ykPayment.id);

  return reply.send({
    success: true,
    paymentId,
    providerPaymentId: ykPayment.id,
    confirmationUrl: ykPayment.confirmation.confirmation_url,
    amount: ykPayment.amount.value,
    statusToken
  });
}

export async function getPayment(request, reply) {
  const { id } = request.params;
  const payment = db.getPayment(id);
  if (!payment) throw notFound('Платёж не найден');
  if (!canAccessPaymentDetails(request, payment)) throw forbidden('Доступ запрещён');

  // Если платёж ещё не подтверждён, уточняем статус в ЮKassa.
  if (payment.status === 'pending' && !config.app.mockMode && config.yookassa.isConfigured) {
    try {
      const ykPayment = await checkYooKassaPayment(payment.provider_payment_id || id);

      if (ykPayment.status === 'succeeded' || ykPayment.paid) {
        db.updatePaymentStatus(id, 'succeeded', ykPayment.paid_at);
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
        db.updatePaymentStatus(id, ykPayment.status);
        payment.status = ykPayment.status;
      }
    } catch (error) {
      logger.warn(`Check YooKassa payment error: ${error.message}`);
    }
  }

  return reply.send({
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
}

export async function getAllPayments(request, reply) {
  const limit = Math.min(parseInt(request.query?.limit, 10) || 20, 100);
  const page = Math.max(parseInt(request.query?.page, 10) || 1, 1);
  const offset = (page - 1) * limit;

  const payments = db.getAllPayments(limit, offset);
  const total = db.countPayments();

  return reply.send({
    success: true,
    payments,
    pagination: { page, limit, total, totalPages: Math.max(Math.ceil(total / limit), 1) }
  });
}

export async function deletePayment(request, reply) {
  const { id } = request.params;
  const payment = db.getPayment(id);
  if (!payment) throw notFound('Платёж не найден');

  const deletedSessions = db.deleteSessionsByPaymentId(id);
  const deletedPayment = db.deletePayment(id);
  logger.info(`Удалён платёж ${id} и связанные записи (${deletedSessions.changes})`);

  return reply.send({ success: true, deletedPayment: deletedPayment.changes, deletedSessions: deletedSessions.changes });
}

export async function discardPayment(request, reply) {
  const { id } = request.params;
  const { token } = request.body || {};
  const payment = db.getPayment(id);
  if (!payment) return reply.send({ success: true, discarded: false, reason: 'not_found' });
  if (!hasValidPaymentToken(payment, token)) throw forbidden('Неверный токен');

  if (payment.status === 'pending' && !config.app.mockMode && config.yookassa.isConfigured) {
    try {
      const ykPayment = await checkYooKassaPayment(payment.provider_payment_id || id);
      if (ykPayment.status === 'succeeded' || ykPayment.paid) {
        db.updatePaymentStatus(id, 'succeeded', ykPayment.paid_at);
        return reply.send({ success: true, discarded: false, reason: 'succeeded' });
      }
      if (['canceled', 'expired'].includes(ykPayment.status)) {
        db.updatePaymentStatus(id, ykPayment.status);
        payment.status = ykPayment.status;
      }
    } catch (error) {
      logger.warn(`Discard payment check error: ${error.message}`);
    }
  }

  if (!['canceled', 'expired'].includes(payment.status)) {
    return reply.send({ success: true, discarded: false, reason: payment.status });
  }

  if (db.getSessionsByPaymentId(id).length > 0) {
    return reply.send({ success: true, discarded: false, reason: 'has_sessions' });
  }

  const result = db.deletePayment(id);
  return reply.send({ success: true, discarded: Boolean(result.changes), status: payment.status });
}

export { canAccessPaymentDetails };
