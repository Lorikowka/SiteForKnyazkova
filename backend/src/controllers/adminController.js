/** Provider webhook and administrative cleanup. */
import config from '../config/index.js';
import db from '../db/index.js';
import { syncPayment } from '../services/paymentSync.js';
import logger from '../utils/logger.js';

export async function handleWebhook(request, reply) {
  const event = request.body;
  if (event?.type !== 'notification' || typeof event?.object?.id !== 'string') {
    return reply.code(400).send('Invalid event format');
  }
  if (!['payment.succeeded', 'payment.canceled', 'payment.waiting_for_capture'].includes(event.event)) {
    return reply.code(200).send('Ignored');
  }
  if (config.app.mockMode || !config.yookassa.isConfigured) return reply.code(503).send('Provider unavailable');
  const payment = db.getPaymentByProviderId(event.object.id);
  // Includes the race where creation has not persisted the provider ID yet.
  if (!payment) return reply.code(503).send('Payment not available yet');
  try {
    // Only the ID is taken from the notification. Status, amount and currency
    // are fetched with our merchant credentials from the provider API.
    await syncPayment(payment);
    return reply.code(200).send('OK');
  } catch (error) {
    logger.error({ paymentId: payment.id, err: error }, 'Webhook reconciliation failed');
    return reply.code(503).send('Retry later');
  }
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
