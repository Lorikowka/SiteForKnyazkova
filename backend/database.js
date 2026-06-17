/**
 * ═══════════════════════════════════════════════════════════
 * 📊 МОДУЛЬ БАЗЫ ДАННЫХ (SQLite) - ПУЛЕНЕПРОБИВАЕМЫЙ
 * ═══════════════════════════════════════════════════════════
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const { runMigrations } = require('./migrations');

const IS_VERCEL = process.env.VERCEL === '1' || !!process.env.NOW_REGION;
const DB_PATH = IS_VERCEL ? '/tmp/payments.db' : path.join(__dirname, 'data', 'payments.db');

if (!IS_VERCEL) {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

console.log(`📡 БД: ${DB_PATH}`);

const sqliteInstance = new sqlite3.Database(DB_PATH, (err) => {
  if (err) console.error('❌ Ошибка открытия БД:', err.message);
  else {
    console.log('✅ БД открыта');
    if (!IS_VERCEL) sqliteInstance.run('PRAGMA journal_mode=WAL');
    sqliteInstance.run('PRAGMA busy_timeout=5000');
  }
});

// Базовые обертки
const run = (sql, params = []) => new Promise((res, rej) => {
  sqliteInstance.run(sql, params, function(err) { if (err) rej(err); else res(this); });
});

const all = (sql, params = []) => new Promise((res, rej) => {
  sqliteInstance.all(sql, params, (err, rows) => { if (err) rej(err); else res(rows || []); });
});

const get = (sql, params = []) => new Promise((res, rej) => {
  sqliteInstance.get(sql, params, (err, row) => { if (err) rej(err); else res(row); });
});

// Промис готовности
const ready = (async () => {
  try {
    await runMigrations(sqliteInstance);
    console.log('✅ Миграции завершены');
  } catch (err) {
    console.error('❌ Ошибка миграций:', err.message);
    throw err;
  }
})();

async function withRetry(fn, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try { return await fn(); }
    catch (err) {
      if (i === maxRetries - 1) throw err;
      await new Promise(r => setTimeout(r, 100 * Math.pow(2, i)));
    }
  }
}

// УТИЛИТЫ
const escapeHtml = (str) => {
  if (typeof str !== 'string') return str;
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
};

const sanitizeInput = (input) => {
  if (typeof input !== 'string') return input;
  return input.replace(/<\/?[^>]*>/g, '').replace(/&[a-zA-Z0-9#]+;/g, '').replace(/javascript\s*:/gi, '').replace(/\bon\w+\s*=/gi, '').replace(/data\s*:/gi, '').replace(/`/g, '').trim();
};

// ЭКСПОРТ
module.exports = {
  ready,
  withRetry,
  run,
  all,
  get,
  escapeHtml,
  sanitizeInput,
  // Прокси для прямого доступа если нужно (но лучше не надо)
  db: sqliteInstance,

  // --- ВЫСОКОУРОВНЕВЫЕ ФУНКЦИИ ---
  getAllSessions: (limit = 100) => 
    all(`SELECT * FROM sessions WHERE session_datetime >= datetime('now', 'localtime') ORDER BY session_datetime ASC LIMIT ?`, [limit]),

  getPaymentsByStatuses: (statuses = [], limit = 500) => {
    if (!statuses.length) return Promise.resolve([]);
    const placeholders = statuses.map(() => '?').join(',');
    return all(`SELECT * FROM payments WHERE status IN (${placeholders}) ORDER BY created_at DESC LIMIT ?`, [...statuses, limit]);
  },

  getSessionsByPaymentId: (id) => 
    all('SELECT * FROM sessions WHERE payment_id = ? ORDER BY created_at ASC', [id]),

  createPayment: (d) => 
    run(`INSERT INTO payments (id, provider_payment_id, order_id, amount, currency, status, description, customer_email, customer_phone, customer_name, service_id, service_name, comment, payment_method, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
    [d.id, d.provider_payment_id || null, d.order_id, d.amount, d.currency || 'RUB', d.status || 'pending', d.description, d.customer_email, d.customer_phone, d.customer_name, d.service_id || null, d.service_name, d.comment || null, d.payment_method, d.metadata ? JSON.stringify(d.metadata) : null]),

  updatePaymentStatus: (id, status, paidAt = null) => 
    run(`UPDATE payments SET status = ?, paid_at = ? WHERE id = ?`, [status, paidAt, id]),

  getPayment: (id) => 
    get(`SELECT * FROM payments WHERE id = ?`, [id]),

  createSession: (d) => 
    run(`INSERT INTO sessions (payment_id, client_name, client_phone, client_email, service_id, service_name, session_date, session_time, session_datetime, amount, comment, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
    [d.payment_id, d.client_name, d.client_phone, d.client_email, d.service_id || null, d.service_name, d.session_date, d.session_time, d.session_datetime, d.amount, d.comment, d.status || 'scheduled']),

  getSetting: (key) => 
    get(`SELECT value FROM settings WHERE key = ?`, [key]).then(r => r ? r.value : null),

  setSetting: (key, val) => 
    run(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`, [key, val]),

  // --- ВОССТАНОВЛЕННЫЕ ФУНКЦИИ ---
  deletePayment: (id) => run(`DELETE FROM payments WHERE id = ?`, [id]),

  getPaymentByProviderId: (id) => get(`SELECT * FROM payments WHERE provider_payment_id = ?`, [id]),

  setPaymentProviderId: (id, providerId) => run(`UPDATE payments SET provider_payment_id = ? WHERE id = ?`, [providerId, id]),

  updatePaymentBookingDetails: (id, d) => run(
    `UPDATE payments SET customer_email = ?, customer_phone = ?, customer_name = ?, service_id = ?, service_name = ?, comment = ?, metadata = ? WHERE id = ?`, 
    [d.customer_email || null, d.customer_phone || null, d.customer_name || null, d.service_id || null, d.service_name || null, d.comment || null, d.metadata ? JSON.stringify(d.metadata) : null, id]
  ),

  getAllPayments: (limit = 50, offset = 0) => all(`SELECT * FROM payments ORDER BY created_at DESC LIMIT ? OFFSET ?`, [limit, offset]),

  countPayments: () => get('SELECT COUNT(*) AS total FROM payments').then(r => r ? r.total : 0),

  getPastSessions: (limit = 50, offset = 0) => all(`SELECT * FROM sessions WHERE session_datetime < datetime('now', 'localtime') ORDER BY session_datetime DESC LIMIT ? OFFSET ?`, [limit, offset]),

  getSessionsByRange: (filters = {}, limit = 100, offset = 0) => {
    const where = [];
    const params = [];
    if (filters.from) { where.push('session_datetime >= ?'); params.push(filters.from); }
    if (filters.to) { where.push('session_datetime < ?'); params.push(filters.to); }
    if (filters.status) { where.push('status = ?'); params.push(filters.status); }
    const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';
    return all(`SELECT * FROM sessions ${clause} ORDER BY session_datetime ASC LIMIT ? OFFSET ?`, [...params, limit, offset]);
  },

  countSessions: ({ past = false } = {}) => get(past ? `SELECT COUNT(*) AS total FROM sessions WHERE session_datetime < datetime('now', 'localtime')` : `SELECT COUNT(*) AS total FROM sessions WHERE session_datetime >= datetime('now', 'localtime')`).then(r => r ? r.total : 0),

  updateSessionStatus: (id, status) => run(`UPDATE sessions SET status = ? WHERE id = ?`, [status, id]),

  deleteSession: (id) => run(`DELETE FROM sessions WHERE id = ?`, [id]),

  getSession: (id) => get(`SELECT * FROM sessions WHERE id = ?`, [id]),

  getBusySessionByDatetime: (datetime) => get(`SELECT * FROM sessions WHERE session_datetime = ? AND status IN ('scheduled', 'completed') LIMIT 1`, [datetime]),

  createReview: (d) => run(`INSERT INTO reviews (rating, name, contact, message, source) VALUES (?, ?, ?, ?, ?)`, [d.rating, d.name, d.contact, d.message, d.source || 'site']),

  getAllReviews: (limit = 50, offset = 0) => all(`SELECT * FROM reviews ORDER BY created_at DESC LIMIT ? OFFSET ?`, [limit, offset]),

  escapeHtml: (str) => {
    if (typeof str !== 'string') return str;
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
  },

  sanitizeInput: (input) => {
    if (typeof input !== 'string') return input;
    return input.replace(/<\/?[^>]*>/g, '').replace(/&[a-zA-Z0-9#]+;/g, '').replace(/javascript\s*:/gi, '').replace(/\bon\w+\s*=/gi, '').replace(/data\s*:/gi, '').replace(/`/g, '').trim();
  }
};
