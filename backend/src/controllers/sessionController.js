/**
 * Записи на сеансы: список, создание, статусы, подтверждение после оплаты,
 * отмена клиентом и напоминания.
 */
import config from '../config/index.js';
import db from '../db/index.js';
import { getServiceConfig, getStoredPaymentMetadata, hasValidPaymentToken } from '../domain/catalog.js';
import { createSessionWithSlotGuard, updateSessionStatusWithSlotGuard } from '../lib/sessionBooking.js';
import { validateBookingDate } from '../domain/bookingDate.js';
import { buildPersonName } from '../domain/personName.js';
import { finalizeBooking } from '../services/booking.js';
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
  const safeLimit = Math.max(1, Math.min(parseInt(limit, 10) || 50, 200));
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

  try { updateSessionStatusWithSlotGuard(sessionId, status); }
  catch (error) { throw rethrowSlotError(error); }
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
    clientLastName,
    clientFirstName,
    clientMiddleName,
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

  const name = {
    lastName: db.sanitizeInput(clientLastName || ''),
    firstName: db.sanitizeInput(clientFirstName || ''),
    middleName: db.sanitizeInput(clientMiddleName || '')
  };
  const resolvedClientName = db.sanitizeInput(buildPersonName({ ...name, fullName: clientName }));

  if (!resolvedClientName || !clientPhone || !sessionDate || !sessionTime) {
    throw badRequest('Нужны: имя клиента, clientPhone, sessionDate, sessionTime');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sessionDate) || !/^\d{2}:\d{2}$/.test(sessionTime)) {
    throw badRequest('Формат даты YYYY-MM-DD, времени HH:MM');
  }

  if (db.getScheduleException(sessionDate)) {
    throw conflict('Эта дата закрыта для записи', 'date_blocked');
  }

  const serviceConfig = getServiceConfig(serviceId, serviceName);
  const resolvedServiceName = serviceName || serviceConfig.name;
  const datetime = validateBookingDate(sessionDate, sessionTime, sessionDatetime);

  let createdSession;
  try {
    createdSession = createSessionWithSlotGuard({
      payment_id: null,
      client_name: resolvedClientName,
      client_last_name: name.lastName || null,
      client_first_name: name.firstName || null,
      client_middle_name: name.middleName || null,
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
    });
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
 * запись. Данные записи берутся только из сохранённого платежа.
 */
export async function confirmBooking(request, reply) {
  const payment = db.getPayment(request.params.id);
  if (!payment) throw notFound('Платёж не найден');
  if (!hasValidPaymentToken(payment, request.body?.token)) throw forbidden('Неверный токен');
  return reply.send(await finalizeBooking(payment.id));
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
