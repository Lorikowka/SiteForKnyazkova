const VK_API_URL = 'https://api.vk.com/method/messages.send';

const STATUS_LABELS = {
  pending: 'ожидает оплаты',
  succeeded: 'оплачена',
  waiting_for_capture: 'ожидает подтверждения оплаты',
  canceled: 'платеж отменен',
  expired: 'платеж истек',
  pending_confirmation: 'ожидает подтверждения записи',
  scheduled: 'запланирована',
  completed: 'завершена',
  cancelled: 'отменена'
};

const EVENT_TITLES = {
  booking_created: 'Новая запись',
  payment_succeeded: 'Оплата получена',
  payment_canceled: 'Оплата отменена',
  booking_cancelled: 'Запись отменена',
  booking_status_changed: 'Статус записи изменен',
  review_created: 'Новый отзыв'
};

function normalizePeerIds(value) {
  return String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function cleanValue(value, fallback = '-') {
  const next = String(value ?? '').trim();
  return next || fallback;
}

function statusLabel(status) {
  return STATUS_LABELS[status] || cleanValue(status);
}

function buildVkEventMessage(event = {}) {
  const lines = [
    EVENT_TITLES[event.type] || 'Важное событие',
    '',
    `Имя клиента: ${cleanValue(event.clientName)}`,
    `Услуга: ${cleanValue(event.serviceName)}`,
    `Дата: ${cleanValue(event.sessionDate)}`,
    `Время: ${cleanValue(event.sessionTime)}`,
    `Статус записи: ${statusLabel(event.status)}`
  ];

  if (event.amount) lines.push(`Сумма: ${event.amount} RUB`);
  if (event.paymentStatus) lines.push(`Статус платежа: ${statusLabel(event.paymentStatus)}`);
  if (event.paymentId) lines.push(`ID платежа: ${event.paymentId}`);
  if (event.sessionId) lines.push(`ID записи: ${event.sessionId}`);
  if (event.reason) lines.push(`Причина: ${cleanValue(event.reason)}`);
  if (event.comment) lines.push(`Комментарий: ${cleanValue(event.comment)}`);

  return lines.join('\n');
}

function createVkNotifier({
  token,
  peerIds,
  apiVersion = '5.199',
  logger = console,
  fetchImpl = fetch,
  sanitize = value => value
} = {}) {
  const recipients = Array.isArray(peerIds) ? peerIds.filter(Boolean) : normalizePeerIds(peerIds);

  async function sendMessage(message) {
    if (!token || recipients.length === 0) return { skipped: true };

    const safeMessage = sanitize(String(message || '').slice(0, 4000));

    await Promise.all(recipients.map(async (peerId, index) => {
      const params = new URLSearchParams({
        access_token: token,
        v: apiVersion,
        peer_id: peerId,
        random_id: String(Date.now() + index),
        message: safeMessage
      });

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      try {
        const response = await fetchImpl(VK_API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params.toString(),
          signal: controller.signal
        });
        const payload = await response.json().catch(() => ({}));

        if (!response.ok || payload.error) {
          const vkError = payload.error?.error_msg || response.statusText || 'unknown VK error';
          throw new Error(vkError);
        }
      } finally {
        clearTimeout(timeout);
      }
    }));

    return { sent: recipients.length };
  }

  async function sendEvent(event) {
    try {
      return await sendMessage(buildVkEventMessage(event));
    } catch (error) {
      logger.error(`VK notification error: ${error.message}`);
      return { error: error.message };
    }
  }

  return {
    sendMessage,
    sendEvent,
    isConfigured: Boolean(token && recipients.length > 0)
  };
}

module.exports = {
  createVkNotifier,
  buildVkEventMessage,
  normalizePeerIds,
  statusLabel
};
