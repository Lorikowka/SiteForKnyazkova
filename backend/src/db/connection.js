/**
 * Соединение с SQLite (better-sqlite3).
 *
 * better-sqlite3 работает синхронно, поэтому для этого приложения (локальный
 * файл, один процесс) он и проще, и быстрее, чем асинхронный драйвер. Каждый
 * SQL-запрос подготавливается один раз и кэшируется.
 */
import fs from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';

import { BACKEND_ROOT } from '../config/env.js';

// На serverless-платформах (Vercel) запись возможна только во временную папку.
const IS_SERVERLESS = process.env.VERCEL === '1' || Boolean(process.env.NOW_REGION);

export const DB_PATH = process.env.SQLITE_PATH
  || (IS_SERVERLESS ? '/tmp/payments.db' : path.join(BACKEND_ROOT, 'data', 'payments.db'));

if (!IS_SERVERLESS) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
}

/** Единственное соединение на весь процесс. */
export const sqlite = new Database(DB_PATH);

// WAL ускоряет параллельное чтение; во временной ФС смысла нет.
if (!IS_SERVERLESS) sqlite.pragma('journal_mode = WAL');
sqlite.pragma('busy_timeout = 5000');
sqlite.pragma('foreign_keys = ON');
sqlite.pragma('synchronous = NORMAL');

/** Кэш подготовленных выражений — готовим каждый SQL один раз. */
const statements = new Map();

export function stmt(sql) {
  let statement = statements.get(sql);
  if (!statement) {
    statement = sqlite.prepare(sql);
    statements.set(sql, statement);
  }
  return statement;
}

const spread = (params) => (Array.isArray(params) ? params : params == null ? [] : [params]);

/** Выполняет запрос, изменяющий данные. Возвращает `{ changes, lastInsertRowid }`. */
export function run(sql, params = []) {
  return stmt(sql).run(...spread(params));
}

/** Возвращает все строки (всегда массив). */
export function all(sql, params = []) {
  return stmt(sql).all(...spread(params));
}

/** Возвращает первую строку или `undefined`. */
export function get(sql, params = []) {
  return stmt(sql).get(...spread(params));
}

export function close() {
  try {
    statements.clear();
    sqlite.close();
  } catch {
    /* соединение уже закрыто */
  }
}
