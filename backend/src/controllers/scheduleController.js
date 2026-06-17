const db = require('../../database');
const config = require('../utils/config');
const logger = require('../utils/logger');

// Helpers migrated from server.js
const getDateFromSessionDatetime = (sd) => (typeof sd === 'string' && sd.includes('T') ? sd.split('T')[0] : '');
const getTimeFromSessionDatetime = (sd) => (typeof sd === 'string' && sd.includes('T') ? sd.split('T')[1]?.slice(0, 5) : '');

const getStoredPaymentMetadata = (p) => {
  if (!p?.metadata) return {};
  if (typeof p.metadata === 'object') return p.metadata;
  try { return JSON.parse(p.metadata); } catch (e) { return {}; }
};

const getReservedSlotMetadata = (paymentRow) => {
  const metadata = getStoredPaymentMetadata(paymentRow);
  if (!metadata.sessionDate || !metadata.sessionTime || !metadata.sessionDatetime) return null;
  return {
    paymentId: paymentRow.id,
    status: paymentRow.status,
    serviceId: metadata.serviceId || paymentRow.service_id || '',
    serviceName: metadata.serviceName || paymentRow.service_name || '',
    sessionDate: getDateFromSessionDatetime(metadata.sessionDatetime) || metadata.sessionDate,
    sessionTime: getTimeFromSessionDatetime(metadata.sessionDatetime) || metadata.sessionTime,
    sessionDatetime: metadata.sessionDatetime
  };
};

const getServiceConfig = (serviceId, serviceName = '') => {
  const normalizedName = String(serviceName || '').toLowerCase();
  const service = config.services.find(item => item.id === serviceId)
    || config.services.find(item => normalizedName.includes(String(item.name || '').toLowerCase()))
    || config.services.find(item => item.id === 'consult')
    || config.services[0];
  return { ...service, type: service?.type || 'individual', capacity: Math.max(1, Number(service?.capacity) || 1) };
};

const getRowServiceConfig = (row) => {
  const metadata = getStoredPaymentMetadata(row);
  return getServiceConfig(row?.service_id || metadata.serviceId || '', row?.service_name || metadata.serviceName || '');
};

const getSlotStateFromEntries = (service, entries = []) => {
  const hasIndividual = entries.some(entry => entry.type !== 'group');
  const groupCount = entries.filter(entry => entry.type === 'group').length;
  if (service.type === 'group') {
    const remaining = Math.max(0, service.capacity - groupCount);
    return { available: !hasIndividual && remaining > 0, code: hasIndividual ? 'slot_taken' : (remaining > 0 ? 'available' : 'group_full'), occupied: groupCount, capacity: service.capacity, remaining };
  }
  return { available: entries.length === 0, code: entries.length === 0 ? 'available' : 'slot_taken', occupied: entries.length, capacity: 1, remaining: entries.length === 0 ? 1 : 0 };
};

const buildSlotUsageMap = async ({ excludePaymentId = null } = {}) => {
  const usageMap = {};
  const addEntry = (sessionDate, sessionTime, entry) => {
    if (!sessionDate || !sessionTime) return;
    const key = `${sessionDate}|${sessionTime}`;
    if (!usageMap[key]) usageMap[key] = [];
    usageMap[key].push(entry);
  };

  // 1. Получаем все активные сеансы (одной пачкой)
  const sessions = await db.getAllSessions(2000);
  const paymentIdsWithSessions = new Set();
  
  for (const session of sessions) {
    if (session.payment_id) paymentIdsWithSessions.add(session.payment_id);
    if (!['scheduled', 'completed'].includes(session.status)) continue;
    
    const service = getRowServiceConfig(session);
    addEntry(
      getDateFromSessionDatetime(session.session_datetime) || session.session_date,
      getTimeFromSessionDatetime(session.session_datetime) || session.session_time,
      {
        source: 'session',
        paymentId: session.payment_id,
        serviceId: service.id,
        type: service.type,
        email: session.client_email,
        phone: session.client_phone
      }
    );
  }

  // 2. Получаем все потенциально бронирующие платежи
  const reservedPayments = await db.getPaymentsByStatuses(['pending', 'succeeded', 'waiting_for_capture'], 1000);
  
  for (const payment of reservedPayments) {
    if (excludePaymentId && payment.id === excludePaymentId) continue;
    
    // Если у этого платежа уже создан сеанс (мы его обработали выше), пропускаем
    if (paymentIdsWithSessions.has(payment.id)) continue;

    const reserved = getReservedSlotMetadata(payment);
    if (!reserved) continue;
    
    const service = getServiceConfig(reserved.serviceId || payment.service_id, reserved.serviceName || payment.service_name);
    addEntry(reserved.sessionDate, reserved.sessionTime, {
      source: 'payment',
      paymentId: payment.id,
      serviceId: service.id,
      type: service.type,
      email: payment.customer_email || getStoredPaymentMetadata(payment).customerEmail,
      phone: payment.customer_phone || getStoredPaymentMetadata(payment).customerPhone
    });
  }
  
  return usageMap;
};

