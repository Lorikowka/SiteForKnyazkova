/**
 * Записи на сеансы: список, создание, статусы, подтверждение после оплаты,
 * отмена клиентом и напоминания.
 */
import config from '../config/index.js';
import db from '../db/index.js';
import { getServiceConfig, getStoredPaymentMetadata, hasValidPaymentToken } from '../domain/catalog.js';
import { getDuplicateGroupBooking, getSlotAvailability } from '../domain/slots.js';
import { createSessionWithSlotGuard } from '../lib/sessionBooking.js';
import { sendEmailConfirmation } from '../services/email.js';
import { sendVkBookingNotification } from '../services/notifications.js';
import { badRequest, conflict, forbidden, notFound } from '../utils/errors.js';
import logger from '../utils/logger.js';

/** Преобразует ошибки гонки за слот в HTTP 409. */
function rethrowSlotError(error, messages = {}) {
  if (error.code === 'SLOT_TAKEN' || error.code === 'SLOT_FULL') {
    return conflict(messages.taken || 'Слот занят', error.code);
  }
  if (error.code === 'DUPLICATE_GROUP_BOOKING') {
    return conflict(messages.duplicate || 'Клиент уже записан на этот слот', error.code);
  }
  return error;
}

export async function getSessions(request, reply) {
  const { limit = 50, past = 'false', page = 1, from = '', to = '', status = '' } = request.query || {};
  const isPast = past === 'true';
  const safeLimit = Math.min(parseInt(limit, 10) || 50, 200);
  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const offset = (safePage - 1) * safeLimit;

  const filters = {
    past: from || to ? null : isPast,
    from: String(from || '').slice(0, 40),
    to: String(to || '').slice(0, 40),
    status: ['scheduled', 'completed', 'cancelled'].includes(status) ? status : ''
  };

  const sessions = db.getSessionsByRange(filters, safeLimit, offset);
  const total = db.countSessionsByRange(filters);

  return reply.send({
    success: true,
    sessions,
    pagination: { page: safePage, limit: safeLimit, total, totalPages: Math.max(Math.ceil(total / safeLimit), 1) }
  });
}

export async function updateSessionStatus(request, reply) {
  const sessionId = parseInt(request.params.id, 10);
  const { status } = request.body || {};

  const session = db.getSession(sessionId);
  if (!session) throw notFound('Сеанс не найден');

  db.updateSessionStatus(sessionId, status);
  await sendVkBookingNotification('booking_status_changed', {
    payment: session.payment_id ? db.getPayment(session.payment_id) : {},
    session: { ...session, status },
    status
  });

  logger.info(`Статус записи #${sessionId}: ${session.status} -> ${status}`);
  return reply.send({ success: true, message: 'Статус обновлён', sessionId, status });
}

/** Мягкая отмена записи администратором (статус → cancelled). */
export async function cancelSession(request, reply) {
  const sessionId = parseInt(request.params.id, 10);
  const session = db.getSession(sessionId);
  if (!session) throw notFound('Сеанс не найден');

  db.updateSessionStatus(sessionId, 'cancelled');
  await sendVkBookingNotification('booking_cancelled', {
    payment: session.payment_id ? db.getPayment(session.payment_id) : {},
    session: { ...session, status: 'cancelled' },
    status: 'cancelled'
  });
  if (config.app.mockMode && session.payment_id) db.updatePaymentStatus(session.payment_id, 'canceled');

  logger.info(`Запись #${sessionId} отменена администратором`);
  return reply.send({ success: true, message: 'Сеанс отменён' });
}

