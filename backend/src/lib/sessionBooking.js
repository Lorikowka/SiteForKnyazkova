/**
 * Создание записи с защитой от гонок за слот.
 *
 * Проверка занятости и INSERT выполняются в одной транзакции
 * (`BEGIN IMMEDIATE`), поэтому два одновременных запроса не займут один слот.
 */
import { sqlite } from '../db/connection.js';
import { getSlotAvailability, getDuplicateGroupBooking } from '../domain/slots.js';
import { toMinorUnits } from '../domain/money.js';
import { conflict, notFound } from '../utils/errors.js';

function codeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

/** Reactivation must obey the same capacity checks as creating a session. */
export function updateSessionStatusWithSlotGuard(id, status) {
  return sqlite.transaction(() => {
    const session = sqlite.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
    if (!session) throw notFound('Сеанс не найден');
    if (session.status === 'cancelled' && ['scheduled', 'completed'].includes(status)) {
      if (sqlite.prepare('SELECT 1 FROM schedule_exceptions WHERE date = ?').get(session.session_date)) {
        throw conflict('Эта дата закрыта для записи', 'date_blocked');
      }
      const slot = {
        serviceId: session.service_id, serviceName: session.service_name,
        sessionDate: session.session_date, sessionTime: session.session_time,
        customerEmail: session.client_email, customerPhone: session.client_phone,
        excludeSessionId: session.id, excludePaymentId: session.payment_id
      };
      if (getDuplicateGroupBooking(slot)) throw codeError('DUPLICATE_GROUP_BOOKING', 'Duplicate booking');
      const availability = getSlotAvailability(slot);
      if (!availability.available) throw codeError(availability.code === 'group_full' ? 'SLOT_FULL' : 'SLOT_TAKEN', 'Slot unavailable');
      sqlite.prepare('UPDATE sessions SET reminder_sent = 0 WHERE id = ?').run(id);
    }
    sqlite.prepare('UPDATE sessions SET status = ? WHERE id = ?').run(status, id);
  }).immediate();
}

export function createSessionWithSlotGuard(data, options = {}) {
  const apply = sqlite.transaction(() => {
    if (data.payment_id) {
      const existing = sqlite.prepare('SELECT id FROM sessions WHERE payment_id = ? LIMIT 1').get(data.payment_id);
      if (existing) return { id: existing.id, payment_id: data.payment_id, alreadyConfirmed: true };
    }
    const slot = {
      serviceId: data.service_id, serviceName: data.service_name,
      sessionDate: data.session_date, sessionTime: data.session_time,
      excludePaymentId: data.payment_id,
      customerEmail: data.client_email, customerPhone: data.client_phone
    };
    if (getDuplicateGroupBooking(slot)) throw codeError('DUPLICATE_GROUP_BOOKING', 'Duplicate group booking');
    const availability = getSlotAvailability(slot);
    if (!availability.available) throw codeError(availability.code === 'group_full' ? 'SLOT_FULL' : 'SLOT_TAKEN', 'Slot unavailable');

    const result = sqlite.prepare(
      `INSERT INTO sessions (
        payment_id, client_name, client_phone, client_email,
        client_last_name, client_first_name, client_middle_name,
        service_id, service_name, session_date, session_time, session_datetime,
        amount, amount_minor, comment, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      data.payment_id,
      data.client_name,
      data.client_phone,
      data.client_email,
      data.client_last_name || null,
      data.client_first_name || null,
      data.client_middle_name || null,
      data.service_id || null,
      data.service_name,
      data.session_date,
      data.session_time,
      data.session_datetime,
      data.amount,
      toMinorUnits(data.amount),
      data.comment,
      data.status || 'scheduled'
    );

    if (options.paymentUpdate) {
      const update = options.paymentUpdate;
      sqlite.prepare(
        `UPDATE payments
         SET customer_email = ?,
             customer_phone = ?,
             customer_name = ?,
             customer_last_name = ?,
             customer_first_name = ?,
             customer_middle_name = ?,
             service_id = ?,
             service_name = ?,
             comment = ?,
             metadata = ?
         WHERE id = ?`
      ).run(
        update.customer_email || null,
        update.customer_phone || null,
        update.customer_name || null,
        update.customer_last_name || null,
        update.customer_first_name || null,
        update.customer_middle_name || null,
        update.service_id || null,
        update.service_name || null,
        update.comment || null,
        update.metadata ? JSON.stringify(update.metadata) : null,
        data.payment_id
      );
    }

    return { id: result.lastInsertRowid, payment_id: data.payment_id };
  });

  return apply.immediate();
}
