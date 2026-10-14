/**
 * Логика занятости слотов расписания.
 *
 * Слот считается занятым, если на него есть запись (session) или «резерв»
 * от оплаченного/ожидающего платежа, по которому запись ещё не создана.
 * У индивидуальных услуг — 1 место, у групповых — `capacity` мест.
 */
import db from '../db/index.js';
import {
  getDateFromSessionDatetime,
  getReservedSlotMetadata,
  getRowServiceConfig,
  getServiceConfig,
  getStoredPaymentMetadata,
  getTimeFromSessionDatetime
} from './catalog.js';

const normalizeEmail = (value = '') => String(value || '').trim().toLowerCase();
const normalizePhone = (value = '') => String(value || '').replace(/\D/g, '');

function hasSameCustomerIdentity(left = {}, right = {}) {
  const leftEmail = normalizeEmail(left.email);
  const rightEmail = normalizeEmail(right.email);
  const leftPhone = normalizePhone(left.phone);
  const rightPhone = normalizePhone(right.phone);
  return Boolean(
    (leftEmail && rightEmail && leftEmail === rightEmail)
    || (leftPhone && rightPhone && leftPhone === rightPhone)
  );
}

/** Состояние слота по списку занявших его участников. */
export function getSlotStateFromEntries(service, entries = []) {
  const hasIndividual = entries.some((entry) => entry.type !== 'group');
  // У групповых практик вместимость считается по конкретной услуге:
  // группы «онлайн» и «очно» занимают места независимо друг от друга.
  const groupCount = entries.filter((entry) => entry.type === 'group' && entry.serviceId === service.id).length;

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

/** Карта занятости слотов: `{ 'YYYY-MM-DD|HH:MM': [участники] }`. */
export function buildSlotUsageMap({ excludePaymentId = null } = {}) {
  const usageMap = {};
  const addEntry = (sessionDate, sessionTime, entry) => {
    if (!sessionDate || !sessionTime) return;
    const key = `${sessionDate}|${sessionTime}`;
    (usageMap[key] ||= []).push(entry);
  };

  // 1. Все активные записи (одной выборкой).
  const sessions = db.getAllSessions(2000);
  const paymentIdsWithSessions = new Set();

  for (const session of sessions) {
    if (session.payment_id) paymentIdsWithSessions.add(session.payment_id);
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

  // 2. Платежи, которые резервируют слот, но ещё не имеют записи.
  const reservedPayments = db.getPaymentsByStatuses(['pending', 'succeeded', 'waiting_for_capture'], 1000);

  for (const payment of reservedPayments) {
    if (excludePaymentId && payment.id === excludePaymentId) continue;
    if (paymentIdsWithSessions.has(payment.id)) continue;

    const reserved = getReservedSlotMetadata(payment);
    if (!reserved) continue;

    const service = getServiceConfig(
      reserved.serviceId || payment.service_id,
      reserved.serviceName || payment.service_name
    );
    const metadata = getStoredPaymentMetadata(payment);
    addEntry(reserved.sessionDate, reserved.sessionTime, {
      source: 'payment',
      paymentId: payment.id,
      serviceId: service.id,
      type: service.type,
      email: payment.customer_email || metadata.customerEmail,
      phone: payment.customer_phone || metadata.customerPhone
    });
  }

  return usageMap;
}

/** Доступность слота для конкретной услуги, даты и времени. */
export function getSlotAvailability({ serviceId, serviceName, sessionDate, sessionTime, excludePaymentId = null }) {
  const service = getServiceConfig(serviceId, serviceName);
  const entries = buildSlotUsageMap({ excludePaymentId })[`${sessionDate}|${sessionTime}`] || [];
  return getSlotStateFromEntries(service, entries);
}

/** Ищет повторную запись того же клиента на групповую сессию. */
export function getDuplicateGroupBooking({
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

  const entries = buildSlotUsageMap({ excludePaymentId })[`${sessionDate}|${sessionTime}`] || [];
  return entries.find((entry) => hasSameCustomerIdentity(
    { email: entry.email, phone: entry.phone },
    { email: customerEmail, phone: customerPhone }
  )) || null;
}