/** Создание записи администратором (без оплаты). */
export async function createSession(request, reply) {
  const {
    clientName,
    clientPhone,
    clientEmail,
    serviceId,
    serviceName,
    sessionDate,
    sessionTime,
    sessionDatetime,
    amount,
    comment
  } = request.body || {};

  if (!clientName || !clientPhone || !sessionDate || !sessionTime) {
    throw badRequest('Нужны: clientName, clientPhone, sessionDate, sessionTime');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sessionDate) || !/^\d{2}:\d{2}$/.test(sessionTime)) {
    throw badRequest('Формат даты YYYY-MM-DD, времени HH:MM');
  }

  if (db.getScheduleException(sessionDate)) {
    throw conflict('Эта дата закрыта для записи', 'date_blocked');
  }

  const serviceConfig = getServiceConfig(serviceId, serviceName);
  const resolvedServiceName = serviceName || serviceConfig.name;
  const datetime = sessionDatetime || `${sessionDate}T${sessionTime}:00`;

  let createdSession;
  try {
    createdSession = createSessionWithSlotGuard({
      payment_id: null,
      client_name: db.sanitizeInput(clientName),
      client_phone: db.sanitizeInput(clientPhone),
      client_email: clientEmail ? db.sanitizeInput(clientEmail) : null,
      service_id: serviceConfig.id,
      service_name: resolvedServiceName,
      session_date: sessionDate,
      session_time: sessionTime,
      session_datetime: datetime,
      amount: amount ?? serviceConfig.price ?? 0,
      comment: comment ? db.sanitizeInput(comment) : null,
      status: 'scheduled'
    }, { serviceType: serviceConfig.type, capacity: serviceConfig.capacity });
  } catch (error) {
    throw rethrowSlotError(error);
  }

  const session = db.getSession(createdSession.id);
  await sendVkBookingNotification('booking_created', { payment: {}, session, status: 'scheduled' });
  logger.info(`Запись #${createdSession.id} создана через API: ${datetime}`);
  return reply.code(201).send({ success: true, sessionId: createdSession.id, session });
}

/**
 * Подтверждение записи после оплаты: создаёт сеанс, привязанный к платежу.
 *
 * Идемпотентно: повторный вызов для того же платежа возвращает уже созданную
 * запись. Поля записи берутся из тела запроса, а если их там нет — из
 * метаданных платежа.
 */
