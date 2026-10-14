/**
 * Миграции схемы БД.
 *
 * Идентификаторы и SQL миграций не меняются относительно предыдущих версий,
 * поэтому существующие базы обновляются без потери данных. Каждая миграция
 * применяется в транзакции и ровно один раз (журнал в `schema_migrations`).
 */
import fs from 'node:fs';
import path from 'node:path';

import { BACKEND_ROOT } from '../config/env.js';
import { all, run, sqlite } from './connection.js';

const { services = [] } = JSON.parse(
  fs.readFileSync(path.join(BACKEND_ROOT, 'config.json'), 'utf8')
);

/** Добавляет колонку, только если её ещё нет (идемпотентно). */
function ensureColumn(table, column, definition) {
  const columns = all(`PRAGMA table_info(${table})`);
  if (columns.some((row) => row.name === column)) return;
  run(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
}

const migrations = [
  {
    id: '000_base_schema',
    up: () => {
      run(`
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

      run(`
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

      run(`
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT
        )
      `);

      run(`
        CREATE TABLE IF NOT EXISTS schedule_exceptions (
          date TEXT PRIMARY KEY,
          reason TEXT
        )
      `);

      run('CREATE INDEX IF NOT EXISTS idx_sessions_date ON sessions(session_date)');
      run('CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status)');
      run('CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status)');
    }
  },
  {
    id: '001_indexes_and_legacy_columns',
    up: () => {
      ensureColumn('payments', 'provider_payment_id', 'provider_payment_id TEXT');
      ensureColumn('payments', 'comment', 'comment TEXT');
      ensureColumn('payments', 'service_id', 'service_id TEXT');
      ensureColumn('sessions', 'comment', 'comment TEXT');
      ensureColumn('sessions', 'service_id', 'service_id TEXT');

      run('CREATE INDEX IF NOT EXISTS idx_sessions_datetime_status ON sessions(session_datetime, status)');
      run('CREATE INDEX IF NOT EXISTS idx_sessions_payment_id ON sessions(payment_id)');
      run('CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_provider_payment_id ON payments(provider_payment_id) WHERE provider_payment_id IS NOT NULL');
    }
  },
  {
    id: '002_slot_integrity_guards',
    up: () => {
      run(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_individual_slot_guard
        ON sessions(session_datetime)
        WHERE status IN ('scheduled', 'completed')
          AND COALESCE(service_id, '') <> 'group'
      `);

      run(`
        CREATE INDEX IF NOT EXISTS idx_sessions_group_customer_phone_guard
        ON sessions(session_datetime, service_id, client_phone)
        WHERE status IN ('scheduled', 'completed')
          AND service_id = 'group'
          AND client_phone IS NOT NULL
          AND client_phone <> ''
      `);

      run(`
        CREATE INDEX IF NOT EXISTS idx_sessions_group_customer_email_guard
        ON sessions(session_datetime, service_id, client_email)
        WHERE status IN ('scheduled', 'completed')
          AND service_id = 'group'
          AND client_email IS NOT NULL
          AND client_email <> ''
      `);
    }
  },
  {
    id: '003_unified_reviews_table',
    up: () => {
      run(`
        CREATE TABLE IF NOT EXISTS reviews (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          rating INTEGER NOT NULL,
          name TEXT NOT NULL,
          contact TEXT NOT NULL,
          message TEXT NOT NULL,
          status TEXT DEFAULT 'new',
          source TEXT DEFAULT 'site',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      run('CREATE INDEX IF NOT EXISTS idx_reviews_status ON reviews(status)');
    }
  },
  {
    id: '004_individual_slot_guard_by_config',
    up: () => {
      // Раньше индекс считал групповой только услугу с id = 'group'.
      // Теперь групповых услуг может быть несколько, поэтому список исключений
      // строится из config.json (плюс легаси-id 'group').
      const groupIds = new Set(['group', ...services.filter((s) => s.type === 'group').map((s) => s.id)]);
      const list = [...groupIds].map((id) => `'${String(id).replace(/'/g, "''")}'`).join(', ');

      run('DROP INDEX IF EXISTS idx_sessions_individual_slot_guard');
      run(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_individual_slot_guard
        ON sessions(session_datetime)
        WHERE status IN ('scheduled', 'completed')
          AND COALESCE(service_id, '') NOT IN (${list})
      `);
    }
  }
];

export function runMigrations(logger = console) {
  run(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  for (const migration of migrations) {
    const applied = all('SELECT id FROM schema_migrations WHERE id = ?', [migration.id]);
    if (applied.length > 0) continue;

    const apply = sqlite.transaction(() => {
      migration.up();
      run('INSERT INTO schema_migrations (id) VALUES (?)', [migration.id]);
    });
    apply();

    if (logger.info) logger.info(`Applied migration ${migration.id}`);
    else logger.log(`Applied migration ${migration.id}`);
  }
}
