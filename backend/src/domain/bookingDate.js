import { badRequest } from '../utils/errors.js';
import config from '../config/index.js';

/** One canonical, timezone-free representation for business-local slots. */
export function validateBookingDate(date, time, suppliedDatetime) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time || '')) {
    throw badRequest('Некорректная дата или время записи');
  }
  const canonical = `${date}T${time}:00`;
  const parsed = new Date(`${canonical}Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 19) !== canonical
      || (suppliedDatetime && suppliedDatetime !== canonical)) {
    throw badRequest('Дата и время записи не совпадают или не существуют');
  }
  return canonical;
}

/** Enforce the same bookable dates/times that the public calendar exposes. */
export function validatePublicBooking(date, time, { now = new Date(), schedule = config.schedule } = {}) {
  validateBookingDate(date, time);
  const [year, month, day] = date.split('-').map(Number);
  const selected = new Date(year, month - 1, day);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const last = new Date(today);
  last.setDate(last.getDate() + schedule.daysAhead);
  if (selected <= today || selected > last
      || (schedule.excludeWeekends && [0, 6].includes(selected.getDay()))
      || !schedule.timeSlots.includes(time)) {
    throw badRequest('Выберите доступную дату и время из расписания', 'invalid_booking_slot');
  }
}
