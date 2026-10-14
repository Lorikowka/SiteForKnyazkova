/**
 * Расписание: свободные/занятые слоты и управление закрытыми датами.
 */
import config from '../config/index.js';
import db from '../db/index.js';
import { getServiceConfig } from '../domain/catalog.js';
import { buildSlotUsageMap, getSlotStateFromEntries } from '../domain/slots.js';
import { badRequest } from '../utils/errors.js';
import logger from '../utils/logger.js';

export async function getSchedule(request, reply) {
  const { days, service: serviceQuery, serviceId: serviceIdQuery } = request.query || {};

  const safeDays = Math.min(parseInt(days, 10) || config.schedule.daysAhead, 90);
  const service = getServiceConfig(serviceIdQuery || serviceQuery || config.services[0]?.id || '');
  const allTimes = config.schedule.timeSlots;

  const usageMap = buildSlotUsageMap();
  const exceptionDates = db.getScheduleExceptions().map((row) => row.date);

  const allSlots = {};
  const freeSlots = {};
  const busySlots = {};
  const slotDetails = {};
  const now = new Date();

  for (let i = 1; i <= safeDays; i += 1) {
    const date = new Date(now);
    date.setDate(now.getDate() + i);
    const dayOfWeek = date.getDay();

    // Выходные можно исключить из расписания.
    if (config.schedule.excludeWeekends && (dayOfWeek === 0 || dayOfWeek === 6)) continue;

    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    if (exceptionDates.includes(key)) continue;

    const available = [];
    allSlots[key] = [...allTimes];

    for (const time of allTimes) {
      const entries = usageMap[`${key}|${time}`] || [];
      const state = getSlotStateFromEntries(service, entries);

      if (state.available) {
        available.push(time);
      } else {
        (busySlots[key] ||= []).push(time);
      }

      if (service.type === 'group') {
        (slotDetails[key] ||= {})[time] = {
          occupied: state.occupied,
          capacity: state.capacity,
          remaining: state.remaining,
          available: state.available
        };
      }
    }

    if (available.length > 0) freeSlots[key] = available;
  }

  return reply.send({
    success: true,
    service: { id: service.id, type: service.type, capacity: service.capacity },
    allSlots,
    freeSlots,
    busySlots,
    slotDetails
  });
}

export async function blockDate(request, reply) {
  const { date, reason } = request.body || {};
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw badRequest('Формат даты должен быть YYYY-MM-DD');
  }

  db.blockDate(date, reason || '');
  logger.info(`📅 Дата ${date} закрыта для записи. Причина: ${reason || 'не указана'}`);
  return reply.send({ success: true, message: `Дата ${date} закрыта` });
}

export async function unblockDate(request, reply) {
  const { date } = request.params;
  db.unblockDate(date);
  logger.info(`📅 Дата ${date} снова открыта для записи.`);
  return reply.send({ success: true, message: `Дата ${date} открыта` });
}

export async function listBlockedDates(request, reply) {
  return reply.send({ success: true, blocks: db.getScheduleExceptions() });
}
