/** Репозиторий платежей. */
import { all, get, run } from '../connection.js';

const json = (value) => (value == null ? null : JSON.stringify(value));

export function createPayment(data) {
  return run(
    `INSERT INTO payments (
       id, provider_payment_id, order_id, amount, currency, status, description,
       customer_email, customer_phone, customer_name, service_id, service_name,
       comment, payment_method, metadata
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.id,
      data.provider_payment_id ?? null,
      data.order_id,
      data.amount,
      data.currency || 'RUB',
      data.status || 'pending',
      data.description ?? null,
      data.customer_email ?? null,
      data.customer_phone ?? null,
      data.customer_name ?? null,
      data.service_id ?? null,
      data.service_name ?? null,
      data.comment ?? null,
      data.payment_method ?? null,
      json(data.metadata)
    ]
  );
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
  return run('UPDATE payments SET status = ?, paid_at = ? WHERE id = ?', [status, paidAt, id]);
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
