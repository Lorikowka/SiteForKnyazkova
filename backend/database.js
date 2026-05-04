/**
 * ═══════════════════════════════════════════════════════════
 * 📊 МОДУЛЬ БАЗЫ ДАННЫХ (SQLite)
 * ═══════════════════════════════════════════════════════════
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { runMigrations } = require('./migrations');

// Путь к базе данных
const DB_PATH = path.join(__dirname, 'data', 'payments.db');
let readyResolve;
let readyReject;
const ready = new Promise((resolve, reject) => {
  readyResolve = resolve;
  readyReject = reject;
});

// Создаём подключение
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('❌ Ошибка подключения к БД:', err.message);
  } else {
    console.log('✅ Подключено к SQLite:', DB_PATH);
    // WAL mode для лучшей конкурентности
    db.run('PRAGMA journal_mode=WAL');
    // Busy timeout — ждать 5 секунд перед SQLITE_BUSY
    db.run('PRAGMA busy_timeout=5000');
  }
});

/**
 * Retry-обёртка для SQLite операций
 * Повторяет до 3 раз при SQLITE_BUSY с экспоненциальной задержкой
 */
async function withRetry(fn, maxRetries = 3, baseDelay = 100) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (err.code === 'SQLITE_BUSY' && attempt < maxRetries - 1) {
        const delay = baseDelay * Math.pow(2, attempt);
        console.warn(`⚠️ SQLITE_BUSY, повторная попыка через ${delay}мс (попытка ${attempt + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        throw err;
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════
// СОЗДАНИЕ ТАБЛИЦ
// ═══════════════════════════════════════════════════════════

db.serialize(() => {
  // Таблица платежей
  db.run(`
    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      provider_payment_id TEXT,
      order_id TEXT UNIQUE,
      amount REAL NOT NULL,
      currency TEXT DEFAULT 'RUB',
      status TEXT DEFAULT 'pending',
      description TEXT,
      customer_email TEXT,
      customer_phone TEXT,
      customer_name TEXT,
      service_id TEXT,
      service_name TEXT,
      comment TEXT,
      payment_method TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      paid_at DATETIME,
      metadata TEXT
    )
  `);

  // Таблица записей на сеансы
  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      payment_id TEXT,
      client_name TEXT NOT NULL,
      client_phone TEXT NOT NULL,
      client_email TEXT,
      service_id TEXT,
      service_name TEXT NOT NULL,
      session_date TEXT NOT NULL,
      session_time TEXT NOT NULL,
      session_datetime DATETIME NOT NULL,
      amount REAL NOT NULL,
      status TEXT DEFAULT 'scheduled',
      comment TEXT,
      reminder_sent INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (payment_id) REFERENCES payments(id)
    )
  `);

  // Таблица настроек
  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  // Индексы для ускорения поиска
  db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_date ON sessions(session_date)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status)`);

  db.all(`PRAGMA table_info(payments)`, [], (err, rows) => {
    if (err) {
      console.error('❌ Ошибка проверки схемы payments:', err.message);
      return;
    }

    const columns = new Set(rows.map(row => row.name));
    if (!columns.has('provider_payment_id')) {
      db.run(`ALTER TABLE payments ADD COLUMN provider_payment_id TEXT`, (alterErr) => {
        if (alterErr) {
          console.error('❌ Ошибка миграции provider_payment_id:', alterErr.message);
        } else {
          db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_provider_payment_id ON payments(provider_payment_id) WHERE provider_payment_id IS NOT NULL`);
        }
      });
    } else {
      db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_provider_payment_id ON payments(provider_payment_id) WHERE provider_payment_id IS NOT NULL`);
    }

    if (!columns.has('comment')) {
      db.run(`ALTER TABLE payments ADD COLUMN comment TEXT`, (alterErr) => {
        if (alterErr) {
          console.error('❌ Ошибка миграции comment в payments:', alterErr.message);
        }
      });
    }
    if (!columns.has('service_id')) {
      db.run(`ALTER TABLE payments ADD COLUMN service_id TEXT`, (alterErr) => {
        if (alterErr) {
          console.error('❌ Ошибка миграции service_id в payments:', alterErr.message);
        }
      });
    }
  });

  db.all(`PRAGMA table_info(sessions)`, [], (err, rows) => {
    if (err) {
      console.error('❌ Ошибка проверки схемы sessions:', err.message);
      return;
    }

    const columns = new Set(rows.map(row => row.name));
    if (!columns.has('comment')) {
      db.run(`ALTER TABLE sessions ADD COLUMN comment TEXT`, (alterErr) => {
        if (alterErr) {
          console.error('❌ Ошибка миграции comment в sessions:', alterErr.message);
        }
      });
    }
    if (!columns.has('service_id')) {
      db.run(`ALTER TABLE sessions ADD COLUMN service_id TEXT`, (alterErr) => {
        if (alterErr) {
          console.error('❌ Ошибка миграции service_id в sessions:', alterErr.message);
        }
      });
    }
  });
});

// ═══════════════════════════════════════════════════════════
// ФУНКЦИИ ДЛЯ РАБОТЫ С ПЛАТЕЖАМИ
// ═══════════════════════════════════════════════════════════

/**
 * Создать запись о платеже
 */
runMigrations(db)
  .then(readyResolve)
  .catch((err) => {
    console.error('Database migration error:', err.message);
    readyReject(err);
  });

function createPayment(data) {
  return new Promise((resolve, reject) => {
    const {
      id, provider_payment_id, order_id, amount, currency, status, description,
      customer_email, customer_phone, customer_name, service_id, service_name, comment,
      payment_method, metadata
    } = data;

    const sql = `
      INSERT INTO payments (
        id, provider_payment_id, order_id, amount, currency, status, description,
        customer_email, customer_phone, customer_name, service_id, service_name, comment,
        payment_method, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
      id, provider_payment_id || null, order_id, amount, currency || 'RUB', status || 'pending', description,
      customer_email, customer_phone, customer_name, service_id || null, service_name, comment || null,
      payment_method, metadata ? JSON.stringify(metadata) : null
    ];

    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve({ id: this.id, order_id });
    });
  });
}

