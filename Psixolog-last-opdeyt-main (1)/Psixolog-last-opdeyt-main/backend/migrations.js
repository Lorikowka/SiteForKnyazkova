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
    id: '001_indexes_and_legacy_columns',
    up: async db => {
      await ensureColumn(db, 'payments', 'provider_payment_id', 'provider_payment_id TEXT');
      await ensureColumn(db, 'payments', 'comment', 'comment TEXT');
      await ensureColumn(db, 'payments', 'service_id', 'service_id TEXT');
      await ensureColumn(db, 'sessions', 'comment', 'comment TEXT');
      await ensureColumn(db, 'sessions', 'service_id', 'service_id TEXT');

      await run(db, 'CREATE INDEX IF NOT EXISTS idx_sessions_date ON sessions(session_date)');
      await run(db, 'CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status)');
      await run(db, 'CREATE INDEX IF NOT EXISTS idx_sessions_datetime_status ON sessions(session_datetime, status)');
      await run(db, 'CREATE INDEX IF NOT EXISTS idx_sessions_payment_id ON sessions(payment_id)');
      await run(db, 'CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status)');
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
