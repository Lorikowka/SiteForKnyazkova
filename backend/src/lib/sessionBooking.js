/**
 * Создание записи с защитой от гонок за слот.
 *
 * Проверка занятости и INSERT выполняются в одной транзакции
 * (`BEGIN IMMEDIATE`), поэтому два одновременных запроса не займут один слот.
 */
import { sqlite } from '../db/connection.js';
import { services } from '../domain/catalog.js';

const GROUP_SERVICE_IDS = new Set(services.filter((s) => s.type === 'group').map((s) => s.id));
const ACTIVE_STATUSES = ['scheduled', 'completed'];

const normalizeIdentity = (value = '') => String(value || '').trim().toLowerCase();

function codeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function createSessionWithSlotGuard(data, options = {}) {
  const serviceType = options.serviceType || (GROUP_SERVICE_IDS.has(data.service_id) ? 'group' : 'individual');
  const capacity = Math.max(1, Number(options.capacity) || 1);
  const activePlaceholders = ACTIVE_STATUSES.map(() => '?').join(', ');

  const apply = sqlite.transaction(() => {
    if (serviceType === 'group') {
      const countRow = sqlite.prepare(
        `SELECT COUNT(*) AS total
         FROM sessions
         WHERE session_datetime = ?
           AND service_id = ?
           AND status IN (${activePlaceholders})`
      ).get(data.session_datetime, data.service_id || 'group', ...ACTIVE_STATUSES);

      if ((countRow?.total || 0) >= capacity) {
        throw codeError('SLOT_FULL', 'Group slot is full');
      }

      const duplicateRow = sqlite.prepare(
        `SELECT id
         FROM sessions
         WHERE session_datetime = ?
           AND service_id = ?
           AND status IN (${activePlaceholders})
           AND (
             (client_email <> '' AND lower(client_email) = ?)
             OR (client_phone <> '' AND client_phone = ?)
           )
         LIMIT 1`
      ).get(
        data.session_datetime,
        data.service_id || 'group',
        ...ACTIVE_STATUSES,
        normalizeIdentity(data.client_email),
        normalizeIdentity(data.client_phone)
      );

      if (duplicateRow) {
        throw codeError('DUPLICATE_GROUP_BOOKING', 'Duplicate group booking');
      }
    } else {
      const busyRow = sqlite.prepare(
        `SELECT id
         FROM sessions
         WHERE session_datetime = ?
           AND status IN (${activePlaceholders})
         LIMIT 1`
      ).get(data.session_datetime, ...ACTIVE_STATUSES);

      if (busyRow) {
        throw codeError('SLOT_TAKEN', 'Slot is already taken');
      }
    }

    const result = sqlite.prepare(
      `INSERT INTO sessions (
        payment_id, client_name, client_phone, client_email,
        service_id, service_name, session_date, session_time, session_datetime,
        amount, comment, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      data.payment_id,
      data.client_name,
      data.client_phone,
      data.client_email,
      data.service_id || null,
      data.service_name,
      data.session_date,
      data.session_time,
      data.session_datetime,
      data.amount,
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
             service_id = ?,
             service_name = ?,
             comment = ?,
             metadata = ?
         WHERE id = ?`
      ).run(
        update.customer_email || null,
        update.customer_phone || null,
        update.customer_name || null,
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
