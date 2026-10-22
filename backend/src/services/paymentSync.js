/** Reconcile payments with the provider; never trust webhook payment fields. */
import config from '../config/index.js';
import db from '../db/index.js';
import { getStoredPaymentMetadata } from '../domain/catalog.js';
import { toMinorUnits } from '../domain/money.js';
import { finalizeBooking } from './booking.js';
import { checkYooKassaPayment, createYooKassaPayment } from './yookassa.js';
import { escapeTelegramHtml, sendTelegramNotification, sendVkBookingNotification } from './notifications.js';
import logger from '../utils/logger.js';

export async function applyProviderPayment(payment, remote) {
  if (remote.id !== payment.provider_payment_id
      || remote.amount?.currency !== payment.currency
      || toMinorUnits(remote.amount?.value) !== (payment.amount_minor ?? toMinorUnits(payment.amount))) {
    throw new Error('Provider payment identity or amount mismatch');
  }
  // Terminal success cannot be rolled back by an older concurrent response.
  const current = db.getPayment(payment.id);
  if (!current) return;
  if (remote.status === 'succeeded' && remote.paid === true) {
    db.updatePaymentStatus(payment.id, 'succeeded', remote.captured_at || current.paid_at || new Date().toISOString());
    await finalizeBooking(payment.id);
  } else if (remote.status === 'canceled' && !['succeeded', 'canceled'].includes(current.status)) {
    db.updatePaymentStatus(payment.id, 'canceled');
    await sendVkBookingNotification('payment_canceled', {
      payment: { ...current, status: 'canceled' }, status: 'canceled',
      reason: remote.cancellation_details?.reason || ''
    });
    await sendTelegramNotification(`❌ <b>Оплата отменена</b>\n🆔 ${escapeTelegramHtml(payment.id)}`);
  }
  return db.getPayment(payment.id);
}

export async function syncPayment(payment) {
  if (config.app.mockMode) {
    if (payment.status === 'succeeded') await finalizeBooking(payment.id);
    return db.getPayment(payment.id);
  }
  if (!config.yookassa.isConfigured) throw new Error('YooKassa is not configured');
  let remote;
  if (payment.provider_payment_id) {
    remote = await checkYooKassaPayment(payment.provider_payment_id);
  } else {
    const metadata = getStoredPaymentMetadata(payment);
    const age = Date.now() - Date.parse(`${payment.created_at.replace(' ', 'T')}Z`);
    // Retry an uncertain creation with exactly the same request/key, only within
    // the provider's 24-hour idempotency window. Older unknown outcomes need review.
    if (age >= 23 * 60 * 60 * 1000 || !metadata.returnUrl) {
      throw new Error(`Payment ${payment.id} requires manual provider reconciliation`);
    }
    try {
      remote = await createYooKassaPayment({
        amount: payment.amount, description: payment.description, metadata,
        returnUrl: metadata.returnUrl, idempotenceKey: payment.order_id
      });
    } catch (error) {
      if (error.definitive) db.updatePaymentStatus(payment.id, 'failed');
      throw error;
    }
    db.setPaymentProviderId(payment.id, remote.id);
    payment = db.getPayment(payment.id);
  }
  return applyProviderPayment(payment, remote);
}

export async function reconcilePayments({ shouldStop = () => false } = {}) {
  if (config.app.mockMode || !config.yookassa.isConfigured) return;
  const payments = db.all(`SELECT p.* FROM payments p
    WHERE (p.status IN ('pending', 'waiting_for_capture')
      OR (p.status = 'succeeded' AND NOT EXISTS (SELECT 1 FROM sessions s WHERE s.payment_id = p.id)))
      AND datetime(p.created_at) <= datetime('now', '-30 seconds')
    ORDER BY p.created_at ASC`);
  for (const payment of payments) {
    if (shouldStop()) break;
    try { await syncPayment(payment); }
    catch (error) { logger.error({ paymentId: payment.id, err: error }, 'Payment reconciliation failed'); }
  }
}
