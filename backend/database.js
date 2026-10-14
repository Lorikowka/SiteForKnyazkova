/**
 * Модуль доступа к базе данных (SQLite).
 *
 * Используется единый экземпляр соединения. Все запросы выполняются через
 * промисифицированные обёртки `run` / `all` / `get`. Схема создаётся и
 * обновляется миграциями при первом обращении (см. `migrations.js`).
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const { runMigrations } = require('./migrations');

// На serverless-платформах (Vercel) запись возможна только во временную папку.
const IS_SERVERLESS = process.env.VERCEL === '1' || Boolean(process.env.NOW_REGION);
const DB_PATH = process.env.SQLITE_PATH
  || (IS_SERVERLESS ? '/tmp/payments.db' : path.join(__dirname, 'data', 'payments.db'));

if (!IS_SERVERLESS) {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const connection = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Ошибка открытия базы данных:', err.message);
    return;
  }
  // WAL ускоряет параллельное чтение; во временной файловой системе смысла нет.
  if (!IS_SERVERLESS) connection.run('PRAGMA journal_mode=WAL');
  connection.run('PRAGMA busy_timeout=5000');
  connection.run('PRAGMA foreign_keys=ON');
});

/** Промисифицированный `db.run`. Возвращает объект с `lastID` и `changes`. */
function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    connection.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

/** Промисифицированный `db.all`. Всегда возвращает массив. */
function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    connection.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

/** Промисифицированный `db.get`. Возвращает строку или `undefined`. */
function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    connection.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

/** Готовность базы: к моменту resolve применены все миграции. */
const ready = (async () => {
  try {
    await runMigrations(connection);
  } catch (err) {
    console.error('Ошибка миграций:', err.message);
    throw err;
  }
})();

/** Повторяет операцию при временных ошибках SQLite (например, BUSY). */
async function withRetry(fn, maxRetries = 3) {
  let lastError;
  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === maxRetries - 1) break;
      await new Promise(resolve => setTimeout(resolve, 100 * 2 ** attempt));
    }
  }
  throw lastError;
}

