const db = require('../../database');
const logger = require('../utils/logger');
const config = require('../utils/config');
const { verifyWebhookSignature } = require('../../lib/security');
const { sendVkBookingNotification } = require('../services/vkService');
const { sendTelegramNotification } = require('../services/notificationService');

// From paymentController
const { getStoredPaymentMetadata } = require('../controllers/paymentController');

async function discardPaymentIfUnused(paymentId) {
  const payment = await db.getPayment(paymentId);
  if (!payment) return { discarded: false, reason: 'not_found' };
  if (!['canceled', 'expired'].includes(payment.status)) return { discarded: false, reason: payment.status };
  const sessions = await db.getSessionsByPaymentId(paymentId);
  if (sessions.length > 0) return { discarded: false, reason: 'has_sessions' };
  const result = await db.deletePayment(paymentId);
  return { discarded: Boolean(result.changes) };
}

const handleWebhook = async (req, res) => {
  try {
    const event = req.body;
    const object = event.object;
    if (!event.event || !object) return res.status(400).send('Invalid event format');

    const signature = req.headers['x-yookassa-signature'];
    if (!verifyWebhookSignature({ body: req.rawBody || '', signature, secret: config.yookassa.webhookSecret, logger })) {
      logger.warn('🚨 Неверная подпись webhook! Запрос отклонён.');
      return res.status(401).send('Invalid signature');
    }

    const existingPayment = await db.getPaymentByProviderId(object.id);
    logger.info(`📩 Webhook: ${event.event} ${object.id}`);

    if (event.event === 'payment.succeeded') {
      if (existingPayment && existingPayment.status === 'succeeded') return res.status(200).send('OK');
      if (!existingPayment) return res.status(404).send('Payment not found');

      await db.updatePaymentStatus(existingPayment.id, 'succeeded', object.paid_at);
      await sendVkBookingNotification('payment_succeeded', { payment: { ...existingPayment, status: 'succeeded', amount: existingPayment.amount || object.amount?.value }, status: 'pending_confirmation' });
      await sendTelegramNotification(`✅ <b>Оплата получена!</b>\n\n💰 Сумма: ${object.amount.value} ₽\n🆔 ID: ${object.id}`);
    } else if (['payment.canceled', 'payment.expired'].includes(event.event)) {
      if (existingPayment && ['canceled', 'expired'].includes(existingPayment.status)) return res.status(200).send('OK');
      if (!existingPayment) return res.status(404).send('Payment not found');

      await db.updatePaymentStatus(existingPayment.id, object.status);
      await sendVkBookingNotification('payment_canceled', { payment: { ...existingPayment, status: object.status, amount: existingPayment.amount || object.amount?.value }, status: object.status, reason: object.cancellation_details?.reason || '' });
      
      const cleanup = await discardPaymentIfUnused(existingPayment.id);
      if (cleanup.discarded) logger.info(`🧹 Удалён неиспользованный платёж: ${existingPayment.id}`);
      
      await sendTelegramNotification(`❌ <b>Оплата отменена!</b>\n\n🆔 ID: ${object.id}\n📝 Причина: ${object.cancellation_details?.reason || 'не указана'}`);
    }
    res.status(200).send('OK');
  } catch (error) {
    logger.error('❌ Webhook error:', error.message);
    res.status(500).send('Webhook error');
  }
};

const cleanupDatabase = async (req, res) => {
  try {
    const { scope = 'all', paymentId, confirm } = req.body;
    if (scope === 'payment') {
      if (!paymentId) return res.status(400).json({ success: false, error: 'Укажите paymentId' });
      const deletedSessions = await db.deleteSessionsByPaymentId(paymentId);
      const deletedPayment = await db.deletePayment(paymentId);
      return res.json({ success: true, scope, deletedPayment: deletedPayment.changes, deletedSessions: deletedSessions.changes });
    }
    if (confirm !== 'DELETE_ALL') return res.status(400).json({ success: false, error: 'Передайте confirm=DELETE_ALL' });
    const deletedSessions = await db.deleteAllSessions();
    const deletedPayments = await db.deleteAllPayments();
    logger.warn(`🧨 Полная очистка БД: sessions=${deletedSessions.changes}, payments=${deletedPayments.changes}`);
    res.json({ success: true, scope: 'all', deletedSessions: deletedSessions.changes, deletedPayments: deletedPayments.changes });
  } catch (error) {
    logger.error(`Cleanup error: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = { handleWebhook, cleanupDatabase };
