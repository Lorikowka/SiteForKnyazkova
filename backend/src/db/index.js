/**
 * Единая точка доступа к базе данных.
 *
 * При импорте применяет миграции и собирает в один объект низкоуровневые
 * операции, хелперы и репозитории — чтобы остальной код зависел от `db`,
 * а не от деталей драйвера.
 */
import logger from '../utils/logger.js';
import { escapeHtml, sanitizeInput } from '../lib/text.js';
import { DB_PATH, all, close, get, run, sqlite, stmt } from './connection.js';
import { runMigrations } from './migrations.js';
import * as payments from './repositories/payments.js';
import * as reviews from './repositories/reviews.js';
import * as schedule from './repositories/schedule.js';
import * as sessions from './repositories/sessions.js';
import * as settings from './repositories/settings.js';

// Схема готова к моменту завершения импорта модуля.
runMigrations(logger);

/** Готовность базы. Оставлено для совместимости: `await db.ready`. */
export const ready = Promise.resolve(true);

export { run, all, get, stmt, close, escapeHtml, sanitizeInput, DB_PATH };
export { sqlite as db };

const database = {
  ready,
  run,
  all,
  get,
  stmt,
  db: sqlite,
  close,
  escapeHtml,
  sanitizeInput,
  ...payments,
  ...sessions,
  ...reviews,
  ...settings,
  ...schedule
};

export default database;
