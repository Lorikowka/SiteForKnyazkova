/** Репозиторий исключений расписания (закрытые даты). */
import { all, get, run } from '../connection.js';

export function getScheduleExceptions() {
  return all('SELECT date, reason FROM schedule_exceptions ORDER BY date ASC');
}

export function getScheduleException(date) {
  return get('SELECT date, reason FROM schedule_exceptions WHERE date = ?', [date]);
}

export function blockDate(date, reason = '') {
  return run('INSERT OR REPLACE INTO schedule_exceptions (date, reason) VALUES (?, ?)', [date, reason]);
}

export function unblockDate(date) {
  return run('DELETE FROM schedule_exceptions WHERE date = ?', [date]);
}
