/**
 * Административные операции: вебхук ЮKassa и очистка базы.
 */
import config from '../config/index.js';
import db from '../db/index.js';
import { verifyWebhookSignature } from '../lib/security.js';
import { escapeTelegramHtml, sendTelegramNotification, sendVkBookingNotification } from '../services/notifications.js';
import logger from '../utils/logger.js';

/** Удаляет отменённый платёж, если к нему не привязаны сеансы. */
function discardPaymentIfUnused(paymentId) {
  const payment = db.getPayment(paymentId);
  if (!payment) return { discarded: false, reason: 'not_found' };
  if (!['canceled', 'expired'].includes(payment.status)) return { discarded: false, reason: payment.status };

  const sessions = db.getSessionsByPaymentId(paymentId);
  if (sessions.length > 0) return { discarded: false, reason: 'has_sessions' };

  const result = db.deletePayment(paymentId);
  return { discarded: Boolean(result.changes) };
}

/** Обработчик вебхуков ЮKassa. */
export async function handleWebhook(request, reply) {
  const event = request.body;
  const object = event?.object;
  if (!event?.event || !object) return reply.code(400).send('Invalid event format');

  const signature = request.headers['x-yookassa-signature'];
  const valid = verifyWebhookSignature({
    body: request.rawBody || '',
    signature,
    secret: config.yookassa.webhookSecret,
    logger
  });
  if (!valid) {
    logger.warn('Отклонён вебхук с неверной подписью');
    return reply.code(401).send('Invalid signature');
  }

  const payment = db.getPaymentByProviderId(object.id);
  logger.info(`Вебхук: ${event.event} ${object.id}`);
  if (!payment) return reply.code(404).send('Payment not found');

  if (event.event === 'payment.succeeded') {
    if (payment.status === 'succeeded') return reply.code(200).send('OK');

    db.updatePaymentStatus(payment.id, 'succeeded', object.paid_at);
    await sendVkBookingNotification('payment_succeeded', {
      payment: { ...payment, status: 'succeeded', amount: payment.amount || object.amount?.value },
      status: 'pending_confirmation'
    });
    await sendTelegramNotification(
      `✅ <b>Оплата получена!</b>\n\n💰 Сумма: ${escapeTelegramHtml(String(object.amount?.value ?? ''))} ₽\n🆔 ID: ${escapeTelegramHtml(object.id)}`
    );
  } else if (['payment.canceled', 'payment.expired'].includes(event.event)) {
    if (['canceled', 'expired'].includes(payment.status)) return reply.code(200).send('OK');

    db.updatePaymentStatus(payment.id, object.status);
    await sendVkBookingNotification('payment_canceled', {
      payment: { ...payment, status: object.status, amount: payment.amount || object.amount?.value },
      status: object.status,
      reason: object.cancellation_details?.reason || ''
    });

    const cleanup = discardPaymentIfUnused(payment.id);
    if (cleanup.discarded) logger.info(`Удалён неиспользованный платёж: ${payment.id}`);

    await sendTelegramNotification(
      `❌ <b>Оплата отменена!</b>\n\n🆔 ID: ${escapeTelegramHtml(object.id)}\n📝 Причина: ${escapeTelegramHtml(object.cancellation_details?.reason || 'не указана')}`
    );
  }

  return reply.code(200).send('OK');
}

/** Очистка базы: конкретный платёж или все данные (с явным подтверждением). */
export async function cleanupDatabase(request, reply) {
  const { scope = 'all', paymentId, confirm } = request.body || {};

  if (scope === 'payment') {
    if (!paymentId) return reply.code(400).send({ success: false, error: 'Укажите paymentId' });
    const deletedSessions = db.deleteSessionsByPaymentId(paymentId);
    const deletedPayment = db.deletePayment(paymentId);
    return reply.send({
      success: true,
      scope,
      deletedPayment: deletedPayment.changes,
      deletedSessions: deletedSessions.changes
    });
  }

  if (confirm !== 'DELETE_ALL') {
    return reply.code(400).send({ success: false, error: 'Передайте confirm=DELETE_ALL' });
  }

  const deletedSessions = db.deleteAllSessions();
  const deletedPayments = db.deleteAllPayments();
  logger.warn(`Полная очистка БД: sessions=${deletedSessions.changes}, payments=${deletedPayments.changes}`);
  return reply.send({ success: true, scope: 'all', deletedSessions: deletedSessions.changes, deletedPayments: deletedPayments.changes });
}
