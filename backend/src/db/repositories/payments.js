/** Репозиторий платежей. */
import { all, get, run, sqlite } from '../connection.js';
import { toMinorUnits } from '../../domain/money.js';

const json = (value) => (value == null ? null : JSON.stringify(value));

export function createPayment(data) {
  const result = run(
    `INSERT INTO payments (
       id, provider_payment_id, order_id, amount, amount_minor, currency, status, description,
       customer_email, customer_phone, customer_name,
       customer_last_name, customer_first_name, customer_middle_name, service_id, service_name,
       comment, payment_method, metadata
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.id,
      data.provider_payment_id ?? null,
      data.order_id,
      data.amount,
      toMinorUnits(data.amount),
      data.currency || 'RUB',
      data.status || 'pending',
      data.description ?? null,
      data.customer_email ?? null,
      data.customer_phone ?? null,
      data.customer_name ?? null,
      data.customer_last_name ?? null,
      data.customer_first_name ?? null,
      data.customer_middle_name ?? null,
      data.service_id ?? null,
      data.service_name ?? null,
      data.comment ?? null,
      data.payment_method ?? null,
      json(data.metadata)
    ]
  );
  run(
    'INSERT INTO payment_events (payment_id, event_type, new_status) VALUES (?, ?, ?)',
    [data.id, 'payment_created', data.status || 'pending']
  );
  return result;
}

export function getPayment(id) {
  return get('SELECT * FROM payments WHERE id = ?', [id]);
}

export function getPaymentByProviderId(providerId) {
  return get('SELECT * FROM payments WHERE provider_payment_id = ?', [providerId]);
}

export function getAllPayments(limit = 50, offset = 0) {
  return all('SELECT * FROM payments ORDER BY created_at DESC LIMIT ? OFFSET ?', [limit, offset]);
}

export function getPaymentsByStatuses(statuses = [], limit = 500) {
  if (!statuses.length) return [];
  const placeholders = statuses.map(() => '?').join(', ');
  return all(
    `SELECT * FROM payments WHERE status IN (${placeholders}) ORDER BY created_at DESC LIMIT ?`,
    [...statuses, limit]
  );
}

export function countPayments() {
  const row = get('SELECT COUNT(*) AS total FROM payments');
  return row ? row.total : 0;
}

export function updatePaymentStatus(id, status, paidAt = null) {
  return sqlite.transaction(() => {
    const current = get('SELECT status, paid_at FROM payments WHERE id = ?', [id]);
    if (!current) return { changes: 0 };
    const result = run('UPDATE payments SET status = ?, paid_at = ? WHERE id = ?', [status, paidAt, id]);
    if (current.status !== status) {
      run(
        'INSERT INTO payment_events (payment_id, event_type, old_status, new_status) VALUES (?, ?, ?, ?)',
        [id, 'status_changed', current.status, status]
      );
    }
    return result;
  })();
}

export function setPaymentProviderId(id, providerId) {
  return run('UPDATE payments SET provider_payment_id = ? WHERE id = ?', [providerId, id]);
}

export function updatePaymentBookingDetails(id, data) {
  return run(
    `UPDATE payments
     SET customer_email = ?, customer_phone = ?, customer_name = ?,
         service_id = ?, service_name = ?, comment = ?, metadata = ?
     WHERE id = ?`,
    [
      data.customer_email ?? null,
      data.customer_phone ?? null,
      data.customer_name ?? null,
      data.service_id ?? null,
      data.service_name ?? null,
      data.comment ?? null,
      json(data.metadata),
      id
    ]
  );
}

export function deletePayment(id) {
  return run('DELETE FROM payments WHERE id = ?', [id]);
}

/** Удаляет все платежи. Требует явного подтверждения на уровне API. */
export function deleteAllPayments() {
  return run('DELETE FROM payments');
}
