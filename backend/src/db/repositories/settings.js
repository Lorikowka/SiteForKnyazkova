/** Репозиторий настроек «ключ-значение». */
import { get, run } from '../connection.js';

export function getSetting(key) {
  const row = get('SELECT value FROM settings WHERE key = ?', [key]);
  return row ? row.value : null;
}

export function setSetting(key, value) {
  return run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, value]);
}