const getSchedule = async (req, res) => {
  try {
    const { days, service: serviceQuery, serviceId: serviceIdQuery } = req.query;
    const safeDays = Math.min(parseInt(days) || config.schedule.daysAhead, 90);
    const service = getServiceConfig(serviceIdQuery || serviceQuery || 'consult');
    const allTimes = config.schedule.timeSlots;
    
    // Оптимизированный сбор занятых слотов
    const usageMap = await buildSlotUsageMap();

    // Получаем исключения (даты закрытые вручную) с retry
    const exceptions = await db.withRetry(() => db.all('SELECT date FROM schedule_exceptions'));
    const exceptionDates = exceptions.map(r => r.date);

    const allSlots = {};
    const freeSlots = {};
    const busyMap = {};
    const slotDetails = {};
    const now = new Date();
    
    for (let i = 1; i <= safeDays; i++) {
      const d = new Date(now);
      d.setDate(now.getDate() + i);
      const dow = d.getDay();
      
      // Исключаем выходные если настроено
      if (config.schedule.excludeWeekends && (dow === 0 || dow === 6)) continue;
      
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (exceptionDates.includes(key)) continue;
      
      const available = [];
      allSlots[key] = allTimes;
      
      for (const time of allTimes) {
        const entries = usageMap[`${key}|${time}`] || [];
        const state = getSlotStateFromEntries(service, entries);
        
        if (state.available) {
          available.push(time);
        } else {
          if (!busyMap[key]) busyMap[key] = [];
          busyMap[key].push(time);
        }
        
        if (service.type === 'group') {
          if (!slotDetails[key]) slotDetails[key] = {};
          slotDetails[key][time] = {
            occupied: state.occupied,
            capacity: state.capacity,
            remaining: state.remaining,
            available: state.available
          };
        }
      }
      
      if (available.length > 0) {
        freeSlots[key] = available;
      }
    }

    res.json({
      success: true,
      service: { id: service.id, type: service.type, capacity: service.capacity },
      allSlots,
      freeSlots,
      busySlots: busyMap,
      slotDetails
    });
  } catch (error) {
    logger.error(`Get schedule error: ${error.message}`);
    res.status(500).json({ success: false, error: 'Schedule Error: ' + error.message });
  }
};

const blockDate = async (req, res) => {
  try {
    const { date, reason } = req.body;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ success: false, error: 'Формат даты должен быть YYYY-MM-DD' });
    await db.run('INSERT OR REPLACE INTO schedule_exceptions (date, reason) VALUES (?, ?)', [date, reason || '']);
    logger.info(`📅 Дата ${date} закрыта для записи. Причина: ${reason || 'не указана'}`);
    res.json({ success: true, message: `Дата ${date} закрыта` });
  } catch (error) {
    logger.error(`Block date error: ${error.message}`);
    res.status(500).json({ success: false, error: 'Schedule Error: ' + error.message });
  }
};

const unblockDate = async (req, res) => {
  try {
    const { date } = req.params;
    await db.run('DELETE FROM schedule_exceptions WHERE date = ?', [date]);
    logger.info(`📅 Дата ${date} снова открыта для записи.`);
    res.json({ success: true, message: `Дата ${date} открыта` });
  } catch (error) {
    logger.error(`Unblock date error: ${error.message}`);
    res.status(500).json({ success: false, error: 'Schedule Error: ' + error.message });
  }
};

module.exports = { getSchedule, blockDate, unblockDate, buildSlotUsageMap, getServiceConfig, getSlotStateFromEntries, getStoredPaymentMetadata };
