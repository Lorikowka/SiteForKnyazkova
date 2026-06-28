const db = require('../../database');
const logger = require('../utils/logger');
const config = require('../utils/config');
const { sendVkBookingNotification } = require('../services/vkService');
const { sendEmailConfirmation } = require('../services/emailService');
const { createSessionWithSlotGuard } = require('../../lib/sessionBooking');

// From scheduleController
const { getServiceConfig, getSlotStateFromEntries, getStoredPaymentMetadata } = require('./scheduleController');

// From paymentController
const { getSlotAvailability, getDuplicateGroupBooking, hasValidPaymentToken } = require('./paymentController');

const getSessions = async (req, res) => {
  try {
    const { limit = 50, past = 'false', page = 1, from = '', to = '', status = '' } = req.query;
    const isPast = past === 'true';
    const safeLimit = Math.min(parseInt(limit) || 50, 200);
    const safePage = Math.max(parseInt(page) || 1, 1);
    const offset = (safePage - 1) * safeLimit;
    const filters = { past: from || to ? null : isPast, from: String(from || '').slice(0, 40), to: String(to || '').slice(0, 40), status: ['scheduled', 'completed', 'cancelled'].includes(status) ? status : '' };

    const [sessions, total] = await Promise.all([db.getSessionsByRange(filters, safeLimit, offset), db.countSessionsByRange(filters)]);
    res.json({ success: true, sessions, pagination: { page: safePage, limit: safeLimit, total, totalPages: Math.max(Math.ceil(total / safeLimit), 1) } });
  } catch (error) {
    logger.error(`Get sessions error: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
};

const updateSessionStatus = async (req, res) => {
  try {
    const sessionId = parseInt(req.params.id, 10);
    const { status } = req.body;
    const session = await db.getSession(sessionId);
    if (!session) return res.status(404).json({ success: false, error: 'Сеанс не найден' });

    await db.updateSessionStatus(sessionId, status);
    await sendVkBookingNotification('booking_status_changed', { payment: session.payment_id ? await db.getPayment(session.payment_id) : {}, session: { ...session, status }, status });
    logger.info(`🛠️ Статус сеанса #${sessionId} обновлён: ${session.status} -> ${status}`);
    res.json({ success: true, message: 'Статус обновлён', sessionId, status });
  } catch (error) {
    logger.error(`Update session status error: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
};

const cancelSession = async (req, res) => {
  try {
    const sessionId = parseInt(req.params.id);
    const session = await db.getSession(sessionId);
    if (!session) return res.status(404).json({ success: false, error: 'Сеанс не найден' });

    await db.updateSessionStatus(sessionId, 'cancelled');
    await sendVkBookingNotification('booking_cancelled', { payment: session.payment_id ? await db.getPayment(session.payment_id) : {}, session: { ...session, status: 'cancelled' }, status: 'cancelled' });
    if (config.app.mockMode && session.payment_id) await db.updatePaymentStatus(session.payment_id, 'canceled');

    logger.info(`❌ Сеанс #${sessionId} удалён через API`);
    res.json({ success: true, message: 'Сеанс отменён' });
  } catch (error) {
    logger.error(`Cancel session error: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
};

const createSession = async (req, res) => {
  try {
    const {
      clientName,
      clientPhone,
      clientEmail,
      serviceId,
      serviceName,
      sessionDate,
      sessionTime,
      sessionDatetime,
      amount,
      comment
    } = req.body;

    if (!clientName || !clientPhone || !sessionDate || !sessionTime) {
      return res.status(400).json({ success: false, error: 'Нужны: clientName, clientPhone, sessionDate, sessionTime' });
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(sessionDate) || !/^\d{2}:\d{2}$/.test(sessionTime)) {
      return res.status(400).json({ success: false, error: 'Формат даты YYYY-MM-DD, времени HH:MM' });
    }

    const blocked = await db.getScheduleException(sessionDate);
    if (blocked) {
      return res.status(409).json({ success: false, error: 'Эта дата закрыта для записи', code: 'date_blocked' });
    }

    const serviceConfig = getServiceConfig(serviceId, serviceName);
    const resolvedServiceName = serviceName || serviceConfig.name;
    const datetime = sessionDatetime || `${sessionDate}T${sessionTime}:00`;

    const createdSession = await createSessionWithSlotGuard(db, {
      payment_id: null,
      client_name: db.sanitizeInput(clientName),
      client_phone: db.sanitizeInput(clientPhone),
      client_email: clientEmail ? db.sanitizeInput(clientEmail) : null,
      service_id: serviceConfig.id,
      service_name: resolvedServiceName,
      session_date: sessionDate,
      session_time: sessionTime,
      session_datetime: datetime,
      amount: amount ?? serviceConfig.price ?? 0,
      comment: comment ? db.sanitizeInput(comment) : null,
      status: 'scheduled'
    }, { serviceType: serviceConfig.type, capacity: serviceConfig.capacity });

    const session = await db.getSession(createdSession.id);
    await sendVkBookingNotification('booking_created', { payment: {}, session, status: 'scheduled' });
    logger.info(`✅ Запись #${createdSession.id} создана через API: ${datetime}`);
    res.status(201).json({ success: true, sessionId: createdSession.id, session });
  } catch (error) {
    if (error.code === 'SLOT_TAKEN' || error.code === 'SLOT_FULL') {
      return res.status(409).json({ success: false, error: 'Слот занят', code: error.code });
    }
    if (error.code === 'DUPLICATE_GROUP_BOOKING') {
      return res.status(409).json({ success: false, error: 'Клиент уже записан на этот слот', code: error.code });
    }
    logger.error(`Create session error: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
};

const confirmBooking = async (req, res) => {
  try {
    const { id } = req.params;
    const payment = await db.getPayment(id);
    if (!payment) return res.status(404).json({ success: false, error: 'Платёж не найден' });

    const { token, customerEmail, customerName, customerPhone, serviceId, serviceName, sessionDate, sessionTime, sessionDatetime, comment } = req.body;
    if (!hasValidPaymentToken(payment, token)) return res.status(403).json({ success: false, error: 'Неверный токен' });

    if (!['succeeded', 'waiting_for_capture'].includes(payment.status)) return res.status(409).json({ success: false, error: 'Запись возможна только после оплаты' });

    const existingSessions = await db.getSessionsByPaymentId(id);
    if (existingSessions.length > 0) return res.json({ success: true, alreadyConfirmed: true, sessionId: existingSessions[0].id });

    if (!customerName || !customerPhone || !serviceName || !sessionDate || !sessionTime || !sessionDatetime) return res.status(400).json({ success: false, error: 'Не хватает данных' });

    const storedMetadata = getStoredPaymentMetadata(payment);
    const resolvedServiceId = serviceId || storedMetadata.serviceId || payment.service_id || '';
    
    const duplicate = await getDuplicateGroupBooking({ serviceId: resolvedServiceId, serviceName, sessionDate, sessionTime, customerEmail, customerPhone, excludePaymentId: id });
    if (duplicate) return res.status(409).json({ success: false, error: 'Вы уже записаны на этот групповой тренинг.', code: 'duplicate_group_booking' });

    const availability = await getSlotAvailability({ serviceId: resolvedServiceId, serviceName, sessionDate, sessionTime, excludePaymentId: id });
    if (!availability.available) return res.status(409).json({ success: false, error: availability.code === 'group_full' ? 'На этот групповой тренинг мест больше нет.' : 'Выбранное время уже занято.', code: availability.code });

    const metadata = { ...storedMetadata, serviceId: resolvedServiceId, customerEmail: customerEmail || '', customerName, customerPhone, serviceName, sessionDate, sessionTime, sessionDatetime, comment: comment || '' };
    const serviceConfig = getServiceConfig(resolvedServiceId, serviceName);

    const createdSession = await createSessionWithSlotGuard(db, { payment_id: id, client_name: customerName, client_phone: customerPhone, client_email: customerEmail || null, service_id: resolvedServiceId || null, service_name: serviceName, session_date: sessionDate, session_time: sessionTime, session_datetime: sessionDatetime, amount: payment.amount, comment: comment || null, status: 'scheduled' }, { serviceType: serviceConfig.type, capacity: serviceConfig.capacity, paymentUpdate: { customer_email: customerEmail || null, customer_phone: customerPhone, customer_name: customerName, service_id: resolvedServiceId || null, service_name: serviceName, comment: comment || null, metadata } });

    if (customerEmail) await sendEmailConfirmation({ email: customerEmail, name: customerName, amount: payment.amount, serviceName, sessionDate, sessionTime, paymentId: id });

    logger.info(`✅ Запись подтверждена: ${sessionDatetime} (${id})`);
    await sendVkBookingNotification('booking_created', { payment: { ...payment, metadata }, session: { ...createdSession, client_name: customerName, client_phone: customerPhone, client_email: customerEmail || null, service_id: resolvedServiceId || null, service_name: serviceName, session_date: sessionDate, session_time: sessionTime, session_datetime: sessionDatetime, amount: payment.amount, comment: comment || null, status: 'scheduled' }, status: 'scheduled' });

    res.json({ success: true, sessionId: createdSession.id });
  } catch (error) {
    logger.error(`Confirm booking error: ${error.message}`);
    res.status(500).json({ success: false, error: 'Не удалось подтвердить запись' });
  }
};

const cancelBookingByClient = async (req, res) => {
  try {
    const { paymentId, token, reason } = req.body;
    const payment = await db.getPayment(paymentId);
    if (!payment) return res.status(404).json({ success: false, error: 'Платёж не найден' });

    const metadata = getStoredPaymentMetadata(payment);
    if (!metadata.cancelToken || metadata.cancelToken !== token) return res.status(403).json({ success: false, error: 'Доступ запрещён' });

    const sessions = await new Promise((resolve, reject) => {
      db.db.all('SELECT * FROM sessions WHERE payment_id = ?', [paymentId], (err, rows) => { if (err) reject(err); else resolve(rows); });
    });

    if (!sessions || sessions.length === 0) return res.status(404).json({ success: false, error: 'Запись не найдена' });

    for (const session of sessions) {
      if (['cancelled', 'completed'].includes(session.status)) continue;
      await db.updateSessionStatus(session.id, 'cancelled');
      await sendVkBookingNotification('booking_cancelled', { payment: { ...payment, status: config.app.mockMode ? 'canceled' : payment.status }, session: { ...session, status: 'cancelled' }, status: 'cancelled', reason: db.sanitizeInput(reason || '') });
    }

    if (config.app.mockMode) await db.updatePaymentStatus(paymentId, 'canceled');
    logger.info(`🚫 Запись отменена клиентом: ${paymentId}`);
    res.json({ success: true, message: 'Запись отменена' });
  } catch (error) {
    logger.error(`Cancel booking by client error: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
};

const getRemindersDue = async (req, res) => {
  try {
    const sessions = await db.getSessionsForReminder();
    res.json({ success: true, sessions, total: sessions.length });
  } catch (error) {
    logger.error(`Get reminders error: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
};

const markReminderSent = async (req, res) => {
  try {
    const sessionId = parseInt(req.params.id, 10);
    const session = await db.getSession(sessionId);
    if (!session) return res.status(404).json({ success: false, error: 'Сеанс не найден' });
    await db.markReminderSent(sessionId);
    res.json({ success: true, message: 'Напоминание отмечено', sessionId });
  } catch (error) {
    logger.error(`Mark reminder sent error: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = { getSessions, createSession, updateSessionStatus, cancelSession, confirmBooking, cancelBookingByClient, getRemindersDue, markReminderSent };
