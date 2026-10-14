/** Репозиторий записей на сеансы. */
import { all, get, run } from '../connection.js';

/** Собирает WHERE-условие для выборок по сеансам. */
function buildSessionFilter(filters = {}) {
  const where = [];
  const params = [];

  if (filters.from) {
    where.push('session_datetime >= ?');
    params.push(filters.from);
  }
  if (filters.to) {
    where.push('session_datetime < ?');
    params.push(filters.to);
  }
  if (filters.status) {
    where.push('status = ?');
    params.push(filters.status);
  }
  if (filters.past === true) {
    where.push("session_datetime < datetime('now', 'localtime')");
  } else if (filters.past === false) {
    where.push("session_datetime >= datetime('now', 'localtime')");
  }

  return {
    clause: where.length ? `WHERE ${where.join(' AND ')}` : '',
    params
  };
}

export function getAllSessions(limit = 100) {
  return all(
    `SELECT * FROM sessions
     WHERE session_datetime >= datetime('now', 'localtime')
     ORDER BY session_datetime ASC
     LIMIT ?`,
    [limit]
  );
}

export function getPastSessions(limit = 50, offset = 0) {
  return all(
    `SELECT * FROM sessions
     WHERE session_datetime < datetime('now', 'localtime')
     ORDER BY session_datetime DESC
     LIMIT ? OFFSET ?`,
    [limit, offset]
  );
}

export function getSessionsByRange(filters = {}, limit = 100, offset = 0) {
  const { clause, params } = buildSessionFilter(filters);
  return all(
    `SELECT * FROM sessions ${clause} ORDER BY session_datetime ASC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
}

export function countSessionsByRange(filters = {}) {
  const { clause, params } = buildSessionFilter(filters);
  const row = get(`SELECT COUNT(*) AS total FROM sessions ${clause}`, params);
  return row ? row.total : 0;
}

export function countSessions({ past = false } = {}) {
  const comparison = past
    ? "session_datetime < datetime('now', 'localtime')"
    : "session_datetime >= datetime('now', 'localtime')";
  const row = get(`SELECT COUNT(*) AS total FROM sessions WHERE ${comparison}`);
  return row ? row.total : 0;
}

export function getSessionsByPaymentId(paymentId) {
  return all('SELECT * FROM sessions WHERE payment_id = ? ORDER BY created_at ASC', [paymentId]);
}

export function getSession(id) {
  return get('SELECT * FROM sessions WHERE id = ?', [id]);
}

export function getBusySessionByDatetime(datetime) {
  return get(
    `SELECT * FROM sessions
     WHERE session_datetime = ? AND status IN ('scheduled', 'completed')
     LIMIT 1`,
    [datetime]
  );
}

export function createSession(data) {
  return run(
    `INSERT INTO sessions (
       payment_id, client_name, client_phone, client_email,
       service_id, service_name, session_date, session_time, session_datetime,
       amount, comment, status
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.payment_id,
      data.client_name,
      data.client_phone,
      data.client_email ?? null,
      data.service_id ?? null,
      data.service_name,
      data.session_date,
      data.session_time,
      data.session_datetime,
      data.amount,
      data.comment ?? null,
      data.status || 'scheduled'
    ]
  );
}

export function updateSessionStatus(id, status) {
  return run('UPDATE sessions SET status = ? WHERE id = ?', [status, id]);
}

export function deleteSession(id) {
  return run('DELETE FROM sessions WHERE id = ?', [id]);
}

/** Удаляет все сеансы конкретного платежа (используется при очистке). */
export function deleteSessionsByPaymentId(paymentId) {
  return run('DELETE FROM sessions WHERE payment_id = ?', [paymentId]);
}

/** Удаляет все сеансы. Требует явного подтверждения на уровне API. */
export function deleteAllSessions() {
  return run('DELETE FROM sessions');
}

export function getSessionsForReminder() {
  return all(
    `SELECT * FROM sessions
     WHERE status = 'scheduled'
       AND reminder_sent = 0
       AND session_datetime > datetime('now', 'localtime')
       AND session_datetime <= datetime('now', '+48 hours', 'localtime')
     ORDER BY session_datetime ASC`
  );
}

export function markReminderSent(id) {
  return run('UPDATE sessions SET reminder_sent = 1 WHERE id = ?', [id]);
}