export async function confirmBooking(request, reply) {
  const { id } = request.params;
  const payment = db.getPayment(id);
  if (!payment) throw notFound('Платёж не найден');

  if (!hasValidPaymentToken(payment, request.body?.token)) throw forbidden('Неверный токен');
  if (!['succeeded', 'waiting_for_capture'].includes(payment.status)) {
    throw conflict('Запись возможна только после оплаты');
  }

  const existingSessions = db.getSessionsByPaymentId(id);
  if (existingSessions.length > 0) {
    return reply.send({ success: true, alreadyConfirmed: true, sessionId: existingSessions[0].id });
  }

  const stored = getStoredPaymentMetadata(payment);
  const pick = (...values) => {
    for (const value of values) {
      const text = value == null ? '' : String(value).trim();
      if (text) return text;
    }
    return '';
  };

  const customerName = db.sanitizeInput(pick(request.body?.customerName, payment.customer_name, stored.customerName));
  const customerPhone = db.sanitizeInput(pick(request.body?.customerPhone, payment.customer_phone, stored.customerPhone));
  const customerEmail = db.sanitizeInput(pick(request.body?.customerEmail, payment.customer_email, stored.customerEmail));
  const serviceId = pick(request.body?.serviceId, stored.serviceId, payment.service_id);
  const serviceName = pick(request.body?.serviceName, payment.service_name, stored.serviceName);
  const sessionDate = pick(request.body?.sessionDate, stored.sessionDate);
  const sessionTime = pick(request.body?.sessionTime, stored.sessionTime);
  const sessionDatetime = pick(
    request.body?.sessionDatetime,
    stored.sessionDatetime,
    sessionDate && sessionTime ? `${sessionDate}T${sessionTime}:00` : ''
  );
  const comment = db.sanitizeInput(pick(request.body?.comment, stored.comment, payment.comment));

  if (!customerName || !customerPhone || !serviceName || !sessionDate || !sessionTime || !sessionDatetime) {
    return reply.code(400).send({ success: false, error: 'Не хватает данных для записи', code: 'missing_booking_data' });
  }

  if (getDuplicateGroupBooking({
    serviceId, serviceName, sessionDate, sessionTime, customerEmail, customerPhone, excludePaymentId: id
  })) {
    throw conflict('Вы уже записаны на этот групповой тренинг.', 'duplicate_group_booking');
  }

  const availability = getSlotAvailability({ serviceId, serviceName, sessionDate, sessionTime, excludePaymentId: id });
  if (!availability.available) {
    throw conflict(
      availability.code === 'group_full'
        ? 'На этот групповой тренинг мест больше нет.'
        : 'Выбранное время уже занято.',
      availability.code
    );
  }

  const metadata = {
    ...stored,
    serviceId,
    customerEmail,
    customerName,
    customerPhone,
    serviceName,
    sessionDate,
    sessionTime,
    sessionDatetime,
    comment
  };
  const serviceConfig = getServiceConfig(serviceId, serviceName);

  let createdSession;
  try {
    createdSession = createSessionWithSlotGuard({
      payment_id: id,
      client_name: customerName,
      client_phone: customerPhone,
      client_email: customerEmail || null,
      service_id: serviceId || null,
      service_name: serviceName,
      session_date: sessionDate,
      session_time: sessionTime,
      session_datetime: sessionDatetime,
      amount: payment.amount,
      comment: comment || null,
      status: 'scheduled'
    }, {
      serviceType: serviceConfig.type,
      capacity: serviceConfig.capacity,
      paymentUpdate: {
        customer_email: customerEmail || null,
        customer_phone: customerPhone,
        customer_name: customerName,
        service_id: serviceId || null,
        service_name: serviceName,
        comment: comment || null,
        metadata
      }
    });
  } catch (error) {
    throw rethrowSlotError(error, {
      taken: 'Выбранное время уже занято.',
      duplicate: 'Вы уже записаны на этот групповой тренинг.'
    });
  }

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

  logger.info(`Запись подтверждена: ${sessionDatetime} (платёж ${id})`);
  await sendVkBookingNotification('booking_created', {
    payment: { ...payment, metadata },
    session: {
      ...createdSession,
      client_name: customerName,
      client_phone: customerPhone,
      client_email: customerEmail || null,
      service_id: serviceId || null,
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

  return reply.send({ success: true, sessionId: createdSession.id });
}

/** Отмена записи самим клиентом по одноразовому токену отмены. */
export async function cancelBookingByClient(request, reply) {
  const { paymentId, token, reason } = request.body || {};
  const payment = db.getPayment(paymentId);
  if (!payment) throw notFound('Платёж не найден');

  const metadata = getStoredPaymentMetadata(payment);
  if (!metadata.cancelToken || metadata.cancelToken !== token) throw forbidden('Доступ запрещён');

  const sessions = db.getSessionsByPaymentId(paymentId);
  if (!sessions || sessions.length === 0) throw notFound('Запись не найдена');

  for (const session of sessions) {
    if (['cancelled', 'completed'].includes(session.status)) continue;
    db.updateSessionStatus(session.id, 'cancelled');
    await sendVkBookingNotification('booking_cancelled', {
      payment: { ...payment, status: config.app.mockMode ? 'canceled' : payment.status },
      session: { ...session, status: 'cancelled' },
      status: 'cancelled',
      reason: db.sanitizeInput(reason || '')
    });
  }

  if (config.app.mockMode) db.updatePaymentStatus(paymentId, 'canceled');
  logger.info(`Запись отменена клиентом: ${paymentId}`);
  return reply.send({ success: true, message: 'Запись отменена' });
}

export async function getRemindersDue(request, reply) {
  const sessions = db.getSessionsForReminder();
  return reply.send({ success: true, sessions, total: sessions.length });
}

export async function markReminderSent(request, reply) {
  const sessionId = parseInt(request.params.id, 10);
  const session = db.getSession(sessionId);
  if (!session) throw notFound('Сеанс не найден');

  db.markReminderSent(sessionId);
  return reply.send({ success: true, message: 'Напоминание отмечено', sessionId });
}