/**
 * Обновить статус платежа
 */
function updatePaymentStatus(paymentId, status, paidAt = null) {
  return new Promise((resolve, reject) => {
    const sql = `UPDATE payments SET status = ?, paid_at = ? WHERE id = ?`;
    const nextPaidAt = status === 'succeeded'
      ? (paidAt || new Date().toISOString())
      : null;

    db.run(sql, [status, nextPaidAt, paymentId], function(err) {
      if (err) reject(err);
      else resolve({ changes: this.changes });
    });
  });
}

/**
 * Получить платёж по ID
 */
function getPayment(paymentId) {
  return new Promise((resolve, reject) => {
    const sql = `SELECT * FROM payments WHERE id = ?`;
    db.get(sql, [paymentId], (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function deletePayment(paymentId) {
  return new Promise((resolve, reject) => {
    const sql = `DELETE FROM payments WHERE id = ?`;
    db.run(sql, [paymentId], function(err) {
      if (err) reject(err);
      else resolve({ changes: this.changes });
    });
  });
}

/**
 * Получить все платежи
 */
function getAllPayments(limit = 50, offset = 0) {
  return new Promise((resolve, reject) => {
    const sql = `SELECT * FROM payments ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    db.all(sql, [limit, offset], (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function getPaymentByProviderId(providerPaymentId) {
  return new Promise((resolve, reject) => {
    const sql = `SELECT * FROM payments WHERE provider_payment_id = ?`;
    db.get(sql, [providerPaymentId], (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function getPaymentsByStatuses(statuses = [], limit = 500) {
  return new Promise((resolve, reject) => {
    if (!Array.isArray(statuses) || statuses.length === 0) {
      resolve([]);
      return;
    }

    const placeholders = statuses.map(() => '?').join(', ');
    const sql = `
      SELECT * FROM payments
      WHERE status IN (${placeholders})
      ORDER BY created_at DESC
      LIMIT ?
    `;

    db.all(sql, [...statuses, limit], (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function setPaymentProviderId(paymentId, providerPaymentId) {
  return new Promise((resolve, reject) => {
    const sql = `UPDATE payments SET provider_payment_id = ? WHERE id = ?`;
    db.run(sql, [providerPaymentId, paymentId], function(err) {
      if (err) reject(err);
      else resolve({ changes: this.changes });
    });
  });
}

function updatePaymentBookingDetails(paymentId, data) {
  return new Promise((resolve, reject) => {
    const {
      customer_email,
      customer_phone,
      customer_name,
      service_id,
      service_name,
      comment,
      metadata
    } = data;

    const sql = `
      UPDATE payments
      SET customer_email = ?,
          customer_phone = ?,
          customer_name = ?,
          service_id = ?,
          service_name = ?,
          comment = ?,
          metadata = ?
      WHERE id = ?
    `;

    db.run(
      sql,
      [
        customer_email || null,
        customer_phone || null,
        customer_name || null,
        service_id || null,
        service_name || null,
        comment || null,
        metadata ? JSON.stringify(metadata) : null,
        paymentId
      ],
      function(err) {
        if (err) reject(err);
        else resolve({ changes: this.changes });
      }
    );
  });
}

function countPayments() {
  return new Promise((resolve, reject) => {
    db.get('SELECT COUNT(*) AS total FROM payments', [], (err, row) => {
      if (err) reject(err);
      else resolve(row?.total || 0);
    });
  });
}

// ═══════════════════════════════════════════════════════════
// ФУНКЦИИ ДЛЯ РАБОТЫ С СЕАНСАМИ
// ═══════════════════════════════════════════════════════════

/**
 * Создать запись о сеансе
 */
function createSession(data) {
  return new Promise((resolve, reject) => {
    const {
      payment_id, client_name, client_phone, client_email,
      service_id, service_name, session_date, session_time, session_datetime,
      amount, comment, status
    } = data;

    const sql = `
      INSERT INTO sessions (
        payment_id, client_name, client_phone, client_email,
        service_id, service_name, session_date, session_time, session_datetime,
        amount, comment, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
      payment_id, client_name, client_phone, client_email, service_id || null,
      service_name, session_date, session_time, session_datetime,
      amount, comment, status || 'scheduled'
    ];

    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, payment_id });
    });
  });
}

/**
 * Получить все сеансы
 */
function getAllSessions(limit = 100, offset = 0) {
  return new Promise((resolve, reject) => {
    const sql = `
      SELECT * FROM sessions 
      WHERE session_datetime >= datetime('now', 'localtime')
      ORDER BY session_datetime ASC 
      LIMIT ?
      OFFSET ?
    `;
    db.all(sql, [limit, offset], (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

/**
 * Получить прошедшие сеансы
 */
function getPastSessions(limit = 50, offset = 0) {
  return new Promise((resolve, reject) => {
    const sql = `
      SELECT * FROM sessions 
      WHERE session_datetime < datetime('now', 'localtime')
      ORDER BY session_datetime DESC 
      LIMIT ?
      OFFSET ?
    `;
    db.all(sql, [limit, offset], (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function buildSessionFilter({ past = null, from = '', to = '', status = '' } = {}) {
  const where = [];
  const params = [];

  if (from) { where.push('session_datetime >= ?'); params.push(from); }
  if (to) { where.push('session_datetime < ?'); params.push(to); }
  if (status) { where.push('status = ?'); params.push(status); }
  if (!from && !to && past !== null) {
    where.push(past ? "session_datetime < datetime('now', 'localtime')" : "session_datetime >= datetime('now', 'localtime')");
  }

  return { clause: where.length ? 'WHERE ' + where.join(' AND ') : '', params };
}

function getSessionsByRange(filters = {}, limit = 100, offset = 0) {
  return new Promise((resolve, reject) => {
    const built = buildSessionFilter(filters);
    const sql = 'SELECT * FROM sessions ' + built.clause + ' ORDER BY session_datetime ASC LIMIT ? OFFSET ?';
    db.all(sql, [...built.params, limit, offset], (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function countSessionsByRange(filters = {}) {
  return new Promise((resolve, reject) => {
    const built = buildSessionFilter(filters);
    const sql = 'SELECT COUNT(*) AS total FROM sessions ' + built.clause;
    db.get(sql, built.params, (err, row) => {
      if (err) reject(err);
      else resolve(row?.total || 0);
    });
  });
}

function countSessions({ past = false } = {}) {
  return new Promise((resolve, reject) => {
    const sql = past
      ? `SELECT COUNT(*) AS total FROM sessions WHERE session_datetime < datetime('now', 'localtime')`
      : `SELECT COUNT(*) AS total FROM sessions WHERE session_datetime >= datetime('now', 'localtime')`;

    db.get(sql, [], (err, row) => {
      if (err) reject(err);
      else resolve(row?.total || 0);
    });
  });
}

/**
 * Получить сеансы для напоминания (за 2 дня)
 */
function getSessionsForReminder() {
  return new Promise((resolve, reject) => {
    // Находим сеансы через 48 часов (±1 час)
    const sql = `
      SELECT * FROM sessions 
      WHERE session_datetime BETWEEN datetime('now', 'localtime', '+47 hours') 
                                 AND datetime('now', 'localtime', '+49 hours')
        AND reminder_sent = 0
        AND status = 'scheduled'
    `;
    db.all(sql, [], (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

/**
 * Пометить напоминание как отправленное
 */
function markReminderSent(sessionId) {
  return new Promise((resolve, reject) => {
    const sql = `UPDATE sessions SET reminder_sent = 1 WHERE id = ?`;
    db.run(sql, [sessionId], function(err) {
      if (err) reject(err);
      else resolve({ changes: this.changes });
    });
  });
}

/**
 * Обновить статус сеанса
 */
function updateSessionStatus(sessionId, status) {
  return new Promise((resolve, reject) => {
    const sql = `UPDATE sessions SET status = ? WHERE id = ?`;
    db.run(sql, [status, sessionId], function(err) {
      if (err) reject(err);
      else resolve({ changes: this.changes });
    });
  });
}

/**
 * Удалить сеанс
 */
function deleteSession(sessionId) {
  return new Promise((resolve, reject) => {
    const sql = `DELETE FROM sessions WHERE id = ?`;
    db.run(sql, [sessionId], function(err) {
      if (err) reject(err);
      else resolve({ changes: this.changes });
    });
  });
}

function deleteSessionsByPaymentId(paymentId) {
  return new Promise((resolve, reject) => {
    const sql = `DELETE FROM sessions WHERE payment_id = ?`;
    db.run(sql, [paymentId], function(err) {
      if (err) reject(err);
      else resolve({ changes: this.changes });
    });
  });
}

function deleteAllSessions() {
  return new Promise((resolve, reject) => {
    const sql = `DELETE FROM sessions`;
    db.run(sql, [], function(err) {
      if (err) reject(err);
      else resolve({ changes: this.changes });
    });
  });
}

function deleteAllPayments() {
  return new Promise((resolve, reject) => {
    const sql = `DELETE FROM payments`;
    db.run(sql, [], function(err) {
      if (err) reject(err);
      else resolve({ changes: this.changes });
    });
  });
}

/**
 * Получить сеанс по ID
 */
function getSession(sessionId) {
  return new Promise((resolve, reject) => {
    const sql = `SELECT * FROM sessions WHERE id = ?`;
    db.get(sql, [sessionId], (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function getSessionsByPaymentId(paymentId) {
  return new Promise((resolve, reject) => {
    const sql = `SELECT * FROM sessions WHERE payment_id = ? ORDER BY created_at ASC`;
    db.all(sql, [paymentId], (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function getBusySessionByDatetime(sessionDatetime) {
  return new Promise((resolve, reject) => {
    const sql = `
      SELECT * FROM sessions
      WHERE session_datetime = ?
        AND status IN ('scheduled', 'completed')
      LIMIT 1
    `;

    db.get(sql, [sessionDatetime], (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

// ═══════════════════════════════════════════════════════════
// ФУНКЦИИ ДЛЯ НАСТРОЕК
// ═══════════════════════════════════════════════════════════

function setSetting(key, value) {
  return new Promise((resolve, reject) => {
    const sql = `INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`;
    db.run(sql, [key, value], function(err) {
      if (err) reject(err);
      else resolve({ key, value });
    });
  });
}

function getSetting(key) {
  return new Promise((resolve, reject) => {
    const sql = `SELECT value FROM settings WHERE key = ?`;
    db.get(sql, [key], (err, row) => {
      if (err) reject(err);
      else resolve(row ? row.value : null);
    });
  });
}

// ═══════════════════════════════════════════════════════════
// ЭКСПОРТ
// ═══════════════════════════════════════════════════════════

/**
 * Экранирует специальные HTML-символы для защиты от XSS
 */
function escapeHtml(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/**
 * Санитизирует входные данные (удаляет опасные HTML/JS для защиты от XSS)
 * Использует полноценную фильтрацию вместо простого удаления <>
 */
function sanitizeInput(input) {
  if (typeof input !== 'string') return input;
  return input
    // Удаляем HTML-теги
    .replace(/<\/?[^>]*>/g, '')
    // Удаляем HTML-сущности
    .replace(/&[a-zA-Z0-9#]+;/g, '')
    // Удаляем javascript: URI
    .replace(/javascript\s*:/gi, '')
    // Удаляем on* обработчики
    .replace(/\bon\w+\s*=/gi, '')
    // Удаляем data: URI (могут содержать XSS)
    .replace(/data\s*:/gi, '')
    // Экранируем обратные кавычки (template literals)
    .replace(/`/g, '')
    .trim();
}

module.exports = {
  db,
  ready,
  // Утилиты
  escapeHtml,
  sanitizeInput,
  withRetry,
  // Платежи
  createPayment,
  updatePaymentStatus,
  getPayment,
  deletePayment,
  getPaymentByProviderId,
  getPaymentsByStatuses,
  setPaymentProviderId,
  updatePaymentBookingDetails,
  getAllPayments,
  countPayments,
  // Сеансы
  createSession,
  getAllSessions,
  getPastSessions,
  getSessionsByRange,
  countSessions,
  countSessionsByRange,
  getSessionsForReminder,
  markReminderSent,
  updateSessionStatus,
  deleteSession,
  deleteSessionsByPaymentId,
  deleteAllSessions,
  deleteAllPayments,
  getSession,
  getSessionsByPaymentId,
  getBusySessionByDatetime,
  // Настройки
  setSetting,
  getSetting
};
