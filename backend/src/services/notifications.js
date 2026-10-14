/**
 * Уведомления администратору: Telegram и ВКонтакте.
 */
import config from '../config/index.js';
import {
  getDateFromSessionDatetime,
  getStoredPaymentMetadata,
  getTimeFromSessionDatetime
} from '../domain/catalog.js';
import { escapeHtml, sanitizeInput } from '../lib/text.js';
import { createVkNotifier } from '../lib/vkNotifier.js';
import logger from '../utils/logger.js';

const vkNotifier = createVkNotifier({
  token: config.vk.token,
  peerIds: config.vk.peerIds,
  apiVersion: config.vk.apiVersion,
  logger,
  sanitize: sanitizeInput
});

/**
 * Отправляет сообщение администратору в Telegram.
 *
 * Текст формируется на сервере и может содержать HTML-разметку
 * (`parse_mode = HTML`). Пользовательские значения нужно экранировать
 * через `escapeTelegramHtml`.
 */
export async function sendTelegramNotification(message) {
  const { token, chatId } = config.telegram;
  if (!token || !chatId) return { skipped: true };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: String(message || ''),
        parse_mode: 'HTML',
        disable_web_page_preview: true
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.description || `HTTP ${response.status}`);
    }
    return { sent: true };
  } catch (error) {
    logger.error(`Telegram error: ${error.message}`);
    return { sent: false, error: error.message };
  } finally {
    clearTimeout(timeout);
  }
}

export const escapeTelegramHtml = escapeHtml;

/** Собирает события для VK-уведомления из платежа/записи. */
export function buildBookingNotificationEvent(type, { payment = {}, session = {}, status, reason, comment } = {}) {
  const metadata = getStoredPaymentMetadata(payment);

  const sessionDate = session.session_date
    || metadata.sessionDate
    || getDateFromSessionDatetime(metadata.sessionDatetime);
  const sessionTime = session.session_time
    || metadata.sessionTime
    || getTimeFromSessionDatetime(metadata.sessionDatetime);

  return {
    type,
    clientName: session.client_name || payment.customer_name || metadata.customerName,
    serviceName: session.service_name || payment.service_name || metadata.serviceName,
    sessionDate,
    sessionTime,
    status: status || session.status || 'scheduled',
    paymentStatus: payment.status,
    paymentId: payment.id,
    sessionId: session.id,
    amount: payment.amount || session.amount,
    reason,
    comment: comment || session.comment || payment.comment || metadata.comment
  };
}

export async function sendVkBookingNotification(type, data = {}) {
  try {
    await vkNotifier.sendEvent(buildBookingNotificationEvent(type, data));
  } catch (error) {
    logger.error(`VK notification error: ${error.message}`);
  }
}
