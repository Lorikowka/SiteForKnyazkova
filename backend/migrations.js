function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

async function ensureColumn(db, table, column, definition) {
  const columns = await all(db, `PRAGMA table_info(${table})`);
  if (columns.some(row => row.name === column)) return;
  await run(db, `ALTER TABLE ${table} ADD COLUMN ${definition}`);
}

const migrations = [
  {
    id: '000_base_schema',
    up: async db => {
      // Таблица платежей
      await run(db, `
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
      await run(db, `
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
      await run(db, `
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT
        )
      `);

      // Таблица исключений расписания
      await run(db, `
        CREATE TABLE IF NOT EXISTS schedule_exceptions (
          date TEXT PRIMARY KEY,
          reason TEXT
        )
      `);

      // Индексы
      await run(db, `CREATE INDEX IF NOT EXISTS idx_sessions_date ON sessions(session_date)`);
      await run(db, `CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status)`);
      await run(db, `CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status)`);
    }
  },
  {
    id: '001_indexes_and_legacy_columns',
    up: async db => {
      await ensureColumn(db, 'payments', 'provider_payment_id', 'provider_payment_id TEXT');
      await ensureColumn(db, 'payments', 'comment', 'comment TEXT');
      await ensureColumn(db, 'payments', 'service_id', 'service_id TEXT');
      await ensureColumn(db, 'sessions', 'comment', 'comment TEXT');
      await ensureColumn(db, 'sessions', 'service_id', 'service_id TEXT');

      await run(db, 'CREATE INDEX IF NOT EXISTS idx_sessions_datetime_status ON sessions(session_datetime, status)');
      await run(db, 'CREATE INDEX IF NOT EXISTS idx_sessions_payment_id ON sessions(payment_id)');
      await run(db, 'CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_provider_payment_id ON payments(provider_payment_id) WHERE provider_payment_id IS NOT NULL');
    }
  },
  {
    id: '002_slot_integrity_guards',
    up: async db => {
      await run(db, `
        CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_individual_slot_guard
        ON sessions(session_datetime)
        WHERE status IN ('scheduled', 'completed')
          AND COALESCE(service_id, '') <> 'group'
      `);

      await run(db, `
        CREATE INDEX IF NOT EXISTS idx_sessions_group_customer_phone_guard
        ON sessions(session_datetime, service_id, client_phone)
        WHERE status IN ('scheduled', 'completed')
          AND service_id = 'group'
          AND client_phone IS NOT NULL
          AND client_phone <> ''
      `);

      await run(db, `
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
    up: async db => {
      await run(db, `
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
      await run(db, `CREATE INDEX IF NOT EXISTS idx_reviews_status ON reviews(status)`);
    }
  }
];

async function runMigrations(db, logger = console) {
  await run(db, `
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  for (const migration of migrations) {
    const rows = await all(db, 'SELECT id FROM schema_migrations WHERE id = ?', [migration.id]);
    if (rows.length > 0) continue;

    await migration.up(db);
    await run(db, 'INSERT INTO schema_migrations (id) VALUES (?)', [migration.id]);
    logger.info ? logger.info(`Applied migration ${migration.id}`) : logger.log(`Applied migration ${migration.id}`);
  }
}

module.exports = {
  runMigrations
};