/** Экранирует HTML-спецсимволы — для безопасной вставки данных в разметку. */
function escapeHtml(value) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/** Убирает потенциально опасные конструкции из пользовательских строк. */
function sanitizeInput(input) {
  if (typeof input !== 'string') return input;
  return input
    .replace(/<\/?[^>]*>/g, '')
    .replace(/&[a-zA-Z0-9#]+;/g, '')
    .replace(/javascript\s*:/gi, '')
    .replace(/\bon\w+\s*=/gi, '')
    .replace(/data\s*:/gi, '')
    .replace(/`/g, '')
    .trim();
}

const json = (value) => (value == null ? null : JSON.stringify(value));

module.exports = {
  // Низкоуровневый доступ и утилиты
  ready,
  withRetry,
  run,
  all,
  get,
  db: connection,
  close: () => new Promise((resolve, reject) => {
    connection.close(err => (err ? reject(err) : resolve()));
  }),
  escapeHtml,
  sanitizeInput,

  // —— Сеансы ——
  getAllSessions: (limit = 100) => all(
    `SELECT * FROM sessions
     WHERE session_datetime >= datetime('now', 'localtime')
     ORDER BY session_datetime ASC
     LIMIT ?`,
    [limit]
  ),

  getPastSessions: (limit = 50, offset = 0) => all(
    `SELECT * FROM sessions
     WHERE session_datetime < datetime('now', 'localtime')
     ORDER BY session_datetime DESC
     LIMIT ? OFFSET ?`,
    [limit, offset]
  ),

  getSessionsByRange: (filters = {}, limit = 100, offset = 0) => {
    const { clause, params } = buildSessionFilter(filters);
    return all(
      `SELECT * FROM sessions ${clause} ORDER BY session_datetime ASC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
  },

  countSessionsByRange: (filters = {}) => {
    const { clause, params } = buildSessionFilter(filters);
    return get(`SELECT COUNT(*) AS total FROM sessions ${clause}`, params)
      .then(row => (row ? row.total : 0));
  },

  countSessions: ({ past = false } = {}) => {
    const comparison = past
      ? "session_datetime < datetime('now', 'localtime')"
      : "session_datetime >= datetime('now', 'localtime')";
    return get(`SELECT COUNT(*) AS total FROM sessions WHERE ${comparison}`)
      .then(row => (row ? row.total : 0));
  },

  getSessionsByPaymentId: (paymentId) => all(
    'SELECT * FROM sessions WHERE payment_id = ? ORDER BY created_at ASC',
    [paymentId]
  ),

  getSession: (id) => get('SELECT * FROM sessions WHERE id = ?', [id]),

  getBusySessionByDatetime: (datetime) => get(
    `SELECT * FROM sessions
     WHERE session_datetime = ? AND status IN ('scheduled', 'completed')
     LIMIT 1`,
    [datetime]
  ),

  createSession: (data) => run(
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
  ),

  updateSessionStatus: (id, status) => run(
    'UPDATE sessions SET status = ? WHERE id = ?',
    [status, id]
  ),

  deleteSession: (id) => run('DELETE FROM sessions WHERE id = ?', [id]),

  /** Удаляет все сеансы конкретного платежа (используется при очистке). */
  deleteSessionsByPaymentId: (paymentId) => run(
    'DELETE FROM sessions WHERE payment_id = ?',
    [paymentId]
  ),

  /** Удаляет все сеансы. Требует явного подтверждения на уровне API. */
  deleteAllSessions: () => run('DELETE FROM sessions'),

  // —— Платежи ——
  createPayment: (data) => run(
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
  ),

  getPayment: (id) => get('SELECT * FROM payments WHERE id = ?', [id]),

  getPaymentByProviderId: (providerId) => get(
    'SELECT * FROM payments WHERE provider_payment_id = ?',
    [providerId]
  ),

  getAllPayments: (limit = 50, offset = 0) => all(
    'SELECT * FROM payments ORDER BY created_at DESC LIMIT ? OFFSET ?',
    [limit, offset]
  ),

  getPaymentsByStatuses: (statuses = [], limit = 500) => {
    if (!statuses.length) return Promise.resolve([]);
    const placeholders = statuses.map(() => '?').join(', ');
    return all(
      `SELECT * FROM payments WHERE status IN (${placeholders}) ORDER BY created_at DESC LIMIT ?`,
      [...statuses, limit]
    );
  },

  countPayments: () => get('SELECT COUNT(*) AS total FROM payments')
    .then(row => (row ? row.total : 0)),

  updatePaymentStatus: (id, status, paidAt = null) => run(
    'UPDATE payments SET status = ?, paid_at = ? WHERE id = ?',
    [status, paidAt, id]
  ),

  setPaymentProviderId: (id, providerId) => run(
    'UPDATE payments SET provider_payment_id = ? WHERE id = ?',
    [providerId, id]
  ),

  updatePaymentBookingDetails: (id, data) => run(
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
  ),

  deletePayment: (id) => run('DELETE FROM payments WHERE id = ?', [id]),

  /** Удаляет все платежи. Требует явного подтверждения на уровне API. */
  deleteAllPayments: () => run('DELETE FROM payments'),

  // —— Настройки ——
  getSetting: (key) => get('SELECT value FROM settings WHERE key = ?', [key])
    .then(row => (row ? row.value : null)),

  setSetting: (key, value) => run(
    'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
    [key, value]
  ),

  // —— Расписание ——
  getScheduleExceptions: () => all(
    'SELECT date, reason FROM schedule_exceptions ORDER BY date ASC'
  ),

  getScheduleException: (date) => get(
    'SELECT date, reason FROM schedule_exceptions WHERE date = ?',
    [date]
  ),

  // —— Напоминания ——
  getSessionsForReminder: () => all(
    `SELECT * FROM sessions
     WHERE status = 'scheduled'
       AND reminder_sent = 0
       AND session_datetime > datetime('now', 'localtime')
       AND session_datetime <= datetime('now', '+48 hours', 'localtime')
     ORDER BY session_datetime ASC`
  ),

  markReminderSent: (id) => run(
    'UPDATE sessions SET reminder_sent = 1 WHERE id = ?',
    [id]
  ),

  // —— Отзывы ——
  createReview: (data) => run(
    'INSERT INTO reviews (rating, name, contact, message, source) VALUES (?, ?, ?, ?, ?)',
    [data.rating, data.name, data.contact, data.message, data.source || 'site']
  ),

  getAllReviews: (limit = 50, offset = 0) => all(
    'SELECT * FROM reviews ORDER BY created_at DESC LIMIT ? OFFSET ?',
    [limit, offset]
  )
};

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
