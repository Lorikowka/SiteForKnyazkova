/** Finalize a paid booking using persisted details only. */
import { validateBookingDate } from '../domain/bookingDate.js';
import db from '../db/index.js';
import { getStoredPaymentMetadata } from '../domain/catalog.js';
import { buildPersonName } from '../domain/personName.js';
import { getDuplicateGroupBooking, getSlotAvailability } from '../domain/slots.js';
import { createSessionWithSlotGuard } from '../lib/sessionBooking.js';
import { sendEmailConfirmation } from './email.js';
import { escapeTelegramHtml, sendTelegramNotification, sendVkBookingNotification } from './notifications.js';
import { badRequest, conflict, notFound } from '../utils/errors.js';
import logger from '../utils/logger.js';
function rethrowSlotError(error, messages = {}) {
  if (error.code === 'SLOT_TAKEN' || error.code === 'SLOT_FULL') {
    return conflict(messages.taken || 'Слот занят', error.code);
  }
  if (error.code === 'DUPLICATE_GROUP_BOOKING') {
    return conflict(messages.duplicate || 'Клиент уже записан на этот слот', error.code);
  }
  return error;
}


export async function finalizeBooking(id) {
  const payment = db.getPayment(id);
  if (!payment) throw notFound('Платёж не найден');
  if (payment.status !== 'succeeded') {
    throw conflict('Запись возможна только после оплаты');
  }

  const existingSessions = db.getSessionsByPaymentId(id);
  if (existingSessions.length > 0) {
    return { success: true, alreadyConfirmed: true, sessionId: existingSessions[0].id };
  }

  const stored = getStoredPaymentMetadata(payment);
  const pick = (...values) => {
    for (const value of values) {
      const text = value == null ? '' : String(value).trim();
      if (text) return text;
    }
    return '';
  };

  const customerLastName = db.sanitizeInput(pick(payment.customer_last_name, stored.customerLastName));
  const customerFirstName = db.sanitizeInput(pick(payment.customer_first_name, stored.customerFirstName));
  const customerMiddleName = db.sanitizeInput(pick(payment.customer_middle_name, stored.customerMiddleName));
  const customerName = db.sanitizeInput(buildPersonName({
    lastName: customerLastName,
    firstName: customerFirstName,
    middleName: customerMiddleName,
    fullName: pick(payment.customer_name, stored.customerName)
  }));
  const customerPhone = db.sanitizeInput(pick(payment.customer_phone, stored.customerPhone));
  const customerEmail = db.sanitizeInput(pick(payment.customer_email, stored.customerEmail));
  const serviceId = pick(stored.serviceId, payment.service_id);
  const serviceName = pick(payment.service_name, stored.serviceName);
  const sessionDate = pick(stored.sessionDate);
  const sessionTime = pick(stored.sessionTime);
  const sessionDatetime = validateBookingDate(sessionDate, sessionTime, stored.sessionDatetime);
  const comment = db.sanitizeInput(pick(stored.comment, payment.comment));

  if (!customerName || !customerPhone || !serviceName || !sessionDate || !sessionTime || !sessionDatetime) {
    throw badRequest('Не хватает данных для записи', 'missing_booking_data');
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
    customerLastName,
    customerFirstName,
    customerMiddleName,
    customerPhone,
    serviceName,
    sessionDate,
    sessionTime,
    sessionDatetime,
    comment
  };

  let createdSession;
  try {
    createdSession = createSessionWithSlotGuard({
      payment_id: id,
      client_name: customerName,
      client_last_name: customerLastName || null,
      client_first_name: customerFirstName || null,
      client_middle_name: customerMiddleName || null,
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
      paymentUpdate: {
        customer_email: customerEmail || null,
        customer_phone: customerPhone,
        customer_name: customerName,
        customer_last_name: customerLastName || null,
        customer_first_name: customerFirstName || null,
        customer_middle_name: customerMiddleName || null,
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

  if (createdSession.alreadyConfirmed) return { success: true, alreadyConfirmed: true, sessionId: createdSession.id };

  await sendTelegramNotification([
    '✅ <b>Оплата получена, запись подтверждена!</b>',
    `👤 Клиент: ${escapeTelegramHtml(customerName)}`,
    `📞 Телефон: ${escapeTelegramHtml(customerPhone)}`,
    `💎 Услуга: ${escapeTelegramHtml(serviceName)}`,
    `📅 Дата: ${escapeTelegramHtml(`${sessionDate} ${sessionTime}`)}`,
    `💰 Сумма: ${escapeTelegramHtml(String(payment.amount))} ₽`
  ].join('\n'));

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
      client_last_name: customerLastName || null,
      client_first_name: customerFirstName || null,
      client_middle_name: customerMiddleName || null,
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

  return { success: true, sessionId: createdSession.id };
}
