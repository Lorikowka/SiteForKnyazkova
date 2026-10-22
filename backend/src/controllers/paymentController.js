/**
 * Платежи: создание, чтение, удаление и отмена брони.
 *
 * Цену всегда определяет сервер по конфигурации услуги — клиент не может
 * подменить стоимость в теле запроса.
 */
import crypto from 'node:crypto';

import config from '../config/index.js';
import db from '../db/index.js';
import { getServiceConfig, hasValidPaymentToken } from '../domain/catalog.js';
import { getDuplicateGroupBooking, getSlotAvailability } from '../domain/slots.js';
import { createYooKassaPayment } from '../services/yookassa.js';
import { syncPayment, applyProviderPayment } from '../services/paymentSync.js';
import { validateBookingDate, validatePublicBooking } from '../domain/bookingDate.js';
import { buildPersonName } from '../domain/personName.js';
import { badRequest, conflict, forbidden, notFound, serviceUnavailable } from '../utils/errors.js';
import logger from '../utils/logger.js';

function canAccessPaymentDetails(request, payment) {
  const providedApiKey = request.headers['x-api-key'];
  if (config.app.apiKey && providedApiKey === config.app.apiKey) return true;

  const providedToken = typeof request.query?.token === 'string' ? request.query.token : '';
  return hasValidPaymentToken(payment, providedToken);
}

export async function createPayment(request, reply) {
  const {
    description = 'Консультация психолога',
    customerEmail,
    customerName,
    customerLastName,
    customerFirstName,
    customerMiddleName,
    customerPhone,
    serviceId,
    serviceName,
    sessionDate,
    sessionTime,
    sessionDatetime: suppliedDatetime,
    comment
  } = request.body || {};

  const name = {
    lastName: db.sanitizeInput(customerLastName || ''),
    firstName: db.sanitizeInput(customerFirstName || ''),
    middleName: db.sanitizeInput(customerMiddleName || '')
  };
  const resolvedCustomerName = db.sanitizeInput(buildPersonName({ ...name, fullName: customerName }));

  // Цену определяет сервер по конфигурации услуги, а не клиент.
  const serviceConfig = getServiceConfig(serviceId, serviceName);
  if (serviceId && serviceConfig.id !== serviceId) throw badRequest('Неизвестная услуга');
  const resolvedAmount = serviceConfig.price;
  const sessionDatetime = validateBookingDate(sessionDate, sessionTime, suppliedDatetime);
  validatePublicBooking(sessionDate, sessionTime);
  if (!config.app.mockMode && !config.yookassa.isConfigured) {
    throw serviceUnavailable('Оплата временно недоступна (ЮKassa не настроена)', 'yookassa_not_configured');
  }
  const orderNumber = crypto.randomUUID();
  const paymentId = `pay_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const statusToken = crypto.randomBytes(16).toString('hex');
  const cancelToken = crypto.randomBytes(16).toString('hex');

  const paymentMetadata = {
    returnUrl: `${config.app.siteUrl}/payment-check.html?payment_id=${paymentId}&token=${statusToken}`,
    orderId: orderNumber,
    statusToken,
    cancelToken,
    serviceId: serviceConfig.id,
    customerEmail: customerEmail || '',
    customerName: resolvedCustomerName,
    customerLastName: name.lastName,
    customerFirstName: name.firstName,
    customerMiddleName: name.middleName,
    customerPhone: customerPhone || '',
    serviceName: serviceConfig.name,
    sessionDate: sessionDate || '',
    sessionTime: sessionTime || '',
    sessionDatetime: sessionDatetime || '',
    comment: comment || ''
  };

  db.db.transaction(() => {
    // Reserve atomically before the external request.
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
      customer_name: resolvedCustomerName || null,
      customer_last_name: name.lastName || null,
      customer_first_name: name.firstName || null,
      customer_middle_name: name.middleName || null,
      service_id: serviceConfig.id,
      service_name: serviceConfig.name,
      comment: comment || null,
      metadata: paymentMetadata
    });
  }).immediate();

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

  let ykPayment;
  try {
    ykPayment = await createYooKassaPayment({
      amount: resolvedAmount, description, metadata: paymentMetadata,
      returnUrl: paymentMetadata.returnUrl, idempotenceKey: orderNumber
    });
  } catch (error) {
    if (error.definitive) db.updatePaymentStatus(paymentId, 'failed');
    // Keep unknown outcomes reserved until the background reconciler checks them.
    throw serviceUnavailable('Не удалось создать платёж. Повторите проверку позже.', 'payment_provider_error');
  }
  db.setPaymentProviderId(paymentId, ykPayment.id);
  await applyProviderPayment(db.getPayment(paymentId), ykPayment);

  return reply.send({
    success: true,
    paymentId,
    providerPaymentId: ykPayment.id,
    confirmationUrl: ykPayment.confirmation?.confirmation_url || paymentMetadata.returnUrl,
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
  if (['pending', 'waiting_for_capture', 'succeeded'].includes(payment.status)) {
    try { await syncPayment(payment); }
    catch (error) { logger.warn({ paymentId: id, err: error }, 'Payment synchronization failed'); }
    Object.assign(payment, db.getPayment(id));
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
  const limit = Math.max(1, Math.min(parseInt(request.query?.limit, 10) || 20, 100));
  const page = Math.max(parseInt(request.query?.page, 10) || 1, 1);
  const offset = (page - 1) * limit;

  const payments = db.getAllPayments(limit, offset).map((payment) => {
    let metadata = {};
    try { metadata = typeof payment.metadata === 'string' ? JSON.parse(payment.metadata) : (payment.metadata || {}); }
    catch { metadata = {}; }
    const { statusToken, cancelToken, returnUrl, orderId, ...publicMetadata } = metadata;
    const { order_id, ...safePayment } = payment;
    return { ...safePayment, metadata: publicMetadata };
  });
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

  if (['pending', 'waiting_for_capture', 'succeeded'].includes(payment.status)) {
    try { await syncPayment(payment); }
    catch (error) { logger.warn({ paymentId: id, err: error }, 'Payment synchronization failed'); }
    Object.assign(payment, db.getPayment(id));
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
